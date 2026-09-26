"""
Meridian desktop application entry point.

Run:  python -m meridian_desktop
(from the `desktop` directory, with the Python environment from requirements.txt)
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path


def _setup_logging() -> None:
    log_dir = Path.home() / ".meridian" / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
            handlers=[
                logging.FileHandler(
                    log_dir / "meridian.log",
                    encoding="utf-8"
                ),
                logging.StreamHandler(),
            ],
        )
    except Exception:
        logging.basicConfig(level=logging.INFO)


def main() -> int:
    _setup_logging()
    log = logging.getLogger("meridian")

    # Qt attribute must be set before QApplication on some platforms
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtWidgets import QApplication

    QGuiApplication.setAttribute(Qt.AA_ShareOpenGLContexts)

    app = QApplication(sys.argv)
    app.setApplicationName("Meridian")

    from .config import Config
    from .ui.main_window import WorkstationWindow

    cfg = Config()
    win = WorkstationWindow(cfg)

    if cfg.settings.maximized:
        win.showMaximized()
    else:
        win.show()

    log.info("Meridian started")
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())