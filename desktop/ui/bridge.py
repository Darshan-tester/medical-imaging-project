"""The one place worker threads and the Qt main thread meet.

``core.cache.Prefetcher`` runs plain Python threads and calls back from them.
Qt widgets may only be touched from the thread that owns them, so every result
crosses into the GUI thread here, through a signal: a signal emitted from a
non-Qt thread to a receiver living in the main thread is delivered by Qt's event
loop, which is the one sanctioned way across.  ``Prefetcher``'s own docstring
puts the obligation here - "that is one line with a Qt signal" - and this is that
line.

The bridge also owns the objects that must outlive any one page: the index
connection, the loader and its memoised path resolutions, and the worker pool.
Pages come and go as the reader navigates; those do not.
"""

from __future__ import annotations

import numpy as np
from PySide6.QtCore import QObject, Signal
from PySide6.QtGui import QImage

from core.cache import PlanStats, Prefetcher
from core.db import Index, SeriesRow, StudyDetail
from core.imaging.render import RenderedFrame
from core.loader import FrameLoad, Loader
from core.log import log


def to_qimage(frame: RenderedFrame | None) -> QImage | None:
    """A ``RenderedFrame`` as something Qt can paint.

    Two paths, because ``core`` produces two things.  The decoded kinds hand over
    an 8-bit greyscale numpy array, which becomes an **indexed** image rather than
    a ``Format_Grayscale8`` one: an indexed image carries a 256-entry colour
    table, so the window/level control is a table swap instead of a pixel pass
    (see ``ui.lut``).  ``raster`` hands over the source JPEG or PNG bytes
    untouched, and Qt decodes those itself.

    The array is copied.  Not copying would be faster and wrong: the buffer
    belongs to the frame cache, whose LRU is free to evict it at any moment,
    and a ``QImage`` that borrows an evicted buffer is a use-after-free.  At the
    1024 px cap one frame is at most 1 MiB, so the copy costs tens of
    microseconds against a decode measured in tens of milliseconds.
    """
    if frame is None:
        return None
    if frame.gray is not None:
        pixels = frame.gray.pixels
        if pixels.dtype != np.uint8:  # defensive: core guarantees uint8
            pixels = pixels.astype(np.uint8, copy=False)
        # QImage needs each row contiguous with a known stride; a reslice can
        # hand back a view that is neither.
        pixels = np.ascontiguousarray(pixels)
        height, width = pixels.shape[0], pixels.shape[1]
        image = QImage(pixels.data, width, height, width,
                       QImage.Format.Format_Indexed8).copy()
        image.setColorTable([0xFF000000 | (v << 16) | (v << 8) | v
                             for v in range(256)])
        return image
    if frame.data:
        image = QImage()
        if image.loadFromData(frame.data):
            return image
        log.warning("bridge: Qt could not decode %s bytes of %s",
                    len(frame.data), frame.content_type)
    return None


class FrameBridge(QObject):
    """Owns the index, the loader and the worker pool for the whole session."""

    #: A frame the viewer asked for has finished decoding.  Arguments are the
    #: cache key and the ``FrameLoad``; the key is what lets a widget ignore a
    #: frame the reader has already scrolled past.
    frameReady = Signal(str, object)
    #: The same, for the filmstrip.  Separate because the strip scrolls
    #: independently and at a different size, so neither side has to sift the
    #: other's traffic out of its own.
    thumbReady = Signal(str, object)

    def __init__(self, index: Index, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._index = index
        self._loader = Loader(index)
        self._prefetch = Prefetcher(self._loader)
        self._prefetch.start()
        self._alive = True

    # ------------------------------------------------------------------ access

    @property
    def index(self) -> Index:
        return self._index

    @property
    def loader(self) -> Loader:
        return self._loader

    @property
    def prefetcher(self) -> Prefetcher:
        return self._prefetch

    def stats(self) -> dict:
        return self._prefetch.stats()

    # ------------------------------------------------------------------ frames

    def focus(self, detail: StudyDetail, series: SeriesRow, index: int,
              max_edge: int | None = None) -> PlanStats:
        """Point the plan at a slice; ``frameReady`` follows if it was cold."""
        return self._prefetch.focus(detail, series, index, max_edge,
                                    on_frame=self._emit_frame)

    def strip(self, detail: StudyDetail, series: SeriesRow,
              indices: list[int] | tuple[int, ...], max_edge: int) -> PlanStats:
        return self._prefetch.strip(detail, series, indices, max_edge,
                                    on_frame=self._emit_thumb)

    def peek(self, series: SeriesRow, index: int,
             max_edge: int | None = None) -> FrameLoad | None:
        """A cache-only read, for painting without waiting for anything.

        Straight through to the loader, which needs no ``StudyDetail`` for this:
        the key is computable from the series row alone, so the answer costs a
        string join and a dict lookup and is safe on the UI thread.
        """
        return self._loader.peek(series, index, max_edge)

    # ------------------------------------------------------------- thread hop
    def _emit_frame(self, load: FrameLoad) -> None:
        """Called on a worker thread.  Does one thing, and that thing is legal.

        A signal emission is queued to the receiver's thread by Qt, so nothing
        here touches a widget.  ``_alive`` is checked because shutdown tears the
        pool down after the window is gone, and a queued emit onto a deleted
        receiver is a crash the CEO would see as the app closing badly.
        """
        if not self._alive:
            return
        try:
            self.frameReady.emit(load.key, load)
        except RuntimeError:  # receiver already deleted during shutdown
            log.debug("bridge: frameReady dropped, receiver gone")

    def _emit_thumb(self, load: FrameLoad) -> None:
        if not self._alive:
            return
        try:
            self.thumbReady.emit(load.key, load)
        except RuntimeError:
            log.debug("bridge: thumbReady dropped, receiver gone")

    # ---------------------------------------------------------------- shutdown

    def shutdown(self) -> None:
        """Stop accepting work, then stop the pool.  Safe to call twice."""
        if not self._alive:
            return
        self._alive = False
        try:
            self._prefetch.stop()
        except Exception:  # noqa: BLE001 - shutdown must not raise
            log.exception("bridge: prefetcher stop failed")
        try:
            self._index.close()
        except Exception:  # noqa: BLE001
            log.exception("bridge: index close failed")


