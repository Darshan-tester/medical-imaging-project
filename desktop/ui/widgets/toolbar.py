"""The viewer toolbar: the port of ``ViewerToolbar.tsx``, plus the layer toggles.

Every control here changes how the current frame is *displayed*.  None of them
re-decode it, which is why the toolbar can be this cheap: zoom and pan are a
transform, brightness/contrast/invert are a colour table, and the layer toggles
are booleans consulted at paint time.  The frame in the cache is untouched by all
of them, so nothing in this bar can cost a 24 s volume rebuild.

The web app's controls are icon buttons; PySide6 ships no icon set and inventing
one would mean shipping image assets that have to be themed, so these are short
text buttons carrying the web component's own labels as tooltips.  The labels are
kept verbatim - "Brightness / window level", not "W/L" - because those strings are
the closest thing the project has to a specification of what each control does.
"""

from __future__ import annotations

from dataclasses import replace

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (QButtonGroup, QHBoxLayout, QLabel, QMenu,
                               QToolButton, QWidget)

from .. import lut as lut_mod
from .frame_view import (DEFAULT_VIEW, LAYER_LABELS, LAYER_ORDER, TOOL_MARKER,
                         TOOL_MEASURE, TOOL_PAN, TOOL_PEN, ZOOM_STEP, ViewState)

#: ``ViewerToolbar.tsx`` cycles brightness and contrast in 20-point steps and
#: wraps at 140: ``s.x >= 140 ? 100 : s.x + 20``.  The buttons keep that
#: behaviour; the continuous control is a right-drag on the canvas.
WL_STEP = 20
WL_WRAP = 140

#: ``(tool, text, tooltip)`` for the four exclusive tools, in the web's order.
TOOLS: tuple[tuple[str, str, str], ...] = (
    (TOOL_PAN, "Pan", "Pan"),
    (TOOL_MEASURE, "Measure", "Measure"),
    (TOOL_MARKER, "Marker", "Marker"),
    (TOOL_PEN, "Pen", "Pen"),
)


