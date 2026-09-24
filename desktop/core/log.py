"""Where the application writes down what went wrong.

A windowed EXE has no console: ``print`` goes nowhere and an unhandled traceback
disappears with the process.  So every failure the UI turns into one of
``core.messages``' short sentences is also written here in full, and §22's
``logs/`` folder is what it is for.

Three properties matter more than features:

* It must never be the thing that breaks.  If ``logs/`` cannot be created or
  written - a read-only delivery folder, a network share, a locked file - logging
  degrades to doing nothing and the application carries on.
* It must be bounded.  Scrolling a 1,834-frame series can produce a message per
  frame if the dataset is damaged, so the file rotates at 1 MiB and keeps three.
* It must record *relative* dataset paths, not resolved ones.  A log the CEO
  forwards back to us should identify which file in the delivery is bad without
  also carrying the folder layout of their machine.
"""

from __future__ import annotations

import logging
import logging.handlers
import sys
from pathlib import Path

try:  # in the packaged application
    from app_paths import LOG_DIR, app_version
except ImportError:  # when core/ is imported from a checkout
    LOG_DIR = Path(__file__).resolve().parent.parent / "logs"

    def app_version() -> str:  # type: ignore[misc]
        return "source"

LOG_NAME = "vedh"
LOG_FILE = "application.log"
MAX_BYTES = 1024 * 1024
BACKUPS = 3

log = logging.getLogger(LOG_NAME)

_configured = False


def configure(level: int = logging.INFO) -> logging.Logger:
    """Attach handlers once.  Safe to call from anywhere, including twice."""
    global _configured
    if _configured:
        return log
    _configured = True
    log.setLevel(level)
    log.propagate = False

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(threadName)-14s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.handlers.RotatingFileHandler(
            LOG_DIR / LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUPS,
            encoding="utf-8", delay=True,
        )
        handler.setFormatter(fmt)
        log.addHandler(handler)
    except OSError:
        # Nowhere to write.  Fall through to stderr if there is one, and to
        # nothing at all if there is not - never raise out of configure().
        pass

    if sys.stderr is not None:
        stream = logging.StreamHandler(sys.stderr)
        stream.setFormatter(fmt)
        log.addHandler(stream)
    if not log.handlers:
        log.addHandler(logging.NullHandler())

    log.info("Vedh Medical Imaging %s starting", app_version())
    return log
