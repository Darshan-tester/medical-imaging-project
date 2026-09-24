"""Application entry point.

``python desktop/main.py`` from the repo root, or the frozen executable's
``main`` module.  Fails loudly with a setup explanation when the index is
missing or of the wrong schema version - that is a packaging problem the user
must see, not a dialog-free exit.
"""

from __future__ import annotations

import sys
from pathlib import Path

# core/ and ui/ are imported as top-level packages beside this file.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from app_paths import ensure_writable_dirs, describe  # noqa: E402

ensure_writable_dirs()

from core.db import Index, IndexError_  # noqa: E402
from core.log import log  # noqa: E402
from core.annotations import AnnotationStore  # noqa: E402


def main() -> int:
    from PySide6.QtWidgets import QApplication

    app = QApplication(sys.argv)
    app.setApplicationName("Vedh Medical Imaging")
    app.setOrganizationName("Meridian")

    try:
        index = Index()
    except IndexError_ as exc:
        from PySide6.QtWidgets import QMessageBox
        log.error("startup: %s", exc)
        QMessageBox.critical(
            None, "Study index not found", str(exc))
        return 1

    from main_window import MainWindow
    store = AnnotationStore(_HERE / "index" / "annotations.json")
    window = MainWindow(index, store)
    window.show()
    log.info("startup: %s", describe())
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())