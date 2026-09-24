"""Window width / level panel: sliders, numeric inputs, presets, reset.

Replaces the toolbar's 20-point cycling buttons as the primary W/L control (the
cycle buttons stay on the toolbar for quick nudges).  The numbers are the
display-transfer percentages from ``ui.lut`` — brightness and contrast on the
already-windowed 8-bit frame — not DICOM window width/center, because
``core.imaging`` bakes the modality's own window in at decode time and the cache
is keyed on that.  Re-decoding on a slider drag would miss the frame cache and
turn a 0.04 ms scroll step into a volume rebuild, so this panel drives the same
LUT swap the toolbar does.

"Apply to linked panes" forwards the same (brightness, contrast, inverted) triple
to every 2-D pane of the open study, which is what readers expect in MPR: a
window is a property of the display, not of one plane.
"""

from __future__ import annotations

from dataclasses import replace

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QDoubleSpinBox, QGridLayout, QHBoxLayout,
                               QLabel, QPushButton, QSlider, QVBoxLayout, QWidget)

from .. import lut as lut_mod
from .frame_view import ViewState

#: (label, brightness, contrast) in lut-percentage terms.  These presets are
#: display shortcuts, not clinical protocols; the modality's own DICOM window is
#: still what the decode baked in, and "Reset" returns to exactly that.
PRESETS: tuple[tuple[str, int, int], ...] = (
    ("Default", lut_mod.NEUTRAL, lut_mod.NEUTRAL),
    ("Soft", 115, 80),
    ("Detail", 100, 140),
    ("Bright", 135, 100),
    ("Dark", 70, 100),
)

BRIGHT_RANGE = (10, 200)
CONTRAST_RANGE = (10, 300)


class WindowLevelPanel(QWidget):
    """Sliders + numeric inputs + presets, emitting a whole ``ViewState``."""

    viewChanged = Signal(object)      # ViewState
    #: (brightness, contrast, inverted) for linked panes.
    wlApplied = Signal(int, int, bool)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._view = ViewState()
        self._syncing = False

        column = QVBoxLayout(self)
        column.setContentsMargins(8, 8, 8, 8)
        column.setSpacing(6)

        title = QLabel("Brightness / window level", self)
        title.setProperty("role", "label")
        column.addWidget(title)

        grid = QGridLayout()
        grid.setVerticalSpacing(4)
        self._sliders: dict[str, QSlider] = {}
        self._spins: dict[str, QDoubleSpinBox] = {}

        for row, (name, label, lo, hi) in enumerate((
                ("brightness", "Brightness", *BRIGHT_RANGE),
                ("contrast", "Contrast", *CONTRAST_RANGE))):
            grid.addWidget(QLabel(label, self), row, 0)
            slider = QSlider(Qt.Orientation.Horizontal, self)
            slider.setRange(lo, hi)
            self._sliders[name] = slider
            grid.addWidget(slider, row, 1)
            spin = QDoubleSpinBox(self)
            spin.setRange(lo, hi)
            spin.setDecimals(0)
            spin.setSuffix("%")
            self._spins[name] = spin
            grid.addWidget(spin, row, 2)
            slider.valueChanged.connect(
                lambda v, n=name: self._from_widget(n, int(v)))
            spin.valueChanged.connect(
                lambda v, n=name: self._from_widget(n, int(v)))
        column.addLayout(grid)

        self._invert = QCheckBox("Invert grayscale", self)
        self._invert.toggled.connect(self._emit)
        column.addWidget(self._invert)

        self._linked = QCheckBox("Apply to linked panes", self)
        self._linked.setChecked(True)
        column.addWidget(self._linked)

        preset_row = QHBoxLayout()
        for label, b, c in PRESETS:
            button = QPushButton(label, self)
            button.clicked.connect(lambda _=False, bb=b, cc=c: self.set_wl(bb, cc))
            preset_row.addWidget(button)
        preset_row.addStretch(1)
        column.addLayout(preset_row)

        reset = QPushButton("Reset window/level", self)
        reset.clicked.connect(lambda: self.set_wl(lut_mod.NEUTRAL, lut_mod.NEUTRAL))
        column.addWidget(reset)
        column.addStretch(1)

        self.set_view(ViewState())

    # ------------------------------------------------------------------ state

    def set_view(self, view: ViewState) -> None:
        self._view = view
        self._sync()

    def set_wl(self, brightness: int, contrast: int, inverted: bool | None = None) -> None:
        inv = self._view.inverted if inverted is None else inverted
        self._view = replace(self._view, brightness=brightness, contrast=contrast,
                             inverted=inv)
        self._sync()
        self._emit()

    def linked(self) -> bool:
        return self._linked.isChecked()

    # ------------------------------------------------------------------ wiring

    def _from_widget(self, name: str, value: int) -> None:
        if self._syncing:
            return
        self._view = replace(self._view, **{name: value})
        self._sync()   # keep slider/spin pairs agreeing
        self._emit()

    def _emit(self) -> None:
        if self._syncing:
            return
        self.viewChanged.emit(self._view)
        self.wlApplied.emit(self._view.brightness, self._view.contrast,
                            self._view.inverted)

    def _sync(self) -> None:
        self._syncing = True
        try:
            self._sliders["brightness"].setValue(self._view.brightness)
            self._sliders["contrast"].setValue(self._view.contrast)
            self._spins["brightness"].setValue(self._view.brightness)
            self._spins["contrast"].setValue(self._view.contrast)
            self._invert.setChecked(self._view.inverted)
        finally:
            self._syncing = False