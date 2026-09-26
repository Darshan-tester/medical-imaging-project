"""
SliceView — the 2-D viewer widget.

Renders a decoded slice (float32 ndarray) with:
- window/level (WW/WL) with real-time updates
- zoom / pan / fit / 1:1
- invert, brightness/contrast mapped into WW/WL
- crosshair overlay for MPR synchronization
- annotation overlay drawn in plane-pixel coordinates
- correct anatomical orientation (no stretching): scale x/y independently
  using the slice's mm spacing

Mouse: drag = tool action (wl/pan/zoom per current tool), wheel = slice nav.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
from PySide6.QtCore import Qt, Signal, QPointF, QRectF
from PySide6.QtGui import (QPainter, QImage, QPixmap, QColor, QPen, QFont,
                           QTransform, QWheelEvent, QMouseEvent)
from PySide6.QtWidgets import QWidget, QMenu


class SliceView(QWidget):
    sliceSelected = Signal(int)             # user moved slice index (wheel)
    crosshairMoved = Signal(float, float)   # plane-pixel coords user clicked
    zoomChanged = Signal(float)
    wlChanged = Signal(float, float)        # ww, wl
    annotationCreated = Signal(dict)        # finished annotation in plane coords
    statusMessage = Signal(str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setMinimumSize(200, 200)
        self.setMouseTracking(False)

        self._slice: Optional[np.ndarray] = None   # float32 2-D
        self._spacing = (1.0, 1.0)                  # (row_mm, col_mm)

        # window / level
        self._ww = 400.0
        self._wl = 40.0
        self._auto_wl_done = False
        self._invert = False

        # view transform
        self._zoom = 1.0
        self._pan = QPointF(0, 0)
        self._fit_on_next = True

        # tool state
        self.tool = "wl"
        self._drag_start: Optional[QPointF] = None
        self._drag_wl_start = (self._ww, self._wl)
        self._drag_pan_start = QPointF(0, 0)
        self._zoom_anchor = QPointF(0, 0)

        # in-progress annotation points (plane px)
        self._pending_points: list[QPointF] = []

        # overlay
        self.crosshair: Optional[tuple[float, float]] = None
        self.show_crosshair = False
        self.annotations: list = []        # Annotation objects for current plane+slice
        self.overlay_info = ""             # corner text e.g. "Axial 120/300"

        self._pixmap_cache: Optional[QPixmap] = None
        self._pixmap_wl = None

    # ------------------------------------------------------------------ data
    def set_slice(self, arr: Optional[np.ndarray], spacing=(1.0, 1.0),
                  keep_wl: bool = False) -> None:
        self._slice = arr
        if arr is not None:
            self._spacing = spacing
            if not keep_wl or not self._auto_wl_done:
                self.auto_window_level()
                self._auto_wl_done = keep_wl
        self._pixmap_cache = None
        self.update()

    def auto_window_level(self) -> None:
        if self._slice is None:
            return
        a = self._slice
        lo, hi = np.percentile(a, [1, 99])
        if hi <= lo:
            lo, hi = float(a.min()), float(a.max())
        if hi <= lo:
            hi = lo + 1
        self._ww = float(hi - lo)
        self._wl = float((hi + lo) / 2)

    def set_ww_wl(self, ww: float, wl: float, from_external: bool = False) -> None:
        self._ww = max(1.0, ww)
        self._wl = wl
        self._pixmap_cache = None
        self.update()
        if not from_external:
            self.wlChanged.emit(self._ww, self._wl)

    def ww_wl(self) -> tuple[float, float]:
        return self._ww, self._wl

    def set_invert(self, inv: bool) -> None:
        self._invert = inv
        self._pixmap_cache = None
        self.update()

    def zoom(self) -> float:
        return self._zoom

    def set_zoom(self, z: float, anchor: Optional[QPointF] = None) -> None:
        z = max(0.05, min(40.0, z))
        self._zoom = z
        self.update()
        self.zoomChanged.emit(z)

    def fit(self) -> None:
        self._zoom = 1.0
        self._pan = QPointF(0, 0)
        self._fit_on_next = True
        self.update()
        self.zoomChanged.emit(1.0)

    def set_crosshair(self, px: Optional[tuple[float, float]], show: bool = True) -> None:
        self.crosshair = px
        self.show_crosshair = show and px is not None
        self.update()

    def set_annotations(self, anns: list) -> None:
        self.annotations = anns
        self.update()

    # --------------------------------------------------------------- painting
    def _build_pixmap(self) -> Optional[QPixmap]:
        if self._slice is None:
            return None
        if self._pixmap_cache is not None and self._pixmap_wl == (self._ww, self._wl, self._invert):
            return self._pixmap_cache
        a = self._slice
        lo = self._wl - self._ww / 2.0
        hi = self._wl + self._ww / 2.0
        if hi <= lo:
            hi = lo + 1
        norm = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
        if self._invert:
            norm = 1.0 - norm
        u8 = (norm * 255).astype(np.uint8)
        h, w = u8.shape
        img = QImage(u8.data, w, h, w, QImage.Format_Grayscale8)
        if img.isNull():
            return None
        self._pixmap_cache = QPixmap.fromImage(img)
        self._pixmap_wl = (self._ww, self._wl, self._invert)
        return self._pixmap_cache

    def paintEvent(self, ev) -> None:
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(8, 10, 12))

        pm = self._build_pixmap()
        self._ensure_fit()
        if pm is None:
            p.setPen(QColor(90, 100, 110))
            p.drawText(self.rect(), Qt.AlignCenter, self.overlay_info or "Loading…")
            p.end()
            return

        p.save()
        p.translate(self.width() / 2 + self._pan.x(), self.height() / 2 + self._pan.y())
        # image row 0 at top, columns left→right: flip vertically only
        p.scale(1.0, -1.0)
        # anisotropic-spacing correction: equal mm per screen pixel on both axes
        p.scale(self._zoom, self._zoom * self._y_aspect())
        p.drawPixmap(int(-pm.width() / 2), int(-pm.height() / 2), pm)
        p.restore()

        self._draw_overlay(p)
        p.end()

    def _y_aspect(self) -> float:
        if self._slice is None:
            return 1.0
        rh, cw = self._spacing
        if cw <= 0:
            return 1.0
        return rh / cw

    def _ensure_fit(self) -> None:
        if not self._fit_on_next or self._slice is None:
            return
        h, w = self._slice.shape
        disp_h = h * self._y_aspect()
        self._zoom = min(self.width() / max(w, 1), self.height() / max(disp_h, 1)) * 0.95
        self._fit_on_next = False
        self._pan = QPointF(0, 0)

    def _draw_overlay(self, p: QPainter) -> None:
        p.setRenderHint(QPainter.Antialiasing, True)

        # crosshair
        if self.show_crosshair and self.crosshair is not None and self._slice is not None:
            col, row = self._plane_px_to_screen(self.crosshair)
            pen = QPen(QColor(80, 220, 120, 200), 1, Qt.DashLine)
            p.setPen(pen)
            p.drawLine(0, int(row), self.width(), int(row))
            p.drawLine(int(col), 0, int(col), self.height())

        # annotations
        for ann in self.annotations:
            pts = [self._plane_px_to_screen(QPointF(q["x"], q["y"])) for q in ann.points]
            if not pts:
                continue
            pen = QPen(QColor(ann.color), 2)
            p.setPen(pen)
            if len(pts) == 1:
                p.drawEllipse(pts[0], 3, 3)
            elif ann.tool in ("line", "arrow", "measure") and len(pts) >= 2:
                p.drawLine(pts[0], pts[-1])
                if ann.tool == "arrow":
                    self._draw_arrow_head(p, pts[0], pts[-1])
            elif ann.tool == "rect":
                p.drawRect(QRectF(pts[0], pts[-1]).normalized())
            elif ann.tool == "ellipse":
                p.drawEllipse(QRectF(pts[0], pts[-1]).normalized())
            elif ann.tool in ("freehand", "pencil"):
                for i in range(len(pts) - 1):
                    p.drawLine(pts[i], pts[i + 1])
            if ann.measurement_mm:
                mid = pts[0]
                if len(pts) >= 2:
                    mid = QPointF((pts[0].x() + pts[-1].x()) / 2, (pts[0].y() + pts[-1].y()) / 2)
                p.setPen(QPen(QColor(255, 230, 90), 1))
                p.drawText(mid + QPointF(6, -6), f"{ann.measurement_mm:.1f} mm")
            if ann.text:
                p.setPen(QPen(QColor(ann.color), 1))
                p.drawText(pts[0] + QPointF(6, -6), ann.text)

        # pending annotation preview
        if self._pending_points:
            pen = QPen(QColor(255, 200, 60), 2, Qt.DashLine)
            p.setPen(pen)
            sp = [self._plane_px_to_screen(q) for q in self._pending_points]
            if len(sp) >= 2:
                p.drawLine(sp[0], sp[-1])
            else:
                p.drawEllipse(sp[0], 3, 3)

        # info corner
        if self.overlay_info:
            p.setPen(QColor(160, 175, 190))
            f = QFont("Consolas", 9)
            p.setFont(f)
            p.drawText(10, 20, self.overlay_info)

    def _draw_arrow_head(self, p: QPainter, a: QPointF, b: QPointF) -> None:
        ang = math.atan2(b.y() - a.y(), b.x() - a.x())
        size = 10
        for da in (math.radians(150), math.radians(-150)):
            x = b.x() + size * math.cos(ang + da)
            y = b.y() + size * math.sin(ang + da)
            p.drawLine(b, QPointF(x, y))

    # coordinate helpers -----------------------------------------------------
    def _plane_px_to_screen(self, plane_px: QPointF) -> QPointF:
        # Matches paint transform: screen = centre + pan + (col*z, -row*z*ya)
        z = self._zoom
        px = self.width() / 2 + self._pan.x() + plane_px.x() * z
        py = self.height() / 2 + self._pan.y() - plane_px.y() * z * self._y_aspect()
        return QPointF(px, py)

    def _screen_to_plane_px(self, pos: QPointF) -> QPointF:
        z = max(self._zoom, 1e-6)
        col = (pos.x() - self.width() / 2 - self._pan.x()) / z
        row = -(pos.y() - self.height() / 2 - self._pan.y()) / (z * self._y_aspect())
        return QPointF(col, row)

    # --------------------------------------------------------------- events
    def wheelEvent(self, ev: QWheelEvent) -> None:
        if ev.modifiers() & Qt.ControlModifier:
            f = 1.15 if ev.angleDelta().y() > 0 else 1 / 1.15
            self.set_zoom(self._zoom * f)
        else:
            self.sliceSelected.emit(1 if ev.angleDelta().y() > 0 else -1)

    def mousePressEvent(self, ev: QMouseEvent) -> None:
        self._drag_start = ev.position()
        if self.tool == "wl":
            self._drag_wl_start = (self._ww, self._wl)
        elif self.tool == "pan":
            self._drag_pan_start = self._pan
        elif self.tool == "zoom":
            self._zoom_anchor = ev.position()
        elif self.tool in ("line", "arrow", "measure", "rect", "ellipse",
                           "freehand", "pencil", "text"):
            self._pending_points = [self._screen_to_plane_px(ev.position())]

    def mouseMoveEvent(self, ev: QMouseEvent) -> None:
        if self._drag_start is None:
            return
        d = ev.position() - self._drag_start
        if self.tool == "wl":
            ww = self._drag_wl_start[0] + d.x() * 3.0
            wl = self._drag_wl_start[1] + d.y() * 3.0
            self.set_ww_wl(ww, wl)
        elif self.tool == "pan":
            self._pan = self._drag_pan_start + d
            self.update()
        elif self.tool == "zoom":
            f = 1.0 + d.y() / 200.0
            self.set_zoom(max(0.05, self._zoom * f))
        elif self._pending_points and self.tool in ("freehand", "pencil"):
            self._pending_points.append(self._screen_to_plane_px(ev.position()))
            self.update()
        elif self._pending_points:
            self._pending_points = self._pending_points[:1] + [self._screen_to_plane_px(ev.position())]
            self.update()

    def mouseReleaseEvent(self, ev: QMouseEvent) -> None:
        if self._pending_points:
            pts = [self._screen_to_plane_px(q) for q in self._pending_points]
            self.annotationCreated.emit({
                "tool": self.tool,
                "points": [{"x": q.x(), "y": q.y()} for q in pts],
            })
            self._pending_points = []
            self.update()
        self._drag_start = None

    def mouseDoubleClickEvent(self, ev: QMouseEvent) -> None:
        # double-click = crosshair pick for MPR sync
        px = self._screen_to_plane_px(ev.position())
        self.crosshairMoved.emit(px.x(), px.y())