class ViewerToolbar(QWidget):
    """One row of display controls over the canvas.

    Holds a copy of the current ``ViewState`` so a button can compute the next
    one, but is not the owner: the page is.  ``set_view`` never emits, which is
    what keeps toolbar and canvas from bouncing a state change back and forth.
    """

    viewChanged = Signal(object)
    fullscreenToggled = Signal(bool)
    layerToggled = Signal(str, bool)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._view = DEFAULT_VIEW
        self._syncing = False
        self._tools: dict[str, QToolButton] = {}
        self._layer_actions: dict[str, QAction] = {}

        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(6)

        self._zoom_out = self._button("−", "Zoom out", row)
        self._zoom_out.clicked.connect(lambda: self._zoom(-ZOOM_STEP))
        self._zoom_label = QLabel("100%", self)
        self._zoom_label.setProperty("role", "mono")
        self._zoom_label.setMinimumWidth(44)
        self._zoom_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        row.addWidget(self._zoom_label)
        self._zoom_in = self._button("+", "Zoom in", row)
        self._zoom_in.clicked.connect(lambda: self._zoom(ZOOM_STEP))

        row.addSpacing(8)
        group = QButtonGroup(self)
        group.setExclusive(True)
        for tool, text, tip in TOOLS:
            button = self._button(text, tip, row, checkable=True)
            button.clicked.connect(lambda _=False, t=tool: self._set_tool(t))
            group.addButton(button)
            self._tools[tool] = button
        self._tools[TOOL_PAN].setChecked(True)

        row.addSpacing(8)
        self._brightness = self._button("Brightness", "Brightness / window level",
                                        row, checkable=True)
        self._brightness.clicked.connect(self._cycle_brightness)
        self._contrast = self._button("Contrast", "Contrast", row, checkable=True)
        self._contrast.clicked.connect(self._cycle_contrast)
        self._invert = self._button("Invert", "Invert", row, checkable=True)
        self._invert.clicked.connect(self._toggle_invert)

        row.addSpacing(8)
        self._layers = self._button("Layers", "Show or hide annotation layers", row)
        self._layers.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        menu = QMenu(self._layers)
        for name in LAYER_ORDER:
            action = QAction(LAYER_LABELS[name], menu)
            action.setCheckable(True)
            action.setChecked(True)
            action.toggled.connect(
                lambda checked, n=name: self.layerToggled.emit(n, checked))
            menu.addAction(action)
            self._layer_actions[name] = action
        self._layers.setMenu(menu)

        row.addStretch(1)
        self._reset = self._button("Reset view", "Reset view", row)
        self._reset.clicked.connect(self._reset_view)
        self._fullscreen = self._button("Full screen", "Fullscreen", row,
                                        checkable=True)
        self._fullscreen.toggled.connect(self.fullscreenToggled.emit)
        self._sync()

    # ------------------------------------------------------------------ pieces

    def _button(self, text: str, tooltip: str, row: QHBoxLayout,
                checkable: bool = False) -> QToolButton:
        button = QToolButton(self)
        button.setText(text)
        button.setToolTip(tooltip)
        button.setCheckable(checkable)
        button.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        row.addWidget(button)
        return button

    # ------------------------------------------------------------------- state

    @property
    def view(self) -> ViewState:
        return self._view

    def set_view(self, view: ViewState) -> None:
        """Follow the canvas.  Never emits - see the class docstring."""
        self._view = view
        self._sync()

    def set_layer_visible(self, name: str, visible: bool) -> None:
        action = self._layer_actions.get(name)
        if action is not None and action.isChecked() != visible:
            action.blockSignals(True)
            action.setChecked(visible)
            action.blockSignals(False)

    def set_fullscreen(self, active: bool) -> None:
        if self._fullscreen.isChecked() != active:
            self._fullscreen.blockSignals(True)
            self._fullscreen.setChecked(active)
            self._fullscreen.blockSignals(False)

    # ----------------------------------------------------------------- actions

    def _emit(self, view: ViewState) -> None:
        self._view = view
        self._sync()
        self.viewChanged.emit(view)

    def _zoom(self, delta: float) -> None:
        self._emit(self._view.zoomed(delta))

    def _set_tool(self, tool: str) -> None:
        if tool != self._view.tool:
            self._emit(replace(self._view, tool=tool))

    @staticmethod
    def _next_wl(value: int) -> int:
        """``s.x >= 140 ? 100 : s.x + 20`` from the web toolbar, snapped.

        On the web the value is only ever 100, 120 or 140, so ``+ 20`` is enough.
        Here a right-drag can leave it at 137, and ``+ 20`` would then walk the
        value to 157 - outside the range the web app's controls can produce.  So
        the click moves to the next 20-point step *above* the current value and
        stops at 140, which behaves identically on the grid and sensibly off it.
        """
        if value >= WL_WRAP:
            return lut_mod.NEUTRAL
        steps = (value - lut_mod.NEUTRAL) // WL_STEP + 1
        return min(WL_WRAP, lut_mod.NEUTRAL + steps * WL_STEP)

    def _cycle_brightness(self) -> None:
        self._emit(replace(self._view,
                           brightness=self._next_wl(self._view.brightness)))

    def _cycle_contrast(self) -> None:
        self._emit(replace(self._view,
                           contrast=self._next_wl(self._view.contrast)))

    def _toggle_invert(self) -> None:
        self._emit(replace(self._view, inverted=not self._view.inverted))

    def _reset_view(self) -> None:
        self._emit(self._view.reset_view())

    # -------------------------------------------------------------------- sync

    def _sync(self) -> None:
        """Make the buttons show the state, including values a drag produced.

        The brightness and contrast buttons carry their value once they are off
        neutral - "Brightness 120%" - because after a right-drag there is no other
        way to see what the window is set to, and "some amount brighter than the
        stored frame" is not a thing to hand a radiologist.
        """
        if self._syncing:
            return
        self._syncing = True
        view = self._view
        self._zoom_label.setText(f"{round(view.zoom * 100)}%")
        for tool, button in self._tools.items():
            button.setChecked(tool == view.tool)
        self._label_value(self._brightness, "Brightness", view.brightness)
        self._label_value(self._contrast, "Contrast", view.contrast)
        self._invert.setChecked(view.inverted)
        self._syncing = False

    @staticmethod
    def _label_value(button: QToolButton, name: str, value: int) -> None:
        neutral = value == lut_mod.NEUTRAL
        button.setChecked(not neutral)
        button.setText(name if neutral else f"{name} {value}%")
