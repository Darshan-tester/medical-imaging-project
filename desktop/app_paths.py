"""Portable path resolution for the Vedh Medical Imaging desktop application.

Every directory the application uses is derived from the directory the
executable lives in.  Nothing here may contain a developer machine path: the
delivered folder is copied to another Windows PC and must work unchanged.

Frozen layout (what the CEO receives)::

    Vedh-Medical-Imaging/
      VedhMedicalImaging.exe      <- sys.executable, BASE_DIR is its parent
      runtime/                    <- PyInstaller --contents-directory
      assets/
      models/
      dataset/                    <- CT/ MRI/ PET/ X-Ray/ Ultrasound/
      index/                      <- studies.db, manifest.json
      cache/
      logs/

Source layout (running ``python desktop/main.py`` from the repo) uses this
file's own directory as BASE_DIR, so ``desktop/dataset``, ``desktop/index`` …
For development only, MERIDIAN_DESKTOP_HOME may point BASE_DIR somewhere else
so a 13 GB dataset does not have to sit inside the git repo.  A frozen build
ignores that variable completely - the shipped application is beside-the-EXE
and nothing else.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Vedh Medical Imaging"
APP_ORG = "Meridian"
APP_TITLE = "Meridian / Vedh Medical Imaging"
EXE_NAME = "VedhMedicalImaging"

#: Top-level folder names inside ``dataset/``.  The delivered dataset mirrors
#: the source tree's own layout rather than being re-sorted by modality, so that
#: a delivered folder can be compared against the source directly and nothing is
#: renamed on the way.  ``_mri`` is the one exception: those volumes are unpacked
#: by the web indexer into its own cache, outside the scan root, so they are
#: re-rooted here.  ``build_index.py`` writes the index in these same terms.
DATASET_DIRS = ("02_CT", "06_PET", "ROCOv2", "_integration", "_mri")


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _base_dir() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    override = os.environ.get("MERIDIAN_DESKTOP_HOME")
    if override:
        return Path(override).expanduser().resolve()
    return Path(__file__).resolve().parent


BASE_DIR: Path = _base_dir()
RUNTIME_DIR: Path = BASE_DIR / "runtime"
ASSET_DIR: Path = BASE_DIR / "assets"
MODEL_DIR: Path = BASE_DIR / "models"
DATA_DIR: Path = BASE_DIR / "dataset"
INDEX_DIR: Path = BASE_DIR / "index"
CACHE_DIR: Path = BASE_DIR / "cache"
LOG_DIR: Path = BASE_DIR / "logs"

DB_PATH: Path = INDEX_DIR / "studies.db"
BUILD_INFO_PATH: Path = INDEX_DIR / "manifest.json"
VERSION_PATH: Path = BASE_DIR / "VERSION"

#: Directories the application may create at startup.  ``dataset`` is *not*
#: here: if it is missing that is a packaging fault the user must see, not
#: something to paper over with an empty folder.
WRITABLE_DIRS = (INDEX_DIR, CACHE_DIR, LOG_DIR)


def ensure_writable_dirs() -> None:
    for path in WRITABLE_DIRS:
        path.mkdir(parents=True, exist_ok=True)


def app_version() -> str:
    try:
        text = VERSION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return "unknown"
    return text.splitlines()[0].strip() if text else "unknown"


#: ``DATA_DIR`` with symlinks and ``..`` already collapsed.  Resolved once, at
#: import, because it cannot change while the process runs and because
#: ``Path.resolve()`` is a syscall per path component - on a network or virtual
#: filesystem that measured ~27 ms, which is more than a whole frame's budget
#: and was being spent again on every single path the viewer asked for.
DATA_ROOT: Path = DATA_DIR.resolve()


def resolve_data(relative: str) -> Path:
    """Resolve an index-relative data path to an absolute file path.

    The index stores every pixel source as a path relative to ``dataset/`` with
    forward slashes.  Resolution is containment-checked so a malformed index
    can never read outside the delivered dataset folder.

    The candidate still has to be resolved for the check to mean anything - a
    recorded ``../`` or a symlink is exactly what is being guarded against - so
    this stays the expensive call it is.  Callers on the frame path are expected
    to consult their cache before asking for a path, not after.
    """
    if not relative:
        raise ValueError("empty data path")
    cleaned = str(relative).replace("\\", "/").lstrip("/")
    candidate = (DATA_DIR / cleaned).resolve()
    if candidate != DATA_ROOT and DATA_ROOT not in candidate.parents:
        raise ValueError(f"data path escapes the dataset folder: {relative}")
    return candidate


def describe() -> dict[str, str]:
    """Everything the Settings page shows about where the app is running."""
    return {
        "application": APP_TITLE,
        "version": app_version(),
        "frozen": "yes" if is_frozen() else "no (running from source)",
        "base": str(BASE_DIR),
        "dataset": str(DATA_DIR),
        "index": str(DB_PATH),
        "cache": str(CACHE_DIR),
        "logs": str(LOG_DIR),
        "python": sys.version.split()[0],
    }
