"""Turns the web indexer's manifest into the desktop application's local index.

Run once at build time, on the machine that has the dataset::

    python desktop/build_index.py --manifest .scanlab/manifest.json --out desktop/index

Two things come out of it:

``index/studies.db``
    Everything the study list, the study detail panes and the viewer need, with
    every pixel source recorded as a path *relative to* ``dataset/``.  No
    developer path is written into it, which is what lets the delivered folder
    be copied to another PC and opened with no configuration at all.

``index/copy_manifest.tsv``
    ``<source absolute path>\\t<dataset-relative path>\\t<bytes>`` for every file
    the index references, so the copy step and the index can never disagree
    about where a file is meant to land.  A build artifact - it holds the source
    machine's paths and is not part of the delivery.

The manifest stays the single source of truth for *what* the dataset contains:
this script re-derives nothing.  Study codes, patient aliases, slice ordering,
report text and report sections, MPR plane sizes, volume descriptors - all are
copied across verbatim.  Re-deriving any of it would risk the desktop showing
something the web app does not.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

#: Bumped when the table layout changes, so a stale DB is detected rather than
#: read with the wrong columns.
SCHEMA_VERSION = 1

#: MRI volumes are unpacked by the web indexer into its own cache rather than
#: living under the scan root, so they are the one payload that gets re-rooted.
MRI_CACHE_MARKER = "/.scanlab/cache/zips/"
MRI_DEST_ROOT = "_mri"


class UnmappedPath(Exception):
    """A referenced file is neither under the scan root nor in the zip cache."""


def dataset_relative(abs_path: str, scan_root: str) -> str:
    """Where ``abs_path`` will live inside the delivered ``dataset/`` folder.

    The source tree's own structure is preserved (``02_CT/raw/…``,
    ``06_PET/raw/…``, ``_integration/chest_images/…``) so the delivered folder
    can be compared against the source directly, and nothing is renamed.  Files
    the indexer unpacked into ``.scanlab/cache/zips/`` are re-rooted under
    ``_mri/`` because they have no place under the scan root at all.
    """
    q = str(abs_path).replace("\\", "/")
    low = q.lower()
    root = scan_root.replace("\\", "/").rstrip("/").lower() + "/"
    at = low.find(root) if root != "/" else -1
    if at >= 0:
        tail = q[at + len(root):]
    else:
        at = low.find(MRI_CACHE_MARKER)
        if at < 0:
            raise UnmappedPath(abs_path)
        tail = MRI_DEST_ROOT + "/" + q[at + len(MRI_CACHE_MARKER):]
    tail = tail.lstrip("/")
    parts = [p for p in tail.split("/") if p]
    if not parts or any(p == ".." for p in parts) or ":" in tail:
        raise UnmappedPath(abs_path)
    return "/".join(parts)


SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE study (
  id             TEXT PRIMARY KEY,
  position       INTEGER NOT NULL,
  dataset        TEXT,
  study_code     TEXT,
  source_study_id TEXT,
  patient_alias  TEXT,
  modality       TEXT,
  body_region    TEXT,
  study_date     TEXT,
  age            INTEGER,
  sex            TEXT,
  series_count   INTEGER NOT NULL,
  frame_count    INTEGER NOT NULL,
  file_count     INTEGER NOT NULL,
  bytes          INTEGER NOT NULL,
  has_report     INTEGER NOT NULL,
  report_source  TEXT,
  search_blob    TEXT NOT NULL
);

CREATE TABLE series (
  id            TEXT PRIMARY KEY,
  study_id      TEXT NOT NULL,
  position      INTEGER NOT NULL,
  label         TEXT,
  modality      TEXT,
  orientation   TEXT,
  slice_count   INTEGER NOT NULL,
  kind          TEXT,
  frame_count   INTEGER NOT NULL,
  frames_path   TEXT,
  frames_width  INTEGER,
  frames_height INTEGER,
  volume_id     TEXT
);

-- Only for series the indexer wrote as an explicit list; a series carries
-- either these rows or one compact run on `series`, never both.
CREATE TABLE image (
  series_id TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  id        TEXT,
  kind      TEXT,
  path      TEXT NOT NULL,
  width     INTEGER,
  height    INTEGER,
  PRIMARY KEY (series_id, idx)
) WITHOUT ROWID;

CREATE TABLE volume (
  study_id      TEXT NOT NULL,
  volume_id     TEXT NOT NULL,
  rows          INTEGER NOT NULL,
  columns       INTEGER NOT NULL,
  spacing_row   REAL NOT NULL,
  spacing_col   REAL NOT NULL,
  iop           TEXT NOT NULL,
  slice_delta   REAL NOT NULL,
  spacing_from_positions INTEGER NOT NULL,
  file_count    INTEGER NOT NULL,
  PRIMARY KEY (study_id, volume_id)
) WITHOUT ROWID;

-- Spatial order matters: row `idx` is the idx-th slice along the volume normal.
CREATE TABLE volume_file (
  study_id  TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  path      TEXT NOT NULL,
  PRIMARY KEY (study_id, volume_id, idx)
) WITHOUT ROWID;

-- Verbatim from the manifest. `text` is always present; the section columns are
-- present only where the source report actually had that heading, and a NULL
-- means "the source did not say", never "write something plausible here".
-- `indication` is NULL for every study in the current index and is carried
-- anyway: the web app's report type and report panel both have it, and a column
-- the adapters can fill but the index cannot store is how content goes missing.
CREATE TABLE report (
  study_id             TEXT PRIMARY KEY,
  source               TEXT,
  text                 TEXT,
  clinical_information TEXT,
  indication           TEXT,
  technique            TEXT,
  comparison           TEXT,
  findings             TEXT,
  impression           TEXT
) WITHOUT ROWID;

-- Every distinct file the index references, with the size it had at build time,
-- so a delivery can be checked file by file instead of by folder size.
CREATE TABLE asset (
  path  TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  kind  TEXT
) WITHOUT ROWID;

-- What the source indexer reported it could not do. Carried so the application
-- can show it rather than presenting a partial index as a complete one.
CREATE TABLE issue (
  idx     INTEGER PRIMARY KEY,
  dataset TEXT,
  path    TEXT,
  reason  TEXT
);
"""

