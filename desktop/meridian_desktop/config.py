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

    def manifest_path(self) -> str:
        if self.settings.manifest_path:
            return self.settings.manifest_path
        root = self.data_root()
        if root:
            candidate = Path(root).parent / ".scanlab" / "manifest.json"
            if candidate.exists():
                return str(candidate)
        # Fall back to the web project's manifest (repo checkout layout).
        here = Path(__file__).resolve()
        for parent in here.parents:
            candidate = parent / ".scanlab" / "manifest.json"
            if candidate.exists():
                return str(candidate)
        return ""