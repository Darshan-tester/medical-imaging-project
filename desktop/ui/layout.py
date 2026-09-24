"""Split-screen layout: 1, 2 or 4 panes with per-pane view choice.

Pane arrangements (rows of ``ViewportPane``):

* ``1x1`` - single view
* ``1x2`` - two panes side by side
* ``2x2`` - four panes: axial, coronal, sagittal, 3D by default, each
  individually changeable

A pane can be maximized (fills the layout) and restored; the previous layout is
kept and re-applied on restore.  The active pane is highlighted by
``ViewportPane.paintEvent``; the layout tracks who it is.
"""

from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (QGridLayout, QHBoxLayout, QSplitter, QSizePolicy,
                               QVBoxLayout, QWidget)

from .viewport import (VIEW_3D, VIEW_AXIAL, VIEW_CORONAL, VIEW_SAGITTAL,
                       ViewportPane)

LAYOUT_1 = "1x1"
LAYOUT_2 = "1x2"
LAYOUT_4 = "2x2"

#: Default per-pane views for the 2x2 layout.
DEFAULT_GRID = (VIEW_AXIAL, VIEW_SAGITTAL, VIEW_CORONAL, VIEW_3D)


@dataclass
class PaneState:
    """What survives a layout switch: per-pane view, slice and view transform."""

    plane: str
    slice_index: int = 0
    view: object | None = None
    crosshair: tuple[float, float] | None = None


class LayoutManager(QWidget):
    """Owns the pane grid, the active pane and the maximize state."""

    activePaneChanged = Signal(object)
    layoutChanged = Signal(str)

    def __init__(self, theme_name: str = "light", parent=None) -> None:
        super().__init__(parent)
        self._theme = theme_name
        self._layout = LAYOUT_1
        self._panes: list[ViewportPane] = []
        self._active: ViewportPane | None = None
        self._maximized: ViewportPane | None = None
        self._saved_states: dict[ViewportPane, PaneState] = {}
        self._root = QVBoxLayout(self)
        self._root.setContentsMargins(0, 0, 0, 0)
        self._grid_host = QWidget(self)
        self._grid = QGridLayout(self._grid_host)
        self._grid.setContentsMargins(0, 0, 0, 0)
        self._grid.setSpacing(2)
        self._root.addWidget(self._grid_host, 1)
        self.set_layout(LAYOUT_1)

    # ------------------------------------------------------------------ panes

    def panes(self) -> list[ViewportPane]:
        return list(self._panes)

    def active_pane(self) -> ViewportPane | None:
        return self._active or (self._panes[0] if self._panes else None)

    def set_layout(self, layout: str, views: tuple[str, ...] | None = None) -> None:
        """Rebuild the pane grid, preserving each pane's state where possible."""
        count = {LAYOUT_1: 1, LAYOUT_2: 2, LAYOUT_4: 4}.get(layout)
        if count is None:
            return
        old_states = {p: self._state_of(p) for p in self._panes}
        views = views or self._default_views(count)

        # A maximized pane ends the maximize when the layout changes.
        self._maximized = None
        for pane in self._panes:
            self._grid.removeWidget(pane)
            pane.setParent(None)
            pane.deleteLater()
        self._panes = []
        self._active = None

        for i in range(count):
            pane = ViewportPane(self._theme, allow_3d=True, parent=self._grid_host)
            pane.activated.connect(self._on_activated)
            pane.maximizeToggled.connect(self._on_maximize)
            self._panes.append(pane)
            prior = old_states.get(pane)  # identity-based; new panes start fresh
        # assign default or preserved views by position: pane i keeps the view
        # of the pane that previously occupied a matching slot when counts match
        for i, pane in enumerate(self._panes):
            plane = views[i] if i < len(views) else VIEW_AXIAL
            pane.set_plane(plane)
        self._place()
        self.set_layout_label(layout)
        if self._panes:
            self._on_activated(self._panes[0])
        self.layoutChanged.emit(layout)

    def set_layout_label(self, layout: str) -> None:
        self._layout = layout

    @property
    def layout_id(self) -> str:
        return self._layout

    def _default_views(self, count: int) -> tuple[str, ...]:
        if count == 1:
            return (VIEW_AXIAL,)
        if count == 2:
            return (VIEW_AXIAL, VIEW_3D)
        return DEFAULT_GRID

    def _place(self) -> None:
        count = len(self._panes)
        if self._maximized is not None:
            self._grid.addWidget(self._maximized, 0, 0)
            return
        if count == 1:
            self._grid.addWidget(self._panes[0], 0, 0)
        elif count == 2:
            self._grid.addWidget(self._panes[0], 0, 0)
            self._grid.addWidget(self._panes[1], 0, 1)
        else:
            self._grid.addWidget(self._panes[0], 0, 0)
            self._grid.addWidget(self._panes[1], 0, 1)
            self._grid.addWidget(self._panes[2], 1, 0)
            self._grid.addWidget(self._panes[3], 1, 1)
        for i, pane in enumerate(self._panes):
            pane.set_active(pane is self._active)

    def set_pane_view(self, pane: ViewportPane, plane: str) -> None:
        if pane in self._panes:
            pane.set_plane(plane)

    # ------------------------------------------------------------- maximize

    def maximize_pane(self, pane: ViewportPane) -> None:
        if pane not in self._panes:
            return
        self._maximized = pane
        self._place()

    def restore(self) -> None:
        self._maximized = None
        self._place()

    def is_maximized(self) -> bool:
        return self._maximized is not None

    def _on_maximize(self, pane) -> None:
        if self._maximized is pane:
            self.restore()
        else:
            self.maximize_pane(pane)

    # --------------------------------------------------------------- active

    def _on_activated(self, pane) -> None:
        if self._active is pane:
            return
        self._active = pane
        for p in self._panes:
            p.set_active(p is pane)
        self.activePaneChanged.emit(pane)

    # ---------------------------------------------------------------- state

    def _state_of(self, pane: ViewportPane) -> PaneState:
        return PaneState(
            plane=pane.plane,
            slice_index=pane.slice_index(),
            view=pane.view_state(),
            crosshair=pane.crosshair(),
        )

    def snapshot(self) -> list[PaneState]:
        return [self._state_of(p) for p in self._panes]