#: Every study-list query is ``ORDER BY <sort> <dir>, position ASC`` with an
#: optional filter and a LIMIT, so each index pairs a sortable column with the
#: tie-break.  That lets SQLite walk one index and stop at the LIMIT instead of
#: sorting the whole table into a temporary B-tree for every page.
#:
#: Measured on a synthetic 31,447-row study table of this exact schema
#: (``parity/p_sortscale.py``), single-column indexes only vs. the set below:
#:
#:     first page, date descending      116.61 ms -> 0.92 ms
#:     last page (offset 31,300)        169.16 ms -> 4.06 ms
#:     sort by frame count               11.44 ms -> 1.39 ms
#:     filter X-Ray, date descending     11.55 ms -> 0.60 ms
#:     text 'chest', date descending    103.33 ms -> 0.78 ms
#:
#: Cost: 8.1 MiB and 0.7 s at that size.  Both directions are indexed because
#: the tie-break stays ``position ASC`` either way - that is what the web app's
#: stable sort does, and a page must not reorder between the two front ends.
#: An index leading with a filter column cannot also serve a different sort, so
#: only the default sort (date) is paired with the filters; any other sort under
#: a filter falls back to sorting the filtered subset, which is bounded by it.
INDEXES = """
CREATE INDEX study_position   ON study (position);
CREATE INDEX study_date_a     ON study (study_date, position);
CREATE INDEX study_date_d     ON study (study_date DESC, position);
CREATE INDEX study_patient_a  ON study (patient_alias, position);
CREATE INDEX study_patient_d  ON study (patient_alias DESC, position);
CREATE INDEX study_code_a     ON study (study_code, position);
CREATE INDEX study_code_d     ON study (study_code DESC, position);
CREATE INDEX study_modality_a ON study (modality, position);
CREATE INDEX study_modality_d ON study (modality DESC, position);
CREATE INDEX study_series_a   ON study (series_count, position);
CREATE INDEX study_series_d   ON study (series_count DESC, position);
CREATE INDEX study_frames_a   ON study (frame_count, position);
CREATE INDEX study_frames_d   ON study (frame_count DESC, position);
CREATE INDEX study_bytes_a    ON study (bytes, position);
CREATE INDEX study_bytes_d    ON study (bytes DESC, position);
CREATE INDEX study_report_a   ON study (has_report, position);
CREATE INDEX study_report_d   ON study (has_report DESC, position);
CREATE INDEX study_dataset_a  ON study (dataset, position);
CREATE INDEX study_dataset_d  ON study (dataset DESC, position);
CREATE INDEX study_f_modality ON study (modality, study_date DESC, position);
CREATE INDEX study_f_dataset  ON study (dataset, study_date DESC, position);
CREATE INDEX study_f_report   ON study (has_report, study_date DESC, position);
CREATE INDEX study_f_mod_a    ON study (modality, study_date, position);
CREATE INDEX study_f_ds_a     ON study (dataset, study_date, position);
CREATE INDEX study_f_rep_a    ON study (has_report, study_date, position);
CREATE INDEX series_study     ON series (study_id, position);
"""


