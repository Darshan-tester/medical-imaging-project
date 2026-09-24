"""Read-only access to ``index/studies.db``.

Every list, filter, sort and count the application shows comes from here, which
is what keeps the interface responsive over a dataset this size: the study list
asks SQLite for one page at a time, and no query opens a single image file.

The database is opened read-only.  The desktop application never writes to the
index - it is a build artifact, delivered next to the dataset it describes - so
there is no schema migration, no lock contention between windows, and nothing a
crash can corrupt.

Paths that come out of here are always relative to ``dataset/``.  Resolving one
to something the filesystem understands is ``app_paths.resolve_data``'s job, and
it refuses to leave that folder.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path

try:  # in the packaged application
    from app_paths import DB_PATH
except ImportError:  # when core/ is imported from a checkout
    DB_PATH = Path(__file__).resolve().parent.parent / "index" / "studies.db"

#: Bumped by ``build_index.py`` when the table layout changes.  A mismatch means
#: the index next to the executable was built by a different version, which is a
#: setup problem worth naming rather than a query that fails oddly later.
SCHEMA_VERSION = 1


class IndexError_(Exception):
    """The index is missing, unreadable, or of the wrong version."""


#: Dataset badge text, from ``lib/dataset/types.ts``.  The same corpus is named
#: the same way in both front ends.
DATASET_SOURCE_LABEL: dict[str, str] = {
    "MRI": "MR-RATE",
    "CT": "Perle CT",
    "CHEST_XRAY": "Chest X-Ray",
    "PET": "PET",
    "ULTRASOUND": "Ultrasound",
    "ROCOV2": "ROCOv2",
}

#: The sortable study-list columns.  The web app offers four - date, patient,
#: priority and AI confidence (``StudyTable.tsx``'s ``SortKey``) - and two of
#: those are dead: the dataset pipeline sets priority to "routine" and confidence
#: to null for every study (``to-app-study.ts``), so clicking either header sorts
#: nothing.  Both are dropped here rather than shipped as controls that suggest
#: the data says something it does not, and the columns the desktop list actually
#: shows are sortable instead.
SORT_COLUMNS: dict[str, str] = {
    "date": "study_date",
    "patient": "patient_alias",
    "study": "study_code",
    "modality": "modality",
    "series": "series_count",
    "frames": "frame_count",
    "size": "bytes",
    "report": "has_report",
    "index": "position",
}


@dataclass(frozen=True)
class StudyQuery:
    """One study-list request.  Everything here is answered by the index.

    ``text`` is matched against ``study.search_blob``, built at index time from
    the web app's own four search fields in its own order - patient alias, study
    code, modality, body region - plus the dataset's ``sourceStudyId``, so the
    match is a scan of one short lowercased column rather than of the studies.

    One deliberate difference: the web app requires the whole query to appear as
    a single contiguous substring, so ``"ct chest"`` finds nothing there even
    though both words are present.  Here each word must appear, in any order -
    measured against this index, ``"ct chest"`` returns 2 studies rather than 0.
    The fields searched are the same ones; only the word handling is better.

    ``has_report`` is the web app's Status filter under its real name: status is
    derived from report presence and nothing else (``ds.report ? "in-review" :
    "queued"``).  ``date_from``/``date_to`` have no web equivalent and are here
    because §9 asks for them.  Priority, radiologist and confidence filters are
    not carried, for the same reason their sorts are not: every study would be
    excluded by any value other than "all".
    """

    text: str = ""
    modality: str | None = None
    dataset: str | None = None
    has_report: bool | None = None
    date_from: str | None = None
    date_to: str | None = None
    sort: str = "date"
    descending: bool = True

    def where(self) -> tuple[str, list]:
        clauses: list[str] = []
        args: list = []
        if self.modality:
            clauses.append("modality = ?")
            args.append(self.modality)
        if self.dataset:
            clauses.append("dataset = ?")
            args.append(self.dataset)
        if self.has_report is not None:
            clauses.append("has_report = ?")
            args.append(1 if self.has_report else 0)
        if self.date_from:
            clauses.append("study_date >= ?")
            args.append(self.date_from)
        if self.date_to:
            clauses.append("study_date <= ?")
            args.append(self.date_to)
        for word in self.text.lower().split():
            # Every word must appear, in any order, anywhere in the haystack.
            clauses.append("search_blob LIKE ? ESCAPE '\\'")
            args.append("%" + _like_escape(word) + "%")
        return (" AND ".join(clauses) or "1", args)

    def order(self) -> str:
        """``<sort> <dir>, position ASC`` - the web app's order, made explicit.

        The web app sorts with a comparator that returns 0 for ties and negates
        the whole result for descending, over an array in manifest order.  Since
        ``Array.prototype.sort`` is stable, ties keep manifest order whichever
        direction is chosen - which is exactly ``position ASC`` here, in both
        directions.  Ties are the normal case, not the exception: only 4 of the
        2,314 studies in this index carry a date at all.

        Two details were checked rather than assumed.  Undated studies: the web
        app compares ``new Date(date ?? 0)``, so they collapse to the epoch and
        land last under descending and first under ascending - which is where
        SQLite puts NULL for those two directions too.  Patient alias: the web
        app uses ``localeCompare`` and SQLite uses BINARY, and over all 2,314
        real aliases the two orders are identical at every position.
        """
        column = SORT_COLUMNS.get(self.sort, "study_date")
        direction = "DESC" if self.descending else "ASC"
        return f"{column} {direction}, position ASC"


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(frozen=True)
class StudyRow:
    """A study as the list shows it.

    ``status`` and ``priority`` follow the web app exactly: a study that arrived
    with a report is "in-review" and one that did not is "queued"; priority is
    always "routine" and there is no AI confidence, because the dataset states
    neither.  Both front ends therefore agree, and neither invents a triage
    decision no radiologist made.
    """

    id: str
    position: int
    dataset: str | None
    study_code: str | None
    source_study_id: str | None
    patient_alias: str | None
    modality: str | None
    body_region: str | None
    date: str | None
    age: int | None
    sex: str | None
    series_count: int
    frame_count: int
    file_count: int
    bytes: int
    has_report: bool
    report_source: str | None

    @property
    def status(self) -> str:
        return "in-review" if self.has_report else "queued"

    @property
    def priority(self) -> str:
        return "routine"

    @property
    def ai_confidence(self) -> None:
        return None

    @property
    def dataset_source(self) -> str | None:
        return DATASET_SOURCE_LABEL.get(self.dataset or "", self.dataset or None)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "StudyRow":
        return cls(
            id=row["id"], position=row["position"], dataset=row["dataset"],
            study_code=row["study_code"], source_study_id=row["source_study_id"],
            patient_alias=row["patient_alias"], modality=row["modality"],
            body_region=row["body_region"], date=row["study_date"], age=row["age"],
            sex=row["sex"], series_count=row["series_count"], frame_count=row["frame_count"],
            file_count=row["file_count"], bytes=row["bytes"],
            has_report=bool(row["has_report"]), report_source=row["report_source"],
        )


@dataclass(frozen=True)
class ImageRow:
    """One frame of a series, as a path relative to ``dataset/``."""

    index: int
    id: str | None
    kind: str
    path: str
    width: int | None = None
    height: int | None = None
    #: Set only for a compact run, where one file holds every frame: the frame's
    #: position inside that file.  A per-file image leaves it None.
    frame_index: int | None = None
    orientation: str | None = None


@dataclass(frozen=True)
class SeriesRow:
    """A series, with its frames resolved the way the viewer needs them.

    The index stores a volumetric plane as one compact run - a single file, a
    count, and the size every frame comes out at - rather than as thousands of
    near-identical rows.  ``frames()`` expands that run on demand, so the viewer
    can ask for frame 812 without the index ever having written frame 812 down.
    """

    id: str
    study_id: str
    position: int
    label: str | None
    modality: str | None
    orientation: str | None
    slice_count: int
    kind: str | None
    frame_count: int
    frames_path: str | None
    frames_width: int | None
    frames_height: int | None
    volume_id: str | None
    #: Present only for a series the indexer wrote out frame by frame.
    images: tuple[ImageRow, ...] = field(default_factory=tuple)

    @property
    def is_run(self) -> bool:
        return self.frames_path is not None

    def frame(self, index: int) -> ImageRow | None:
        """The frame at ``index``, or None if there is no such frame.

        Out-of-range is a None rather than an exception: a viewer that has just
        been handed a shorter series should show "Unable to load image." and
        carry on, not fall over.
        """
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            return None
        if index >= self.frame_count:
            return None
        if self.frames_path is None:
            for image in self.images:
                if image.index == index:
                    return image
            return None
        return ImageRow(
            index=index,
            id=f"{self.id}-{index}",
            kind=str(self.kind or ""),
            path=self.frames_path,
            width=self.frames_width,
            height=self.frames_height,
            frame_index=index,
            orientation=self.orientation,
        )

    def frames(self) -> list[ImageRow]:
        if self.frames_path is None:
            return list(self.images)
        return [f for f in (self.frame(i) for i in range(self.frame_count)) if f]


@dataclass(frozen=True)
class VolumeRow:
    """A reconstructed volume's descriptor, with its slices in spatial order.

    ``files`` is ordered along the volume normal, not by filename - the order the
    indexer measured from each slice's position - and it must stay that way: a
    reslice built from a shuffled stack is a picture of nothing.
    """

    study_id: str
    volume_id: str
    rows: int
    columns: int
    spacing_row: float
    spacing_col: float
    iop: tuple[float, ...]
    slice_delta: float
    spacing_from_positions: bool
    files: tuple[str, ...]

    @property
    def count(self) -> int:
        return len(self.files)


@dataclass(frozen=True)
class StudyDetail:
    """Everything the viewer and the report panel need for one study."""

    study: StudyRow
    series: tuple[SeriesRow, ...]
    volumes: dict[str, VolumeRow]
    #: The ``report`` table row, still raw: ``core.reports`` turns it into a
    #: SourceReport and derives the working report from it.
    report_row: sqlite3.Row | None

    def series_by_id(self, series_id: str) -> SeriesRow | None:
        for s in self.series:
            if s.id == series_id:
                return s
        return None

    def volume_for(self, series: SeriesRow) -> VolumeRow | None:
        return self.volumes.get(series.volume_id or "")

    @property
    def volume_available(self) -> dict[str, bool]:
        """Which series can be shown as a volume, by series id.

        True only where the descriptor is actually present: a series that names a
        volume the index does not hold cannot be reconstructed, and the 3-D
        control must not offer it.
        """
        return {
            s.id: bool(s.volume_id and s.volume_id in self.volumes)
            for s in self.series
        }


class Index:
    """The open index.  One instance per process; safe to query from workers.

    ``check_same_thread=False`` with a lock around every statement: the decode
    workers ask for the next frame's path from their own threads, and one short
    serialized read is cheaper than a connection per thread over a database this
    size.  Reads are all this class does.
    """

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.path = Path(db_path or DB_PATH)
        if not self.path.exists():
            raise IndexError_(
                f"No study index at {self.path}. The application expects "
                f"index/studies.db beside the executable."
            )
        self._conn = sqlite3.connect(
            f"file:{self.path.as_posix()}?mode=ro", uri=True, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA query_only = 1")
        # Reads of a page already in the OS cache, without a per-statement copy.
        self._conn.execute("PRAGMA mmap_size = 268435456")
        self._lock = threading.Lock()
        found = self._conn.execute("PRAGMA user_version").fetchone()[0]
        if found != SCHEMA_VERSION:
            raise IndexError_(
                f"{self.path} was built for schema version {found}, this "
                f"application reads version {SCHEMA_VERSION}. Rebuild the index."
            )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _all(self, sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, args).fetchall()

    def _one(self, sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, args).fetchone()

    def _scalar(self, sql: str, args: tuple | list = ()):
        row = self._one(sql, args)
        return None if row is None else row[0]

    # ---------------------------------------------------------------- metadata

    def meta(self) -> dict[str, str]:
        return {row["key"]: row["value"] for row in self._all("SELECT key, value FROM meta")}

    def issues(self) -> list[sqlite3.Row]:
        """What the source indexer said it skipped, in its own words."""
        return self._all("SELECT idx, dataset, path, reason FROM issue ORDER BY idx")

    def modalities(self) -> list[tuple[str, int]]:
        return [(row[0], row[1]) for row in self._all(
            "SELECT modality, COUNT(*) FROM study GROUP BY modality ORDER BY modality")]

    def datasets(self) -> list[tuple[str, str, int]]:
        """``(id, badge text, studies)`` for the dataset filter."""
        return [(row[0], DATASET_SOURCE_LABEL.get(row[0], row[0]), row[1]) for row in self._all(
            "SELECT dataset, COUNT(*) FROM study GROUP BY dataset ORDER BY dataset")]

    def totals(self) -> dict:
        """The dashboard's figures, counted by SQLite over the whole index."""
        row = self._one(
            "SELECT COUNT(*) AS studies, SUM(series_count) AS series, "
            "SUM(frame_count) AS frames, SUM(has_report) AS reports, "
            "SUM(file_count) AS files, SUM(bytes) AS bytes FROM study")
        out = {k: (row[k] or 0) for k in
               ("studies", "series", "frames", "reports", "files", "bytes")}
        out["by_modality"] = [
            {"modality": r[0], "studies": r[1], "series": r[2] or 0, "frames": r[3] or 0,
             "reports": r[4] or 0, "bytes": r[5] or 0}
            for r in self._all(
                "SELECT modality, COUNT(*), SUM(series_count), SUM(frame_count), "
                "SUM(has_report), SUM(bytes) FROM study GROUP BY modality ORDER BY COUNT(*) DESC")
        ]
        return out

    # ------------------------------------------------------------- study lists

    def count_studies(self, query: StudyQuery | None = None) -> int:
        where, args = (query or StudyQuery()).where()
        return int(self._scalar(f"SELECT COUNT(*) FROM study WHERE {where}", args) or 0)

    def list_studies(
        self,
        query: StudyQuery | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[StudyRow]:
        """One page of the study list.

        The page is what makes 31,000 studies open as fast as 100: the table asks
        for the rows it is about to draw, and the index does the filtering and the
        sorting on the way out.
        """
        q = query or StudyQuery()
        where, args = q.where()
        rows = self._all(
            f"SELECT * FROM study WHERE {where} ORDER BY {q.order()} LIMIT ? OFFSET ?",
            [*args, int(limit), int(offset)])
        return [StudyRow.from_row(row) for row in rows]

    def study_ids(self, query: StudyQuery | None = None) -> list[str]:
        """Every id the filter matches, in display order.

        Used for prev/next inside the viewer, so stepping past the end of a page
        moves to the next study in the list rather than to the next row of a page
        the viewer happens to be holding.
        """
        q = query or StudyQuery()
        where, args = q.where()
        return [row[0] for row in self._all(
            f"SELECT id FROM study WHERE {where} ORDER BY {q.order()}", args)]

    # ------------------------------------------------------------ study detail

    def study(self, study_id: str) -> StudyDetail | None:
        row = self._one("SELECT * FROM study WHERE id = ?", (study_id,))
        if row is None:
            return None
        return StudyDetail(
            study=StudyRow.from_row(row),
            series=tuple(self.series_of(study_id)),
            volumes=self.volumes_of(study_id),
            report_row=self._one("SELECT * FROM report WHERE study_id = ?", (study_id,)),
        )

    def series_of(self, study_id: str) -> list[SeriesRow]:
        out: list[SeriesRow] = []
        for row in self._all(
                "SELECT * FROM series WHERE study_id = ? ORDER BY position", (study_id,)):
            images: tuple[ImageRow, ...] = ()
            if row["frames_path"] is None:
                images = tuple(
                    ImageRow(
                        index=r["idx"], id=r["id"], kind=str(r["kind"] or ""), path=r["path"],
                        width=r["width"], height=r["height"],
                    )
                    for r in self._all(
                        "SELECT idx, id, kind, path, width, height FROM image "
                        "WHERE series_id = ? ORDER BY idx", (row["id"],))
                )
            out.append(SeriesRow(
                id=row["id"], study_id=row["study_id"], position=row["position"],
                label=row["label"], modality=row["modality"], orientation=row["orientation"],
                slice_count=row["slice_count"], kind=row["kind"],
                frame_count=row["frame_count"], frames_path=row["frames_path"],
                frames_width=row["frames_width"], frames_height=row["frames_height"],
                volume_id=row["volume_id"], images=images,
            ))
        return out

    def volumes_of(self, study_id: str) -> dict[str, VolumeRow]:
        out: dict[str, VolumeRow] = {}
        for row in self._all("SELECT * FROM volume WHERE study_id = ?", (study_id,)):
            files = tuple(r[0] for r in self._all(
                "SELECT path FROM volume_file WHERE study_id = ? AND volume_id = ? "
                "ORDER BY idx", (study_id, row["volume_id"])))
            out[row["volume_id"]] = VolumeRow(
                study_id=study_id, volume_id=row["volume_id"], rows=row["rows"],
                columns=row["columns"], spacing_row=row["spacing_row"],
                spacing_col=row["spacing_col"], iop=tuple(json.loads(row["iop"])),
                slice_delta=row["slice_delta"],
                spacing_from_positions=bool(row["spacing_from_positions"]),
                files=files,
            )
        return out

    # ----------------------------------------------------------------- reports

    def source_report(self, study_id: str) -> "SourceReport | None":
        """The study's own report, or None when the dataset had none for it.

        None is the answer the report panel needs in order to say so.  Nothing
        here substitutes another study's report, and nothing writes one.
        """
        from .reports import SourceReport

        return SourceReport.from_row(
            self._one("SELECT * FROM report WHERE study_id = ?", (study_id,)))

    # ------------------------------------------------------------------ assets

    def asset_bytes(self, path: str) -> int | None:
        """The size this file had when the index was built, for a size check."""
        return self._scalar("SELECT bytes FROM asset WHERE path = ?", (path,))

    def asset_count(self) -> int:
        return int(self._scalar("SELECT COUNT(*) FROM asset") or 0)

    def study_paths(self, study_id: str) -> list[str]:
        """Every distinct file one study needs, relative to ``dataset/``."""
        rows = self._all(
            "SELECT path FROM image WHERE series_id IN "
            "  (SELECT id FROM series WHERE study_id = ?) "
            "UNION SELECT frames_path FROM series WHERE study_id = ? AND frames_path IS NOT NULL "
            "UNION SELECT path FROM volume_file WHERE study_id = ?",
            (study_id, study_id, study_id))
        return [row[0] for row in rows]
