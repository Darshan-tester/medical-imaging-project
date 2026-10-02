"""
Build the portable, shareable Meridian demo data folder.

    python desktop/build_demo_bundle.py [--out DIR] [--only PET,MRI]

Reads the committed demo index (``public/demo-data/index.json``) — the SAME
index the deployed Cloudflare site serves — and produces a self-contained
``demo-data/`` folder the desktop workstation runs on, on any Windows PC, with
no Python, no Node, no browser, no network and no ``D:\\ScanLab_Datasets``::

    <out>/                      (default: desktop/dist/VedhMedicalImaging)
      VedhMedicalImaging.exe   <- built separately by build-windows.bat
      demo-data/manifest.json   <- desktop manifest, paths RELATIVE to
                                   demo-data/, never absolute Windows paths
      demo-data/pet/...         <- real NIfTI volumes (copied verbatim)
      demo-data/mri/...         <- real NIfTI volumes EXTRACTED from the
                                   committed STORED zip archives, so nibabel
                                   can open them as plain files
      demo-data/ct/...          <- real DICOM instances (copied verbatim)
      demo-data/chest-xray/...  <- real X-ray images (copied verbatim)

The manifest uses the desktop app's existing schema (``Series.from_dict`` /
``ImageRef.from_dict`` / manifest v4 loader), so no viewer, report or pairing
code changes. Reports are passed through verbatim from the index — never
rewritten, never re-derived.

Nothing here touches the multi-GB private dataset: only the committed files
under ``public/demo-data`` are used.

Safety: the script refuses to delete anything if --out points at the committed
``public/demo-data`` folder itself (that mode is for local testing, where the
copies are identical to what is already there and only manifest.json + the
extracted MRI volumes are new, gitignored files).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEMO_SRC = REPO / "public" / "demo-data"
DEMO_INDEX = DEMO_SRC / "index.json"

#: Demo MRI studies whose archives were deliberately never committed to Git
#: (they exceed Cloudflare's 25 MiB per-asset limit — see .gitignore). If they
#: appear in the index at all, skip them with the same reason the web build
#: reports, rather than failing or shipping a study with no images.
NOT_COMMITTED = {"IQT6Z5U6WE", "KNCH35VQQ5"}

#: Relative paths inside the manifest are resolved against the manifest's own
#: directory by ``ManifestIndex`` (see dataset/manifest.py), i.e. demo-data/.
DEMO_DIR_NAME = "demo-data"


def strip_query(url: str) -> str:
    """``/demo-data/ct/.../IM0?dcm=1`` -> ``ct/.../IM0``.

    The query parameters are decode hints for the *browser* decoder on the
    Cloudflare build. The desktop app keys off the manifest's own ``kind``
    field instead, so the parameters are dropped and the file is referenced
    by its real name relative to ``demo-data/``.
    """
    rel = url.split("?", 1)[0]
    if rel.startswith("/demo-data/"):
        rel = rel[len("/demo-data/"):]
    return rel.lstrip("/")


def copy_asset(rel: str, out_data: Path) -> None:
    """Copy one committed file into the bundle at the same relative path."""
    src = DEMO_SRC / rel
    if not src.is_file():
        raise FileNotFoundError(f"demo asset missing from repo: {src}")
    dst = out_data / rel
    if dst.exists() and dst.stat().st_size == src.stat().st_size:
        return  # already copied (public-folder test mode) — skip the I/O
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def extract_volume(url: str, zip_info: dict, out_data: Path) -> str:
    """Extract the ``.nii.gz`` member from a committed STORED zip archive.

    The committed MRI volumes live inside zip archives so the Cloudflare
    Worker can serve byte ranges of them; the desktop app simply reads the
    extracted file. Returns the extracted file's path relative to demo-data/.
    """
    zip_rel = strip_query(url)
    zip_path = DEMO_SRC / zip_rel
    if not zip_path.is_file():
        raise FileNotFoundError(
            f"archive not on disk (not committed?): {zip_rel}"
        )
    with zipfile.ZipFile(zip_path) as zf:
        members = [m for m in zf.namelist() if m.endswith(".nii.gz")]
        if not members:
            raise FileNotFoundError(f"no .nii.gz member inside {zip_rel}")
        member = members[0]
        rel = f"{Path(zip_rel).parent}/{Path(member).name}"
        dst = out_data / rel
        if not (dst.exists() and dst.stat().st_size == zf.getinfo(member).file_size):
            dst.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
    return rel


def build_series(study: dict, out_data: Path,
                 skipped: list[str]) -> list[dict]:
    """Build desktop-manifest series entries for one demo study.

    Mirrors the wire shapes already read by ``Series.from_dict`` /
    ``ImageRef.from_dict`` / ``FrameRun.from_dict`` in the desktop app — the
    same fields, the same names, relative ``absPath`` values.
    """
    out: list[dict] = []

    for s in study.get("series", []):
        kind = s.get("kind", "raster")
        orientation = s.get("orientation", "Unknown")
        n = int(s.get("n", 0))

        base = {
            "id": s.get("id", ""),
            "label": s.get("label", ""),
            "modality": study.get("modality", ""),
            "orientation": orientation,
            "sliceCount": n,
        }

        try:
            if kind in ("dicom", "raster"):
                files = [strip_query(u) for u in (s.get("files") or [])]
                if not files:
                    skipped.append(f"{s.get('id')}: no files")
                    continue
                images = []
                for i, rel in enumerate(files):
                    copy_asset(rel, out_data)
                    ref = {
                        "id": f"{s.get('id')}-{i}",
                        "index": i,
                        "kind": kind,
                        "absPath": rel,
                        "orientation": orientation,
                    }
                    if s.get("w"):
                        ref["width"] = s["w"]
                        ref["height"] = s["h"]
                    images.append(ref)
                out.append({**base, "images": images})

            elif kind == "nifti":
                vol_key = s.get("vol", "")
                vol = (study.get("volumes") or {}).get(vol_key)
                if vol is None:
                    skipped.append(f"{s.get('id')}: volume {vol_key!r} not in index")
                    continue
                if "zip" in vol:
                    rel = extract_volume(vol.get("url", ""), vol["zip"], out_data)
                else:
                    rel = strip_query(vol.get("url", ""))
                    copy_asset(rel, out_data)
                frames = {
                    "kind": "nifti",
                    "absPath": rel,
                    "count": n,
                    "orientation": orientation,
                }
                if s.get("w"):
                    frames["width"] = s["w"]
                    frames["height"] = s["h"]
                out.append({**base, "images": [], "frames": frames})
        except FileNotFoundError as exc:
            # A single missing asset (e.g. a DICOM instance never committed)
            # must not kill the whole bundle: drop this series, keep the rest.
            skipped.append(f"{s.get('id')}: {exc}")
            continue

    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Assemble the portable Meridian demo-data folder."
    )
    parser.add_argument(
        "--out",
        default=str(HERE / "dist" / "VedhMedicalImaging"),
        help="bundle folder that will contain demo-data/ "
             "(default: desktop/dist/VedhMedicalImaging)",
    )
    parser.add_argument(
        "--only",
        default="",
        help="optional comma list of modalities to include (PET,MRI,CT,X-Ray); "
             "default: all",
    )
    args = parser.parse_args()

    out = Path(args.out).resolve()
    out_data = out / DEMO_DIR_NAME
    only = {m.strip() for m in args.only.split(",") if m.strip()}

    if not DEMO_INDEX.is_file():
        raise SystemExit(f"demo index not found: {DEMO_INDEX}")
    with open(DEMO_INDEX, "r", encoding="utf-8") as f:
        index = json.load(f)
    if index.get("version") != 1:
        raise SystemExit(
            f"unsupported demo index version {index.get('version')!r} — "
            "this generator matches version 1 (lib/demo/types.ts)."
        )

    studies_src = index.get("studies", [])
    print(f"Demo index: {len(studies_src)} studies, "
          f"built {index.get('generatedAt', '?')}")

    # Never rmtree the committed public folder — test mode only adds files.
    same_place = out_data.resolve() == DEMO_SRC.resolve()
    if out_data.exists() and not same_place:
        shutil.rmtree(out_data)
    out_data.mkdir(parents=True, exist_ok=True)
    if same_place:
        print("NOTE: writing into public/demo-data (test mode) — "
              "existing files preserved, only manifest.json + extracted "
              "MRI volumes are written.")

    studies = []
    skipped: list[str] = []

    for study in studies_src:
        srcid = study.get("srcId", "")
        modality = study.get("modality", "")
        if only and modality not in only:
            print(f"  - skip {srcid} (modality filter)")
            continue
        if srcid in NOT_COMMITTED:
            print(f"  - skip {srcid} (archive not committed to Git)")
            continue

        series = build_series(study, out_data, skipped)
        if not series:
            print(f"  ! {srcid}: no usable series, left out of the bundle")
            continue

        entry = {
            "id": study.get("id", ""),
            "dataset": study.get("dataset", ""),
            "studyCode": study.get("code", ""),
            "sourceStudyId": srcid,
            "patientAlias": study.get("alias", ""),
            "modality": modality,
            "bodyRegion": study.get("bodyRegion", ""),
            "date": study.get("date", ""),
            "series": series,
            "volumes": {},
            "report": study.get("report"),   # verbatim, never rewritten
            "aiFindings": [],
        }
        for k in ("age", "sex", "weightKg"):
            if study.get(k) is not None:
                entry[k] = study[k]

        studies.append(entry)
        print(f"  + {entry['studyCode']} ({modality}, {len(series)} series)")

    manifest = {
        "builderVersion": 4,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scanRoot": DEMO_DIR_NAME,   # marker: relative-rooted demo bundle
        "issues": skipped,
        "studies": studies,
    }

    manifest_path = out_data / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)

    # Presenter instructions — the only file other than the exe they must see.
    readme = out / "README.txt"
    if not same_place:
        readme.write_text(
            "Vedh Medical Imaging - portable demo\n"
            "===================================\n"
            "\n"
            "RUN:     double-click VedhMedicalImaging.exe\n"
            "\n"
            "First launch may take a few seconds. Windows SmartScreen may warn\n"
            "on an unsigned build - click 'More info' then 'Run anyway'.\n"
            "\n"
            "WHAT YOU GET\n"
            "  Study list on the left - real studies with real reports:\n"
            f"    {len(studies)} studies across "
            f"{sorted({s.get('modality') for s in studies})}.\n"
            "  Click a study: the image viewer opens with the patient's real\n"
            "  images. The Report tab shows the matching real report.\n"
            "\n"
            "IN THE VIEWER\n"
            "  Axial / Coronal / Sagittal  - switch anatomical plane\n"
            "  mouse wheel                 - scroll slices\n"
            "  W/L tool drag               - adjust window/level\n"
            "  Measure / Line tools        - measurements in mm\n"
            "\n"
            "FOLDERS (do not delete)\n"
            "  demo-data\\  the studies and their reports (never edit)\n"
            "  _internal\\  the packaged application runtime (never edit)\n"
            "\n"
            "Everything runs locally. No internet, no login, no installation.\n"
            "\n"
            "This software is a demonstration only. Reports are AI-assisted\n"
            "and require review and approval by a licensed radiologist before\n"
            "any clinical use.\n",
            encoding="utf-8",
        )

    print(f"\nManifest: {manifest_path}")
    print(f"Studies in bundle: {len(studies)}")
    if skipped:
        print(f"Skipped series/notes: {len(skipped)}")
        for note in skipped[:20]:
            print(f"  · {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())