def _int_or_none(value) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


class Collector:
    """Walks the manifest once and turns it into rows plus a file list."""

    def __init__(self, scan_root: str) -> None:
        self.scan_root = scan_root
        #: dataset-relative path -> (source absolute path, first kind seen)
        self.assets: dict[str, tuple[str, str]] = {}
        self.unmapped: list[str] = []
        self.studies: list[tuple] = []
        self.series: list[tuple] = []
        self.images: list[tuple] = []
        self.volumes: list[tuple] = []
        self.volume_files: list[tuple] = []
        self.reports: list[tuple] = []
        self.issues: list[tuple] = []
        #: Volumes where some slice could not be mapped into ``dataset/``.  A
        #: volume must be complete or absent: reconstructing from fewer slices
        #: than the descriptor promises would change the geometry silently.
        self.broken_volumes: list[tuple[str, str, int, int]] = []
        #: study id -> the distinct dataset-relative files it needs
        self.study_files: dict[str, set[str]] = {}

    def asset(self, abs_path: str, kind: str, owner: set[str]) -> str | None:
        try:
            rel = dataset_relative(abs_path, self.scan_root)
        except UnmappedPath:
            self.unmapped.append(str(abs_path))
            return None
        self.assets.setdefault(rel, (str(abs_path), kind))
        owner.add(rel)
        return rel

    def run(self, manifest: dict) -> None:
        for n, issue in enumerate(manifest.get("issues") or []):
            self.issues.append((n, issue.get("dataset"), self.issue_path(issue.get("path")),
                                issue.get("reason")))
        for position, study in enumerate(manifest.get("studies") or []):
            self.study(position, study)

    def issue_path(self, raw) -> str | None:
        """An issue's own path, relative to ``dataset/`` or not at all.

        The indexer records where it hit the problem, which on the build machine
        is an absolute path like ``D:\\ScanLab_Datasets\\01_CHEST_XRAY``.  The
        reason text is worth carrying - it is how the application can say the
        index is capped rather than pretending it is complete - but the path
        would put the build machine's layout inside the delivered index, so it
        is mapped or dropped.  The dataset name identifies the source either way.
        """
        if not raw:
            return None
        try:
            return dataset_relative(str(raw), self.scan_root)
        except UnmappedPath:
            return None

    def study(self, position: int, st: dict) -> None:
        sid = str(st["id"])
        owner = self.study_files.setdefault(sid, set())
        frames = 0
        series_list = st.get("series") or []
        for order, s in enumerate(series_list):
            frames += self.series_row(sid, order, s, owner)
        for volume_id, raw in (st.get("volumes") or {}).items():
            self.volume_row(sid, str(volume_id), raw, owner)
        report = st.get("report") or None
        if report:
            self.reports.append((
                sid, report.get("source"), report.get("text"),
                report.get("clinicalInformation"), report.get("indication"),
                report.get("technique"), report.get("comparison"),
                report.get("findings"), report.get("impression"),
            ))
        # The web app's own search haystack is
        #     `${patientAlias} ${studyId} ${modality} ${bodyRegion ?? ""}`
        # lowercased (app/(portal)/studies/page.tsx).  The same four fields in the
        # same order are here, so a query that matches there matches here.
        # `sourceStudyId` is appended because §9 asks for search by study ID and
        # the dataset's own identifier - the number on the source record - is what
        # someone pastes in; it is a field the web app simply does not offer.
        blob = " ".join(str(v) for v in (
            st.get("patientAlias"), st.get("studyCode"), st.get("modality"),
            st.get("bodyRegion") or "", st.get("sourceStudyId") or "",
        ) if v).lower()
        self.studies.append((
            sid, position, st.get("dataset"), st.get("studyCode"), st.get("sourceStudyId"),
            st.get("patientAlias"), st.get("modality"), st.get("bodyRegion"), st.get("date"),
            _int_or_none(st.get("age")), st.get("sex"),
            len(series_list), frames, 0, 0, 1 if report else 0,
            (report or {}).get("source"), blob,
        ))

    def series_row(self, study_id: str, order: int, s: dict, owner: set[str]) -> int:
        """Returns the number of displayable frames this series contributes."""
        run = s.get("frames") or None
        images = s.get("images") or []
        kind = None
        frames_path = None
        width = height = None
        frame_count = 0
        if run:
            kind = run.get("kind")
            frames_path = self.asset(run.get("absPath") or "", str(kind or ""), owner)
            frame_count = int(run.get("count") or 0)
            width = _int_or_none(run.get("width"))
            height = _int_or_none(run.get("height"))
        elif images:
            kind = images[0].get("kind")
            frame_count = len(images)
            for im in images:
                path = self.asset(im.get("absPath") or "", str(im.get("kind") or ""), owner)
                if path is None:
                    continue
                self.images.append((
                    str(s["id"]), int(im.get("index") or 0), im.get("id"), im.get("kind"),
                    path, _int_or_none(im.get("width")), _int_or_none(im.get("height")),
                ))
        self.series.append((
            str(s["id"]), study_id, order, s.get("label"), s.get("modality"), s.get("orientation"),
            int(s.get("sliceCount") or 0), kind, frame_count, frames_path, width, height,
            s.get("volumeId"),
        ))
        return frame_count

    def volume_row(self, study_id: str, volume_id: str, raw: dict, owner: set[str]) -> None:
        spacing = list(raw.get("pixelSpacing") or [1.0, 1.0])
        while len(spacing) < 2:
            spacing.append(1.0)
        files = [str(f) for f in (raw.get("files") or [])]
        kept = 0
        for idx, source in enumerate(files):
            path = self.asset(source, "dicom-volume-member", owner)
            if path is None:
                continue
            self.volume_files.append((study_id, volume_id, idx, path))
            kept += 1
        self.volumes.append((
            study_id, volume_id, int(raw.get("rows") or 0), int(raw.get("columns") or 0),
            float(spacing[0]), float(spacing[1]),
            json.dumps([float(v) for v in (raw.get("iop") or [1, 0, 0, 0, 1, 0])]),
            float(raw.get("sliceDelta") or 0.0),
            1 if raw.get("spacingFromPositions") else 0,
            kept,
        ))
        if kept != len(files):
            self.broken_volumes.append((study_id, volume_id, len(files), kept))


