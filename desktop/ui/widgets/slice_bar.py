"""Slice navigation and cine, the port of ``SliceNavigator.tsx``.

Two things here are worth stating because they are easy to get wrong and the web
component already got them right:

* **Cine is gated on readiness.**  The web loop advances only when
  ``t - last > FRAME_MS / speed && ready``, where ``ready`` means the current
  frame has actually arrived.  A timer that advances regardless would race ahead
  of the decoder on a 443-slice CT, so the reader would see every third slice and
  a stutter, having asked for a smooth loop.  Here the same gate is a timer that
  skips its tick instead of advancing.
* **Manual stepping does not wrap; cine does.**  ``next()`` at the last slice is
  a no-op, because a reader stepping through a stack and landing back at slice 1
  has lost their place.  Cine wraps, because a loop that stops at the end is not
  a loop.

The bar hides itself for single-image studies, which is ``total <= 1 ? null`` in
the web component - a play button on a chest radiograph is noise.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (QHBoxLayout, QLabel, QSlider, QToolButton,
                               QWidget)

#: ``SPEEDS`` and ``FRAME_MS`` from ``SliceNavigator.tsx``.  90 ms is ~11 fps at
#: 1x, which is the rate the web app cines at.
SPEEDS: tuple[float, ...] = (0.5, 1.0, 1.5, 2.0)
FRAME_MS = 90


class SliceBar(QWidget):
    """Prev / play / next, a scrubber, and the ``orientation · n/total`` label."""

    #: The reader wants this slice index (0-based).  Emitted for button steps,
    #: scrubbing and cine alike, so the page has one place to load from.
    indexChanged = Signal(int)
    #: Cine started or stopped, so the page can widen the prefetch window.
    cineToggled = Signal(bool)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._total = 0
        self._index = 0
        self._orientation = ""
        self._ready = True
        self._speed_at = 1  # SPEEDS[1] == 1.0
        self._syncing = False
        self._timer = QTimer(self)
        self._timer.setTimerType(Qt.TimerType.PreciseTimer)
        self._timer.timeout.connect(self._tick)

        self._prev = QToolButton(self)
        self._prev.setText("◀")
        self._prev.setToolTip("Previous slice (Left)")
        self._prev.clicked.connect(lambda: self.step(-1))
        self._play = QToolButton(self)
        self._play.setText("Play")
        self._play.setCheckable(True)
        self._play.setToolTip("Cine (Space)")
        self._play.toggled.connect(self.set_playing)
        self._next = QToolButton(self)
        self._next.setText("▶")
        self._next.setToolTip("Next slice (Right)")
        self._next.clicked.connect(lambda: self.step(1))

        self._slider = QSlider(Qt.Orientation.Horizontal, self)
        self._slider.setMinimum(0)
        self._slider.setSingleStep(1)
        self._slider.setPageStep(10)
        self._slider.setTracking(True)
        self._slider.valueChanged.connect(self._slider_moved)

        self._speed = QToolButton(self)
        self._speed.setToolTip("Cine speed")
        self._speed.clicked.connect(self._cycle_speed)
        self._label = QLabel("", self)
        # Mono, because this is a counter: proportional digits make the number
        # jitter sideways as it counts through a 443-slice stack.
        self._label.setProperty("role", "mono")

        self._label.setMinimumWidth(150)
        self._label.setAlignment(Qt.AlignmentFlag.AlignRight
                                 | Qt.AlignmentFlag.AlignVCenter)

        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(6)
        for widget in (self._prev, self._play, self._next):
            row.addWidget(widget)
        row.addWidget(self._slider, 1)
        row.addWidget(self._speed)
        row.addWidget(self._label)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self._sync_speed()
        self._sync()

    # ------------------------------------------------------------------- state

    @property
    def total(self) -> int:
        return self._total

    @property
    def index(self) -> int:
        return self._index

    @property
    def playing(self) -> bool:
        return self._timer.isActive()

    @property
    def speed(self) -> float:
        return SPEEDS[self._speed_at]

    def set_series(self, total: int, orientation: str = "", index: int = 0) -> None:
        """Point the bar at a new series, which stops any cine in flight.

        Cine is stopped rather than carried over because the new series may be a
        different length; a loop that keeps running across a series change is
        playing one stack at another stack's index.
        """
        self.set_playing(False)
        self._total = max(0, int(total))
        self._orientation = orientation
        self._index = min(max(0, int(index)), max(0, self._total - 1))
        self._ready = True
        self._sync()

    def set_index(self, index: int) -> None:
        """Follow the page's current index without emitting a request back."""
        if self._total <= 0:
            return
        value = min(max(0, int(index)), self._total - 1)
        if value == self._index:
            return
        self._index = value
        self._sync()

    def set_ready(self, ready: bool) -> None:
        """Whether the current slice has arrived.

        This is the ``ready`` flag of the web cine loop and the only backpressure
        in the playback path: while it is false the timer keeps ticking and
        refuses to advance, so cine runs at whatever rate the decoder can
        actually sustain instead of skipping frames to keep a schedule.
        """
        if self._ready != ready:
            self._ready = ready
            self._sync_label()

    # -------------------------------------------------------------- navigation

    def step(self, delta: int) -> None:
        """Manual stepping, which clamps rather than wraps.

        ``SliceNavigator.tsx``: ``Math.min(total - 1, Math.max(0, current + d))``.
        Stopping at the ends is the point - a reader at the last slice who lands
        on the first has lost their place in the stack.
        """
        if self._total <= 0:
            return
        target = min(self._total - 1, max(0, self._index + int(delta)))
        if target == self._index:
            return
        self._index = target
        self._sync()
        self.indexChanged.emit(target)

    def set_playing(self, playing: bool) -> None:
        """Start or stop cine.  Idempotent, because the toggle has two sources."""
        if playing and self._total > 1:
            if not self._timer.isActive():
                self._timer.start(self._interval_ms())
                self._sync_play_button(True)
                self.cineToggled.emit(True)
            return
        if self._timer.isActive():
            self._timer.stop()
            self._sync_play_button(False)
            self.cineToggled.emit(False)
        else:
            self._sync_play_button(False)

    def toggle_playing(self) -> None:
        self.set_playing(not self.playing)

    def _tick(self) -> None:
        """One cine tick: advance if the current slice arrived, else wait.

        ``_ready`` is cleared *before* the signal goes out, because a cache hit
        makes the page's handler run inside this call and set it back to true
        synchronously.  Clearing it afterwards would undo that and stall the loop
        on exactly the frames that were fast.
        """
        if self._total <= 1:
            self.set_playing(False)
            return
        if not self._ready:
            return
        target = (self._index + 1) % self._total
        self._index = target
        self._ready = False
        self._sync()
        self.indexChanged.emit(target)

    def _interval_ms(self) -> int:
        return max(16, int(round(FRAME_MS / self.speed)))

    def _cycle_speed(self) -> None:
        self._speed_at = (self._speed_at + 1) % len(SPEEDS)
        self._sync_speed()
        if self._timer.isActive():
            self._timer.start(self._interval_ms())

    def _slider_moved(self, value: int) -> None:
        if self._syncing or self._total <= 0:
            return
        self._index = min(max(0, int(value)), self._total - 1)
        self._ready = False
        self._sync_label()
        self._sync_buttons()
        self.indexChanged.emit(self._index)

    # ------------------------------------------------------------------- sync

    def _sync(self) -> None:
        self.setVisible(self._total > 1)
        self._syncing = True
        self._slider.setMaximum(max(0, self._total - 1))
        self._slider.setValue(self._index)
        self._syncing = False
        self._sync_buttons()
        self._sync_label()

    def _sync_buttons(self) -> None:
        self._prev.setEnabled(self._index > 0)
        self._next.setEnabled(self._index + 1 < self._total)
        self._play.setEnabled(self._total > 1)

    def _sync_label(self) -> None:
        if self._total <= 0:
            self._label.setText("")
            return
        counter = f"{self._index + 1}/{self._total}"
        text = f"{self._orientation} · {counter}" if self._orientation else counter
        if self._timer.isActive() and not self._ready:
            # Saying so is better than a silent stall: the reader can see that
            # cine is waiting on a decode rather than that it has stopped.
            text = f"{text} · buffering"
        self._label.setText(text)

    def _sync_play_button(self, playing: bool) -> None:
        self._play.blockSignals(True)
        self._play.setChecked(playing)
        self._play.setText("Pause" if playing else "Play")
        self._play.blockSignals(False)
        self._sync_label()

    def _sync_speed(self) -> None:
        self._speed.setText(f"{self.speed:g}x")

    def keyPressEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Space toggles cine, arrows step - the web component's own bindings."""
        key = event.key()
        if key == Qt.Key.Key_Space:
            self.toggle_playing()
        elif key in (Qt.Key.Key_Left, Qt.Key.Key_Up):
            self.step(-1)
        elif key in (Qt.Key.Key_Right, Qt.Key.Key_Down):
            self.step(1)
        else:
            super().keyPressEvent(event)
            return
        event.accept()
