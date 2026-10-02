"""
Desktop configuration.

The desktop app reads the SAME manifest the web app's `npm run dataset:index`
produces (`.scanlab/manifest.json`), so image/report pairing is never
duplicated. The dataset root itself (e.g. D:\\ScanLab_Datasets) is only needed
to resolve paths that moved, or to build a fresh manifest.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "Meridian"
APP_ORG = "VedhAILabs"

DEFAULT_DATA_ROOT = os.environ.get("SCANLAB_DATA_ROOT", "")


def _user_config_dir() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get(
        "XDG_CONFIG_HOME", str(Path.home() / ".config")
    )
    d = Path(base) / APP_ORG / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


@dataclass
class Settings:
    """Persistent user settings (data root, window state)."""

    data_root: str = ""
    manifest_path: str = ""
    window_geometry: str = ""
    maximized: bool = True

    def to_dict(self) -> dict:
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, d: dict) -> "Settings":
        s = cls()
        for k, v in d.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s


class Config:
    def __init__(self) -> None:
        self.settings_file = _user_config_dir() / "settings.json"
        self.settings = Settings()
        self._load()

    # -- persistence --------------------------------------------------------
    def _load(self) -> None:
        try:
            if self.settings_file.exists():
                self.settings = Settings.from_dict(
                    json.loads(self.settings_file.read_text(encoding="utf-8"))
                )
        except Exception:
            self.settings = Settings()

    def save(self) -> None:
        try:
            self.settings_file.write_text(
                json.dumps(self.settings.to_dict(), indent=2), encoding="utf-8"
            )
        except Exception:
            pass

    # -- paths ---------------------------------------------------------------
    def data_root(self) -> str:
        return self.settings.data_root or DEFAULT_DATA_ROOT

    @staticmethod
    def _portable_demo_manifest() -> str:
        """Manifest shipped inside a portable demo bundle.

        Layout beside the frozen exe::

            Vedh-Medical-Imaging-Demo/
              VedhMedicalImaging.exe
              demo-data/manifest.json   <- paths RELATIVE to demo-data/,
                                          never absolute Windows paths
              demo-data/pet/...         <- the actual images

        Paths inside it are relative to the manifest's own folder, so the same
        bundle works on any machine, from any location, with no
        ``SCANLAB_DATA_ROOT``. ManifestIndex resolves them at load time.
        """
        # Explicit override wins everywhere.
        env = os.environ.get("MERIDIAN_DEMO_MANIFEST")
        if env and Path(env).is_file():
            return env

        if getattr(sys, "frozen", False):
            # dist/VedhMedicalImaging/VedhMedicalImaging.exe ->
            # demo-data sits beside the exe.
            base = Path(sys.executable).resolve().parent
            candidate = base / "demo-data" / "manifest.json"
            if candidate.exists():
                return str(candidate)
            return ""

        # Source checkout (development): the bundle the generator produced.
        # Checking this BEFORE public/demo-data matters: the dev bundle lives
        # in gitignored desktop/dist/, while files written into public/ would
        # ship with the next Cloudflare deploy.
        here = Path(__file__).resolve()
        dev = here.parent / "dist" / "VedhMedicalImaging" / "demo-data" / "manifest.json"
        if dev.is_file():
            return str(dev)

        # Last resort: a test-mode manifest written into public/demo-data
        # (gitignored outputs only — see build_demo_bundle.py's note).
        for parent in here.parents:
            candidate = parent / "public" / "demo-data" / "manifest.json"
            if candidate.exists():
                return str(candidate)
        return ""

    def manifest_path(self) -> str:
        # 1. A saved explicit setting always wins — the Settings dialog and
        #    existing installs rely on it.
        if self.settings.manifest_path:
            return self.settings.manifest_path
        # 2. The full local dataset (existing workflow, untouched).
        root = self.data_root()
        if root:
            candidate = Path(root).parent / ".scanlab" / "manifest.json"
            if candidate.exists():
                return str(candidate)
        # 3. The portable demo bundle — needs no configuration at all, so a
        #    clean demo PC with neither setting nor dataset finds it.
        portable = self._portable_demo_manifest()
        if portable:
            return portable
        # 4. Repo-checkout fallback (web project's manifest).
        here = Path(__file__).resolve()
        for parent in here.parents:
            candidate = parent / ".scanlab" / "manifest.json"
            if candidate.exists():
                return str(candidate)
        return ""