def stat_sizes(assets: dict[str, tuple[str, str]], workers: int = 32) -> tuple[dict[str, int], list[str]]:
    """Size every source file, in parallel - one open per file, nothing read."""
    items = list(assets.items())

    def one(entry):
        rel, (source, _kind) = entry
        try:
            return rel, os.path.getsize(source)
        except OSError:
            return rel, -1

    sizes: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for rel, size in ex.map(one, items):
            sizes[rel] = size
    missing = sorted(rel for rel, size in sizes.items() if size < 0)
    return sizes, missing


def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def write_db(db_path: Path, c: Collector, sizes: dict[str, int], meta: dict[str, str]) -> None:
    """One transaction, indexes last - the fastest safe order for a bulk load."""
    if db_path.exists():
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

        # Study rows carry their own payload total so the study list can show a
        # size without touching the disk.
        studies = []
        for row in c.studies:
            files = c.study_files.get(row[0], set())
            total = sum(sizes.get(rel, 0) for rel in files if sizes.get(rel, 0) > 0)
            studies.append(row[:13] + (len(files), total) + row[15:])

        conn.executemany(
            "INSERT INTO study VALUES (" + ",".join("?" * 18) + ")", studies)
        conn.executemany(
            "INSERT INTO series VALUES (" + ",".join("?" * 13) + ")", c.series)
        conn.executemany(
            "INSERT INTO image VALUES (?,?,?,?,?,?,?)", c.images)
        conn.executemany(
            "INSERT INTO volume VALUES (?,?,?,?,?,?,?,?,?,?)", c.volumes)
        conn.executemany(
            "INSERT INTO volume_file VALUES (?,?,?,?)", c.volume_files)
        conn.executemany(
            "INSERT INTO report VALUES (?,?,?,?,?,?,?,?,?)", c.reports)
        conn.executemany(
            "INSERT INTO asset VALUES (?,?,?)",
            [(rel, max(0, sizes.get(rel, 0)), kind) for rel, (_src, kind) in c.assets.items()])
        conn.executemany("INSERT INTO issue VALUES (?,?,?,?)", c.issues)
        conn.executemany("INSERT INTO meta VALUES (?,?)", sorted(meta.items()))
        conn.executescript(INDEXES)
        conn.commit()
        # Without sqlite_stat1 the planner guesses how selective each filter is,
        # and guesses badly for a rare modality: measured 8.86 ms per page for
        # `modality = 'CT'` unanalysed against 0.97 ms analysed, because it chose
        # to walk the date index instead of seeking the modality one.  ANALYZE is
        # a build-time cost only - the delivered database is opened read-only.
        conn.execute("ANALYZE")
        conn.commit()
        conn.execute("VACUUM")
        conn.commit()
    finally:
        conn.close()


