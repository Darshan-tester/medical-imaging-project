"""The viewer pane: one 2-D MPR view (or 3-D) plus its own frame state.

This is the piece the missing main window was always going to need: a widget
that owns a ``FrameView`` + ``SliceBar`` column, knows which plane it is showing
("Axial"/"Coronal"/"Sagittal"/"3D"), and reports what the reader did on it so
the page can drive linked navigation, crosshairs and W/L sharing from one place.

It contains no decoding and no index access - ``ui.bridge`` supplies frames - so
four of these panes cost one decode worker pool, not four.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QVBoxLayout, QWidget

from .widgets.frame_view import FrameView, Overlay, ViewState
from .widgets.slice_bar import SliceBar
from .widgets.volume3d import Volume3DView

VIEW_AXIAL = "Axial"
VIEW_CORONAL = "Coronal"
VIEW_SAGITTAL = "Sagittal"
VIEW_3D = "3D"
VIEW_2D = (VIEW_AXIAL, VIEW_CORONAL, VIEW_SAGITTAL)

PLANE_VIEW_OF: dict[str, str] = {
    "Axial": VIEW_AXIAL,
    "Coronal": VIEW_CORONAL,
    "Sagittal": VIEW_SAGITTAL,
}


class ViewportPane(QWidget):
    """One pane of the split-screen layout."""

    #: (pane, plane) after a pick or slice change; the page turns this into
    #: linked updates through ``navigation``.
    positionPicked = Signal(object, str, float, float)   # pane, plane, nx, ny
    sliceChanged = Signal(object, str, int)              # pane, plane, slice
    viewChanged = Signal(object, object)                 # pane, ViewState
    activated = Signal(object)                           # pane became active
    annotationAdded = Signal(object, str, float, float, float, float)  # pane,x1,y1,x2,y2
    markerAdded = Signal(object, float, float)
    annotationDeleted = Signal(object, str)
    maximizeToggled = Signal(object)

    def __init__(self, theme_name: str = "light", allow_3d: bool = True,
                 parent=None) -> None:
        super().__init__(parent)
        self._theme = theme_name
        self._plane = VIEW_AXIAL
        self._allow_3d = allow_3d
        self._active = False
        self._crosshair = None      # (nx, ny) or None
        self._slice = 0
        self._total = 0
        self._spacing_mm: float | None = None

        self.view = FrameView(theme_name, self)
        self.slice_bar = SliceBar(self)
        self.view_3d: Volume3DView | None = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(1, 1, 1, 1)
        layout.setSpacing(0)
        layout.addWidget(self.view, 1)
        layout.addWidget(self.slice_bar, 0)

        self.view.sliceStep.connect(self._on_slice_step)
        self.view.viewChanged.connect(lambda _v: self.viewChanged.emit(self, self.view.view()))
        self.view.mousePressEvent = self._wrapped_press(self.view.mousePressEvent)  # type: ignore[method-assign]
        self.view.measurementAdded.connect(self._on_measurement)
        self.view.markerAdded.connect(self._on_marker)

        self.slice_bar.indexChanged.connect(self._on_bar_index)

    # ------------------------------------------------------------------ setup

    def set_plane(self, plane: str) -> None:
        """Switch this pane to a plane (or 3-D)."""
        if plane == self._plane:
            return
        self._plane = plane
        if plane == VIEW_3D and self._allow_3d:
            if self.view_3d is None:
                self.view_3d = Volume3DView(self._theme, self)
                self.view_3d.presetChanged.connect(self._on_preset_changed)
            self.view_3d.show()
            self.view.hide()
            self.slice_bar.hide()
            if self.view_3d.parent() is None:
                self.view_3d.setParent(self)
                layout = self.layout()
                layout.insertWidget(0, self.view_3d, 1)
        else:
            if self.view_3d is not None:
                self.view_3d.hide()
            self.view.show()
            self.slice_bar.show()
        self.planeChanged.emit(self, plane)

    planeChanged = Signal(object, str)

    # ------------------------------------------------------------------ state

    @property
    def plane(self) -> str:
        return self._plane

    @property
    def active(self) -> bool:
        return self._active

    def set_active(self, active: bool) -> None:
        if self._active != active:
            self._active = active
            self.update()

    def set_crosshair(self, pos: tuple[float, float] | None) -> None:
        self._crosshair = pos
        self.view.update()

    def crosshair(self) -> tuple[float, float] | None:
        return self._crosshair

    # ------------------------------------------------------------------ frames

    def set_frame(self, pixmap: QPixmap | None, spacing_mm: float | None = None) -> None:
        self._spacing_mm = spacing_mm
        self.view.set_frame(pixmap, spacing_mm)

    def set_message(self, title: str, detail: str = "") -> None:
        self.view.set_message(title, detail)

    def set_busy(self, busy: bool) -> None:
        self.view.set_busy(busy)

    def set_view(self, view: ViewState, notify: bool = False) -> None:
        self.view.set_view(view, notify)

    def view_state(self) -> ViewState:
        return self.view.view()

    def set_overlay(self, overlay: Overlay) -> None:
        self.view.set_overlay(overlay)

    def overlay(self) -> Overlay:
        return self.view.overlay()

    def set_series(self, total: int, orientation: str = "", index: int = 0) -> None:
        self._total = total
        self._slice = index
        self.slice_bar.set_series(total, orientation, index)

    def set_slice_index(self, index: int) -> None:
        self._slice = index
        self.slice_bar.set_index(index)

    def slice_index(self) -> int:
        return self._slice

    def attach_3d(self, view: Volume3DView | None) -> None:
        """Install a shared 3-D renderer into this pane (single shared GL view)."""
        if self.view_3d is view:
            return
        if self.view_3d is not None:
            self.view_3d.hide()
            self.view_3d.setParent(None)
        self.view_3d = view
        if view is not None:
            view.setParent(self)
            layout = self.layout()
            # replace the FrameView slot with the 3-D view
            layout.insertWidget(0, view, 1)
            view.show()
            self.view.hide()
            self.slice_bar.hide()

    def detach_3d(self) -> None:
        if self.view_3d is not None:
            self.view_3d.hide()
            self.view_3d.setParent(None)
            self.view_3d = None
        self.view.show()
        self.slice_bar.show()

    # ------------------------------------------------------------------ events

    def _wrapped_press(self, original):
        def handler(event):
            self.activated.emit(self)
            self.view.setFocus()
            # capture the pick position for linked navigation
            if event.button() == Qt.MouseButton.LeftButton:
                nx, ny = self.view._to_norm(event.position())
                self.positionPicked.emit(self, self._plane, nx, ny)
            return original(event)
        return handler

    def _on_slice_step(self, delta: int) -> None:
        nxt = max(0, min(self._total - 1, self._slice + delta)) if self._total else 0
        if nxt != self._slice:
            self._slice = nxt
            self.slice_bar.set_index(nxt)
            self.sliceChanged.emit(self, self._plane, nxt)

    def _on_bar_index(self, index: int) -> None:
        if index != self._slice:
            self._slice = index
            self.sliceChanged.emit(self, self._plane, index)

    def _on_measurement(self, measurement) -> None:
        # normalized frame coords -> world mm at the page level; page owns store
        self.annotationAdded.emit(self, "line", measurement.x1, measurement.y1,
                                  measurement.x2, measurement.y2)

    def _on_marker(self, marker) -> None:
        self.markerAdded.emit(self, marker.x, marker.y)

    def _on_preset_changed(self, preset_id: str, legend: str) -> None:
        self.presetChanged.emit(preset_id, legend)

    presetChanged = Signal(str, str)

    # ------------------------------------------------------------------ paint

    def paintEvent(self, event) -> None:  # noqa: N802
        super().paintEvent(event)
        if self._active:
            p = QPainter(self)
            pen = QPen(QColor("#3B82F6"), 2)
            p.setPen(pen)
            p.drawRect(self.rect().adjusted(0, 0, -1, -1))
            p.end()
        # crosshair is painted on the FrameView canvas, not here, because the
        # frame can be zoomed/panned and the crosshair must sit on the image.

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)