def write_copy_manifest(path: Path, c: Collector, sizes: dict[str, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("# source\trelative\tbytes\n")
        for rel in sorted(c.assets):
            source, _kind = c.assets[rel]
            fh.write(f"{source}\t{rel}\t{sizes.get(rel, -1)}\n")


def summarise(c: Collector, sizes: dict[str, int]) -> dict:
    """The per-modality figures §3 asks for, counted rather than estimated."""
    by_modality: dict[str, dict[str, int]] = {}
    series_by_study: dict[str, list[tuple]] = {}
    for row in c.series:
        series_by_study.setdefault(row[1], []).append(row)
    for row in c.studies:
        sid, modality = row[0], row[6] or "Unknown"
        bucket = by_modality.setdefault(
            modality, {"studies": 0, "series": 0, "frames": 0, "files": 0, "bytes": 0, "with_report": 0})
        bucket["studies"] += 1
        bucket["series"] += row[11]
        bucket["frames"] += row[12]
        bucket["with_report"] += row[15]
        files = c.study_files.get(sid, set())
        bucket["files"] += len(files)
        bucket["bytes"] += sum(sizes.get(rel, 0) for rel in files if sizes.get(rel, 0) > 0)
    kinds: dict[str, int] = {}
    for _rel, (_src, kind) in c.assets.items():
        kinds[kind or "unknown"] = kinds.get(kind or "unknown", 0) + 1
    return {
        "studies": len(c.studies),
        "series": len(c.series),
        "frames": sum(row[12] for row in c.studies),
        "images_listed": len(c.images),
        "volumes": len(c.volumes),
        "volume_files": len(c.volume_files),
        "reports": len(c.reports),
        "distinct_files": len(c.assets),
        "payload_bytes": sum(v for v in sizes.values() if v > 0),
        "asset_kinds": kinds,
        "by_modality": by_modality,
        "source_issues": len(c.issues),
    }


def verify_delivery(db_path: Path, dataset_root: Path) -> int:
    """§30 - check the delivered dataset against the index, file by file.

    Reports what is wrong and returns a non-zero count; it never repairs the
    index to match the disk, because an index that quietly forgets a missing
    study is exactly how missing data gets hidden.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT path, bytes FROM asset").fetchall()
    finally:
        conn.close()
    print(f"verifying {len(rows)} files under {dataset_root}")

    def check(row):
        rel, expected = row
        full = dataset_root / rel
        try:
            actual = full.stat().st_size
        except OSError:
            return ("missing", rel, expected, -1)
        if expected and actual != expected:
            return ("size", rel, expected, actual)
        return None

    problems = []
    with ThreadPoolExecutor(max_workers=32) as ex:
        for result in ex.map(check, rows):
            if result is not None:
                problems.append(result)
    if not problems:
        print("OK: every indexed file is present with the expected size")
        return 0
    kinds: dict[str, int] = {}
    for kind, *_rest in problems:
        kinds[kind] = kinds.get(kind, 0) + 1
    print(f"PROBLEMS: {kinds}")
    for kind, rel, expected, actual in problems[:40]:
        print(f"  {kind:8s} {rel}  expected {expected} got {actual}")
    if len(problems) > 40:
        print(f"  … and {len(problems) - 40} more")
    return len(problems)


def human(n: int) -> str:
    return f"{n / 2**30:.3f} GiB" if n >= 2**30 else f"{n / 2**20:.1f} MiB"


def report(summary: dict, c: Collector) -> None:
    m = summary
    print()
    print(f"studies {m['studies']}  series {m['series']}  displayable frames {m['frames']}")
    print(f"reports {m['reports']}  volumes {m['volumes']} ({m['volume_files']} instances)")
    print(f"distinct files {m['distinct_files']}  payload {human(m['payload_bytes'])}")
    print(f"asset kinds: {m['asset_kinds']}")
    print()
    head = f"{'modality':12s} {'studies':>8s} {'series':>8s} {'frames':>9s} {'files':>8s} {'reports':>8s} {'size':>12s}"
    print(head)
    print("-" * len(head))
    for modality, v in sorted(m["by_modality"].items()):
        print(f"{modality:12s} {v['studies']:8d} {v['series']:8d} {v['frames']:9d} "
              f"{v['files']:8d} {v['with_report']:8d} {human(v['bytes']):>12s}")
    if c.issues:
        print()
        print(f"the source indexer reported {len(c.issues)} issue(s), carried into the index:")
        for _idx, dataset, _path, reason in c.issues:
            print(f"  [{dataset}] {reason}")


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Build the desktop study index from the web manifest.")
    ap.add_argument("--manifest", default=str(here.parent / ".scanlab" / "manifest.json"))
    ap.add_argument("--out", default=str(here / "index"), help="index directory to write")
    ap.add_argument("--copy-manifest", default=None, help="default: <out>/copy_manifest.tsv")
    ap.add_argument("--scan-root", default=None, help="override the manifest's own scanRoot")
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--allow-missing", action="store_true",
                    help="write the index even if source files are missing (they are still listed)")
    ap.add_argument("--verify", metavar="DATASET_DIR",
                    help="check an already-built index against a delivered dataset folder and exit")
    args = ap.parse_args(argv)

    out_dir = Path(args.out).resolve()
    db_path = out_dir / "studies.db"
    if args.verify:
        if not db_path.exists():
            print(f"no index at {db_path}", file=sys.stderr)
            return 2
        return 1 if verify_delivery(db_path, Path(args.verify).resolve()) else 0

    manifest_path = Path(args.manifest).resolve()
    if not manifest_path.exists():
        print(f"manifest not found: {manifest_path}", file=sys.stderr)
        return 2
    t0 = time.time()
    print(f"reading {manifest_path} ({manifest_path.stat().st_size / 2**20:.1f} MiB)")
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    scan_root = args.scan_root or manifest.get("scanRoot") or ""
    if not scan_root:
        print("the manifest has no scanRoot and none was given", file=sys.stderr)
        return 2
    print(f"scan root {scan_root}  builderVersion {manifest.get('builderVersion')}  "
          f"generated {manifest.get('generatedAt')}  in {time.time() - t0:.1f}s")

    c = Collector(scan_root)
    t1 = time.time()
    c.run(manifest)
    print(f"collected {len(c.studies)} studies in {time.time() - t1:.1f}s")
    if c.unmapped:
        print(f"ERROR: {len(c.unmapped)} referenced file(s) are outside the scan root "
              f"and the zip cache, so they cannot be delivered:", file=sys.stderr)
        for path in c.unmapped[:20]:
            print(f"  {path}", file=sys.stderr)
        return 3
    if c.broken_volumes:
        print(f"ERROR: {len(c.broken_volumes)} volume(s) lost slices during mapping:", file=sys.stderr)
        for study_id, volume_id, want, got in c.broken_volumes[:20]:
            print(f"  study {study_id} volume {volume_id}: {got}/{want}", file=sys.stderr)
        return 3

    t2 = time.time()
    sizes, missing = stat_sizes(c.assets, args.workers)
    print(f"sized {len(sizes)} files in {time.time() - t2:.1f}s")
    if missing:
        print(f"{'WARNING' if args.allow_missing else 'ERROR'}: "
              f"{len(missing)} indexed file(s) are not on disk:", file=sys.stderr)
        for rel in missing[:20]:
            print(f"  {rel}  <-  {c.assets[rel][0]}", file=sys.stderr)
        if not args.allow_missing:
            return 4

    summary = summarise(c, sizes)
    meta = {
        "schema_version": str(SCHEMA_VERSION),
        "builder_version": str(manifest.get("builderVersion") or ""),
        "manifest_generated_at": str(manifest.get("generatedAt") or ""),
        "manifest_sha256": sha256_of(manifest_path),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "studies": str(summary["studies"]),
        "series": str(summary["series"]),
        "frames": str(summary["frames"]),
        "distinct_files": str(summary["distinct_files"]),
        "payload_bytes": str(summary["payload_bytes"]),
        "missing_files": str(len(missing)),
    }
    t3 = time.time()
    write_db(db_path, c, sizes, meta)
    print(f"wrote {db_path} ({db_path.stat().st_size / 2**20:.1f} MiB) in {time.time() - t3:.1f}s")

    copy_path = Path(args.copy_manifest) if args.copy_manifest else out_dir / "copy_manifest.tsv"
    write_copy_manifest(copy_path, c, sizes)
    print(f"wrote {copy_path} ({len(c.assets)} files to copy)")

    # Shipped alongside the DB: what this index is, counted - never estimated.
    # scanRoot is deliberately left out; the delivered application must not
    # carry the path of the machine it was built on.
    info = {
        "application": "Vedh Medical Imaging",
        "schemaVersion": SCHEMA_VERSION,
        "builderVersion": manifest.get("builderVersion"),
        "manifestGeneratedAt": manifest.get("generatedAt"),
        "manifestSha256": meta["manifest_sha256"],
        "builtAt": meta["built_at"],
        "counts": {k: summary[k] for k in (
            "studies", "series", "frames", "images_listed", "volumes", "volume_files",
            "reports", "distinct_files", "payload_bytes")},
        "assetKinds": summary["asset_kinds"],
        "byModality": summary["by_modality"],
        "missingFiles": len(missing),
        "sourceIssues": [
            {"dataset": d, "reason": r} for _i, d, _p, r in c.issues
        ],
    }
    info_path = out_dir / "manifest.json"
    with open(info_path, "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=1)
    print(f"wrote {info_path}")
    report(summary, c)
    print(f"\ntotal {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())








