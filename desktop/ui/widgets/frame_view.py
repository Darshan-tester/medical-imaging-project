"""The diagnostic image canvas.

This is the port of ``ImageViewer.tsx``, and it keeps that component's geometry
rather than inventing its own, because the two have to agree about what a
normalized coordinate means:

* The image sits inside a **square** frame and is contained, not cropped - a
  sagittal reslice or a portrait chest radiograph is letterboxed.  Cropping to
  fill would hide anatomy at the edges without saying so.
* Markers, measurements and pen strokes are normalized against that **frame**,
  because they are created by clicking it.
* Finding regions are normalized against the **image**, so they are drawn into
  the letterboxed rectangle the image actually occupies - ``contained_rect``
  below is ``containedRect`` from the web component, which exists because
  drawing them at ``inset-0`` put every box off by the size of the letterbox.
* ``transform: translate(pan) scale(zoom)`` about the frame's centre, which is
  the CSS default origin.

Layers are drawn in a fixed order and each is separately toggleable, which is
§24: base, segmentation, problem regions, measurements, labels.  Nothing is
flattened into the image - the base pixmap is never drawn on, so hiding a layer
restores exactly the pixels ``core.imaging`` produced.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (QCursor, QFont, QImage, QPainter, QPen, QPixmap,
                           QPolygonF, QTransform)
from PySide6.QtWidgets import QSizePolicy, QWidget

from .. import lut as lut_mod
from .. import theme
from ..paint import qcolor

#: Tool names, from ``ViewerTool`` in ``ViewerToolbar.tsx``.
TOOL_PAN = "pan"
TOOL_MEASURE = "measure"
TOOL_MARKER = "annotate"
TOOL_PEN = "pen"

#: Layer ids, in draw order.  §24's list, and the order matters: a label drawn
#: under the image is not a label.
LAYER_BASE = "base"
LAYER_SEGMENTATION = "segmentation"
LAYER_REGION = "problem-region"
LAYER_MEASUREMENT = "measurements"
LAYER_LABEL = "labels"
LAYER_ORDER = (LAYER_BASE, LAYER_SEGMENTATION, LAYER_REGION,
               LAYER_MEASUREMENT, LAYER_LABEL)

#: Human names for the layer toggles.
LAYER_LABELS: dict[str, str] = {
    LAYER_BASE: "Base image",
    LAYER_SEGMENTATION: "Segmentation",
    LAYER_REGION: "Problem regions",
    LAYER_MEASUREMENT: "Measurements",
    LAYER_LABEL: "Labels",
}

#: ``ViewerToolbar.tsx``: zoom steps by 0.25 and is clamped to this range.
ZOOM_MIN = 0.5
ZOOM_MAX = 4.0
ZOOM_STEP = 0.25

#: Window/level drag sensitivity: percent of brightness or contrast per pixel of
#: mouse travel.  The web app has only the 20-point toolbar steps; a right-drag
#: is the PACS gesture and needs something finer, so this is deliberately small
#: enough that a full window is roughly a screen's width of travel.
WL_PER_PIXEL = 0.35

#: Range a window/level drag may reach.  Wider than the toolbar's 100-140 steps,
#: and floored above zero so the control cannot produce a black frame.
WL_MIN = 10
WL_MAX = 300

#: Handle size for a measurement endpoint, in device pixels.
HANDLE_R = 3.5

#: Overlay colours.  The viewer surface is dark in both themes, so these come
#: from the dark palette in both - a #D97706 amber that reads on a white panel is
#: muddy on #0A0E16.
MEASURE_COLOR = theme.MEASURE_COLOR
MARKER_COLOR = theme.DARK["warning"]
PEN_COLOR = theme.DARK["critical"]
OVERLAY_INK = theme.DARK["ink_primary"]
OVERLAY_MUTED = theme.DARK["ink_muted"]

#: Opacity of the segmentation mask, if one is supplied.
MASK_OPACITY = 0.45


@dataclass(frozen=True)
class ViewState:
    """``ViewerState`` from ``ViewerToolbar.tsx``, with its defaults.

    Frozen because the toolbar, the canvas and the page all hold it; a mutable
    copy shared three ways is how a zoom button and a scrollbar end up
    disagreeing about the current zoom.
    """

    zoom: float = 1.0
    brightness: int = lut_mod.NEUTRAL
    contrast: int = lut_mod.NEUTRAL
    inverted: bool = False
    tool: str = TOOL_PAN
    pan_x: float = 0.0
    pan_y: float = 0.0

    def zoomed(self, delta: float) -> "ViewState":
        value = min(ZOOM_MAX, max(ZOOM_MIN, self.zoom + delta))
        return replace(self, zoom=round(value, 4))

    def reset_view(self) -> "ViewState":
        """Reset geometry and window/level, keeping the selected tool.

        ``DEFAULT_VIEWER_STATE`` in the web app resets the tool too, but there
        the reset is a button click; here it is also bound to double-click, and
        silently dropping the reader back to Pan mid-measurement is worse than
        leaving the tool alone.
        """
        return ViewState(tool=self.tool)


DEFAULT_VIEW = ViewState()


@dataclass
class Marker:
    """A numbered pin, in frame coordinates.  ``Annotation`` in the web app."""

    x: float
    y: float
    label: str = ""


@dataclass
class Measurement:
    """A two-point distance in frame coordinates.

    ``distance_mm`` is filled in only when the series carries pixel spacing;
    otherwise the label is in pixels, exactly as ``ImageViewer.tsx`` does it.
    Inventing a millimetre figure from an assumed spacing would be a fabricated
    measurement on a diagnostic image, which §10's rule against invented data
    covers in spirit and §26's against crashing does not soften.
    """

    x1: float
    y1: float
    x2: float
    y2: float
    distance_px: float = 0.0
    distance_mm: float | None = None

    def label(self) -> str:
        if self.distance_mm is not None:
            return f"{self.distance_mm:.1f}mm"
        return f"{round(self.distance_px)}px"


@dataclass
class Stroke:
    """One freehand pen path, in frame coordinates."""

    points: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class Region:
    """A problem region: normalized against the **image**, not the frame.

    Populated from whatever the index carries.  This build ships no detector, so
    in practice the list is empty and the layer draws nothing - the layer exists
    because §24 asks for it, not because something invents boxes to fill it.
    """

    x: float
    y: float
    width: float
    height: float
    label: str = ""
    tone: str = "warning"


@dataclass
class Overlay:
    """Everything drawn on top of one frame.

    Held per (study, series, slice) by the viewer page and handed here whole, so
    stepping a slice swaps the overlay rather than clearing and refilling it.
    """

    markers: list[Marker] = field(default_factory=list)
    measurements: list[Measurement] = field(default_factory=list)
    strokes: list[Stroke] = field(default_factory=list)
    regions: list[Region] = field(default_factory=list)
    mask: QImage | None = None

    def is_empty(self) -> bool:
        return not (self.markers or self.measurements or self.strokes
                    or self.regions or self.mask is not None)


def contained_rect(natural_w: int, natural_h: int) -> tuple[float, float, float, float]:
    """``containedRect`` from ``ImageViewer.tsx``: where the image lands.

    Returns ``(left, top, width, height)`` as fractions of a **square** frame,
    which is the box CSS ``object-contain`` would put the image in.  Kept as
    fractions rather than pixels so it can be checked against the web component's
    own numbers without a widget.
    """
    if natural_w <= 0 or natural_h <= 0:
        return (0.0, 0.0, 1.0, 1.0)
    ratio = natural_w / natural_h
    if ratio >= 1.0:
        height = 1.0 / ratio
        return (0.0, (1.0 - height) / 2.0, 1.0, height)
    return ((1.0 - ratio) / 2.0, 0.0, ratio, 1.0)


class FrameView(QWidget):
    """The canvas: one frame, the overlay layers, and the mouse tools.

    It owns no loader and no index.  A frame arrives as a ``QImage`` (already off
    the worker thread, see ``ui.bridge``) and the widget's only job is to put it
    on screen and turn clicks into normalized coordinates.  That is what makes it
    testable without a dataset: hand it a 4x4 ``QImage`` and it behaves.
    """

    #: The reader asked for another slice: wheel, or the arrow keys.  ``+1``/``-1``
    #: rather than an absolute index, because the canvas does not know how many
    #: slices there are - the slice bar does.
    sliceStep = Signal(int)
    #: Zoom, pan, brightness, contrast or invert changed from inside the canvas
    #: (drag, wheel, double-click), so the toolbar can follow.
    viewChanged = Signal(object)
    #: A completed annotation.  The page decides where to store it; nothing is
    #: written to disk by this widget.
    markerAdded = Signal(object)
    measurementAdded = Signal(object)
    strokeAdded = Signal(object)

    def __init__(self, theme_name: str = "light", parent=None) -> None:
        super().__init__(parent)
        self._theme = theme_name
        self._view = DEFAULT_VIEW
        self._overlay = Overlay()
        self._layers = {name: True for name in LAYER_ORDER}
        self._image: QImage | None = None
        self._pixmap: QPixmap | None = None
        self._lut_applied: tuple[int, int, bool] | None = None
        self._message: tuple[str, str] | None = None
        self._busy = False
        self._spacing_mm: float | None = None
        # Interaction state.  ``_drag`` is the gesture in flight, if any.
        self._drag: str | None = None
        self._drag_from = QPointF()
        self._drag_origin = DEFAULT_VIEW
        self._pending: Measurement | None = None
        self._pending_stroke: Stroke | None = None
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self.setMinimumSize(320, 320)
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent, True)
        self._apply_cursor()

    # ------------------------------------------------------------------- state

    def apply_theme(self, theme_name: str) -> None:
        """The viewer surface is theme-invariant, so this only affects text.

        ``tailwind.config.ts`` says of the viewer colour: "intentionally
        theme-invariant - PACS viewers stay dark always".  The background here
        stays ``theme.VIEWER_BG`` in both themes; what changes is the tone of the
        overlay text and the message block.
        """
        self._theme = theme_name
        self.update()

    def set_frame(self, image: QImage | None, spacing_mm: float | None = None) -> None:
        """Show a decoded frame.  ``None`` clears to the message state.

        The widget takes the image as given; ``ui.bridge.to_qimage`` has already
        copied it out of the frame cache's numpy buffer, so nothing here can be
        left pointing at an evicted array.
        """
        self._image = image
        self._spacing_mm = spacing_mm
        self._pixmap = None
        self._lut_applied = None
        if image is not None:
            self._message = None
        self._busy = False
        self.update()

    def set_message(self, title: str, detail: str = "") -> None:
        """Replace the frame with a failure message (§26).

        The frame is dropped as well, so a stale slice cannot sit under an
        "Unable to load image." caption and be read as the current one.
        """
        self._image = None
        self._pixmap = None
        self._message = (title, detail)
        self._busy = False
        self.update()

    def set_busy(self, busy: bool) -> None:
        """A decode is in flight.  The previous frame stays up, dimmed."""
        if self._busy != busy:
            self._busy = busy
            self.update()

    @property
    def view(self) -> ViewState:
        return self._view

    def set_view(self, view: ViewState, notify: bool = False) -> None:
        """Adopt a view state from the toolbar.

        The LUT is only rebuilt when the window/level part actually changed, so
        panning does not re-run a 256-entry table build and a pixmap conversion
        on every mouse-move event.
        """
        before = self._view
        self._view = view
        if (before.brightness, before.contrast, before.inverted) != (
                view.brightness, view.contrast, view.inverted):
            self._pixmap = None
        if before.tool != view.tool:
            self._pending = None
            self._pending_stroke = None
            self._apply_cursor()
        self.update()
        if notify:
            self.viewChanged.emit(view)

    def set_overlay(self, overlay: Overlay) -> None:
        self._overlay = overlay
        self._pending = None
        self._pending_stroke = None
        self.update()

    @property
    def overlay(self) -> Overlay:
        return self._overlay

    def layer_visible(self, name: str) -> bool:
        return self._layers.get(name, True)

    def set_layer_visible(self, name: str, visible: bool) -> None:
        """Toggle one layer.

        Hiding a layer restores the frame exactly, because the base pixmap is
        never painted on - the overlays are drawn over it on every repaint and
        never into it.  That is the "not flattened" half of §24.
        """
        if name in self._layers and self._layers[name] != visible:
            self._layers[name] = visible
            self.update()

    def has_frame(self) -> bool:
        return self._image is not None

    # ---------------------------------------------------------------- geometry

    def frame_rect(self) -> QRectF:
        """The untransformed square the image is contained in.

        Square because the web frame is ``aspect-square``, and because a square
        is the only frame in which a normalized coordinate means the same thing
        after the reader resizes the window.  The web caps it at 560 px; here it
        takes the whole widget, which is the point of having a desktop window.
        """
        side = float(min(self.width(), self.height()))
        return QRectF((self.width() - side) / 2.0, (self.height() - side) / 2.0,
                      side, side)

    def _transform(self) -> QTransform:
        """``translate(pan) scale(zoom)`` about the frame centre.

        Built once and used for both painting and hit-testing - the same object
        inverted - so a click cannot land somewhere other than where the reader
        sees the pixel.  Two hand-rolled copies of this arithmetic is exactly how
        that drift happens.
        """
        centre = self.frame_rect().center()
        transform = QTransform()
        transform.translate(self._view.pan_x, self._view.pan_y)
        transform.translate(centre.x(), centre.y())
        transform.scale(self._view.zoom, self._view.zoom)
        transform.translate(-centre.x(), -centre.y())
        return transform

    def image_rect(self, frame: QRectF | None = None) -> QRectF:
        """Where the image lands inside the frame, letterbox included."""
        rect = self.frame_rect() if frame is None else frame
        if self._image is None:
            return rect
        left, top, width, height = contained_rect(self._image.width(),
                                                  self._image.height())
        return QRectF(rect.left() + left * rect.width(),
                      rect.top() + top * rect.height(),
                      width * rect.width(), height * rect.height())

    def _norm_point(self, nx: float, ny: float, frame: QRectF) -> QPointF:
        return QPointF(frame.left() + nx * frame.width(),
                       frame.top() + ny * frame.height())

    def _to_norm(self, pos: QPointF) -> QPointF:
        """A widget position as a fraction of the frame, undoing zoom and pan.

        Not clamped: a click outside the frame gives a value outside 0..1, and
        the callers that care check for it.  Clamping here would silently move a
        measurement endpoint the reader put in the letterbox.
        """
        inverse, ok = self._transform().inverted()
        point = inverse.map(pos) if ok else pos
        frame = self.frame_rect()
        if frame.width() <= 0 or frame.height() <= 0:
            return QPointF(0.0, 0.0)
        return QPointF((point.x() - frame.left()) / frame.width(),
                       (point.y() - frame.top()) / frame.height())

    # ------------------------------------------------------------------ display

    def _display_pixmap(self) -> QPixmap | None:
        """The frame with window/level applied, cached until one of them changes.

        Greyscale frames arrive as ``Format_Indexed8`` from ``ui.bridge``, so the
        window/level control is a 256-entry colour table swap - no pixel pass, no
        re-decode, and the frame cache keeps its entry.  Colour rasters (ROCOv2
        PNG/JPEG) have no palette, so they get one numpy pass over an RGB32 copy;
        they are small and the copy is only made when the reader moves the
        control off neutral.
        """
        if self._image is None:
            return None
        key = (self._view.brightness, self._view.contrast, self._view.inverted)
        if self._pixmap is not None and self._lut_applied == key:
            return self._pixmap
        neutral = lut_mod.is_neutral(*key)
        if self._image.format() == QImage.Format.Format_Indexed8:
            table = lut_mod.display_lut(*key)
            self._image.setColorTable([0xFF000000 | (v << 16) | (v << 8) | v
                                       for v in table])
            source = self._image
        elif neutral:
            source = self._image
        else:
            source = self._apply_lut_rgb(self._image, lut_mod.display_lut(*key))
        self._pixmap = QPixmap.fromImage(source)
        self._lut_applied = key
        return self._pixmap

    @staticmethod
    def _apply_lut_rgb(image: QImage, table: list[int]) -> QImage:
        """Map a colour image through the table, leaving alpha alone.

        ``Format_RGB32`` is forced first so the stride is a whole number of
        4-byte pixels and the numpy view needs no per-row arithmetic.  On
        little-endian the bytes are B, G, R, X; the table applies to all three
        colour channels equally, which is what a CSS filter does.

        The pixels are copied out of Qt's buffer rather than written through it.
        Whether ``bits()`` hands back a writable view differs between PySide6
        builds, and a silent read-only failure here would show up as a
        window/level control that does nothing on ROCOv2 images only.
        """
        rgb = image.convertToFormat(QImage.Format.Format_RGB32)
        width, height, stride = rgb.width(), rgb.height(), rgb.bytesPerLine()
        if width <= 0 or height <= 0 or stride < width * 4:
            return rgb
        raw = np.array(memoryview(rgb.constBits()), dtype=np.uint8, copy=True)
        pixels = raw.reshape(height, stride // 4, 4)
        lut = np.asarray(table, dtype=np.uint8)
        pixels[:, :width, :3] = lut[pixels[:, :width, :3]]
        return QImage(pixels.tobytes(), width, height, stride,
                      QImage.Format.Format_RGB32).copy()

    # ------------------------------------------------------------------ painting

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Base image under the transform, overlays in device space.

        Only the pixmap and the segmentation mask are painted through the zoom
        transform.  The vector layers are mapped to device coordinates first, so
        a 1.5 px measurement line stays 1.5 px and a millimetre label stays
        readable at 0.5x - under the transform both would scale by 8 between the
        zoom limits, and an unreadable measurement on a diagnostic image is worse
        than a cosmetic difference from the browser.
        """
        painter = QPainter(self)
        painter.fillRect(self.rect(), qcolor(theme.VIEWER_BG))
        pixmap = self._display_pixmap()
        if pixmap is None:
            self._paint_message(painter)
            return
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
        frame = self.frame_rect()
        transform = self._transform()
        target = transform.mapRect(self.image_rect(frame))
        if self._layers[LAYER_BASE]:
            painter.drawPixmap(target, pixmap, QRectF(pixmap.rect()))
        if self._layers[LAYER_SEGMENTATION] and self._overlay.mask is not None:
            painter.save()
            painter.setOpacity(MASK_OPACITY)
            painter.drawImage(target, self._overlay.mask)
            painter.restore()
        if self._layers[LAYER_REGION]:
            self._paint_regions(painter, target)
            self._paint_strokes(painter, transform, frame)
        if self._layers[LAYER_MEASUREMENT]:
            self._paint_measurements(painter, transform, frame)
        if self._layers[LAYER_LABEL]:
            self._paint_markers(painter, transform, frame)
        if self._busy:
            painter.fillRect(self.rect(), qcolor(theme.VIEWER_BG, 0.35))

    def _paint_message(self, painter: QPainter) -> None:
        """The §26 empty state: a title, and the reason under it.

        ``ImageViewer.tsx`` shows "Unable to display this image" in the same
        place.  The detail line is this port's addition and carries the loader's
        own message, because "which file" is the first thing anyone asks.
        """
        title, detail = self._message or ("", "")
        if not title:
            return
        rect = self.rect()
        font = QFont(self.font())
        font.setPointSize(theme.PT_BODY)
        font.setWeight(QFont.Weight.DemiBold)
        painter.setFont(font)
        painter.setPen(QPen(qcolor(OVERLAY_INK)))
        line = painter.fontMetrics().height()
        box = QRectF(rect.left() + 24, rect.center().y() - line,
                     rect.width() - 48, line)
        painter.drawText(box, int(Qt.AlignmentFlag.AlignCenter), title)
        if detail:
            font.setPointSize(theme.PT_SMALL)
            font.setWeight(QFont.Weight.Normal)
            painter.setFont(font)
            painter.setPen(QPen(qcolor(OVERLAY_MUTED)))
            painter.drawText(QRectF(box.left(), box.bottom() + 4, box.width(),
                                    line * 3),
                             int(Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignTop),
                             detail)

    # -------------------------------------------------------------- the layers

    def _paint_regions(self, painter: QPainter, target: QRectF) -> None:
        """Problem regions, normalized against the image rather than the frame.

        This is the bug ``containedRect`` was written for: a box at ``x = 0.5`` is
        halfway across the *image*, and drawing it halfway across the frame puts
        it off by the letterbox on every non-square study.
        """
        for region in self._overlay.regions:
            rect = QRectF(target.left() + region.x * target.width(),
                          target.top() + region.y * target.height(),
                          region.width * target.width(),
                          region.height * target.height())
            color = theme.DARK.get(region.tone, theme.DARK["warning"])
            painter.setBrush(qcolor(color, 0.12))
            painter.setPen(QPen(qcolor(color), 1.5))
            painter.drawRect(rect)
            if region.label:
                self._plate(painter, QPointF(rect.center().x(), rect.top()),
                            region.label, color)

    def _paint_strokes(self, painter: QPainter, transform: QTransform,
                       frame: QRectF) -> None:
        strokes = list(self._overlay.strokes)
        if self._pending_stroke is not None:
            strokes.append(self._pending_stroke)
        pen = QPen(qcolor(PEN_COLOR), 2.0)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        for stroke in strokes:
            if len(stroke.points) < 2:
                continue
            polygon = QPolygonF([
                transform.map(self._norm_point(x, y, frame))
                for x, y in stroke.points])
            painter.drawPolyline(polygon)

    def _paint_measurements(self, painter: QPainter, transform: QTransform,
                            frame: QRectF) -> None:
        items = list(self._overlay.measurements)
        if self._pending is not None:
            items.append(self._pending)
        color = qcolor(MEASURE_COLOR)
        for item in items:
            start = transform.map(self._norm_point(item.x1, item.y1, frame))
            end = transform.map(self._norm_point(item.x2, item.y2, frame))
            pen = QPen(color, 1.5)
            pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            painter.setPen(pen)
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawLine(start, end)
            painter.setBrush(color)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(start, HANDLE_R, HANDLE_R)
            painter.drawEllipse(end, HANDLE_R, HANDLE_R)
            mid = QPointF((start.x() + end.x()) / 2.0, (start.y() + end.y()) / 2.0)
            self._plate(painter, mid, item.label(), MEASURE_COLOR)

    def _paint_markers(self, painter: QPainter, transform: QTransform,
                       frame: QRectF) -> None:
        color = qcolor(MARKER_COLOR)
        for number, marker in enumerate(self._overlay.markers, start=1):
            point = transform.map(self._norm_point(marker.x, marker.y, frame))
            painter.setPen(QPen(qcolor(theme.VIEWER_BG), 1.5))
            painter.setBrush(color)
            painter.drawEllipse(point, 8.0, 8.0)
            font = QFont(self.font())
            font.setPointSize(theme.PT_TINY)
            font.setWeight(QFont.Weight.Bold)
            painter.setFont(font)
            painter.setPen(QPen(qcolor(theme.VIEWER_BG)))
            painter.drawText(QRectF(point.x() - 8, point.y() - 8, 16, 16),
                             int(Qt.AlignmentFlag.AlignCenter), str(number))
            if marker.label:
                self._plate(painter, QPointF(point.x(), point.y() + 8),
                            marker.label, MARKER_COLOR, above=False)

    def _plate(self, painter: QPainter, anchor: QPointF, text: str,
               color: str, above: bool = True) -> None:
        """A label on a translucent plate, so it survives bright anatomy.

        White-on-nothing text vanishes over a sternum and black-on-nothing
        vanishes over air; a plate is what the web app's chips do with a
        background class.
        """
        font = QFont(self.font())
        font.setPointSize(theme.PT_TINY)
        font.setWeight(QFont.Weight.DemiBold)
        painter.setFont(font)
        metrics = painter.fontMetrics()
        width = metrics.horizontalAdvance(text) + 8.0
        height = metrics.height() + 2.0
        top = anchor.y() - height - 4.0 if above else anchor.y() + 4.0
        rect = QRectF(anchor.x() - width / 2.0, top, width, height)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(qcolor(theme.VIEWER_BG, 0.72))
        painter.drawRoundedRect(rect, 3.0, 3.0)
        painter.setPen(QPen(qcolor(color)))
        painter.drawText(rect, int(Qt.AlignmentFlag.AlignCenter), text)

    # ------------------------------------------------------------- measurement

    def image_pixel(self, nx: float, ny: float) -> QPointF | None:
        """A frame-normalized point as image pixel coordinates.

        ``None`` when the point is outside the image, which happens whenever the
        reader clicks the letterbox of a non-square study.
        """
        if self._image is None:
            return None
        left, top, width, height = contained_rect(self._image.width(),
                                                  self._image.height())
        if width <= 0 or height <= 0:
            return None
        x = (nx - left) / width * self._image.width()
        y = (ny - top) / height * self._image.height()
        if not (0.0 <= x <= self._image.width() and 0.0 <= y <= self._image.height()):
            return None
        return QPointF(x, y)

    def _measure(self, item: Measurement) -> Measurement:
        """Fill in the distance for a finished measurement.

        Pixels are counted in the **image**, not the frame or the screen, so the
        number does not change when the reader resizes the window or zooms in.
        Millimetres appear only when the caller supplied a spacing for this
        frame; with no spacing the label stays in pixels, because a millimetre
        figure derived from a guessed spacing is a fabricated measurement.
        """
        start = self.image_pixel(item.x1, item.y1)
        end = self.image_pixel(item.x2, item.y2)
        if start is None or end is None:
            return item
        dx, dy = end.x() - start.x(), end.y() - start.y()
        pixels = float(np.hypot(dx, dy))
        millimetres = pixels * self._spacing_mm if self._spacing_mm else None
        return replace(item, distance_px=pixels, distance_mm=millimetres)

    # ------------------------------------------------------------ interaction

    def _apply_cursor(self) -> None:
        if self._drag == "pan":
            shape = Qt.CursorShape.ClosedHandCursor
        elif self._view.tool == TOOL_PAN:
            shape = Qt.CursorShape.OpenHandCursor
        else:
            shape = Qt.CursorShape.CrossCursor
        self.setCursor(QCursor(shape))

    def fit(self) -> None:
        """Reset zoom, pan and window/level - the toolbar's "Reset view"."""
        self.set_view(self._view.reset_view(), notify=True)

    def mousePressEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Begin a gesture.

        Two bindings are PACS conventions the web app has no equivalent of, and
        they are additions rather than changes: middle-drag pans whatever tool is
        selected, and right-drag is window/level.  The left button does whatever
        the toolbar says, which is the behaviour ``ImageViewer.tsx`` has.
        """
        if self._image is None:
            super().mousePressEvent(event)
            return
        button = event.button()
        shift = bool(event.modifiers() & Qt.KeyboardModifier.ShiftModifier)
        position = event.position()
        self._drag_from = position
        self._drag_origin = self._view
        if button == Qt.MouseButton.MiddleButton or (
                button == Qt.MouseButton.LeftButton
                and (self._view.tool == TOOL_PAN or shift)):
            self._drag = "pan"
        elif button == Qt.MouseButton.RightButton:
            self._drag = "window"
        elif button == Qt.MouseButton.LeftButton:
            point = self._to_norm(position)
            if self._view.tool == TOOL_MEASURE:
                self._drag = "measure"
                self._pending = Measurement(point.x(), point.y(),
                                            point.x(), point.y())
            elif self._view.tool == TOOL_PEN:
                self._drag = "pen"
                self._pending_stroke = Stroke([(point.x(), point.y())])
            elif self._view.tool == TOOL_MARKER:
                self._drag = "marker"
        else:
            super().mousePressEvent(event)
            return
        self._apply_cursor()
        self.update()

    def mouseMoveEvent(self, event) -> None:  # noqa: N802 - Qt name
        if self._drag is None:
            super().mouseMoveEvent(event)
            return
        position = event.position()
        delta = position - self._drag_from
        if self._drag == "pan":
            self.set_view(replace(self._drag_origin,
                                  pan_x=self._drag_origin.pan_x + delta.x(),
                                  pan_y=self._drag_origin.pan_y + delta.y()),
                          notify=True)
            return
        if self._drag == "window":
            self.set_view(replace(
                self._drag_origin,
                brightness=_clamp_percent(self._drag_origin.brightness
                                          + delta.x() * WL_PER_PIXEL),
                contrast=_clamp_percent(self._drag_origin.contrast
                                        - delta.y() * WL_PER_PIXEL)),
                notify=True)
            return
        point = self._to_norm(position)
        if self._drag == "measure" and self._pending is not None:
            self._pending = replace(self._pending, x2=point.x(), y2=point.y())
            self.update()
        elif self._drag == "pen" and self._pending_stroke is not None:
            self._pending_stroke.points.append((point.x(), point.y()))
            self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Finish the gesture, and emit the annotation if it produced one.

        Nothing is added to ``self._overlay`` here.  The page owns the overlay
        store - keyed by study, series and slice - so the canvas emitting and the
        page storing keeps one copy of the truth instead of two that have to be
        reconciled when the reader steps a slice.
        """
        drag, self._drag = self._drag, None
        if drag is None:
            super().mouseReleaseEvent(event)
            return
        position = event.position()
        if drag == "measure" and self._pending is not None:
            pending, self._pending = self._pending, None
            moved = (position - self._drag_from).manhattanLength()
            if moved >= 3:
                self.measurementAdded.emit(self._measure(pending))
        elif drag == "pen" and self._pending_stroke is not None:
            stroke, self._pending_stroke = self._pending_stroke, None
            if len(stroke.points) >= 2:
                self.strokeAdded.emit(stroke)
        elif drag == "marker":
            point = self._to_norm(position)
            if self.image_pixel(point.x(), point.y()) is not None:
                self.markerAdded.emit(Marker(point.x(), point.y()))
        self._apply_cursor()
        self.update()

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Double-click fits, which is the gesture every viewer has."""
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag = None
            self._pending = None
            self._pending_stroke = None
            self.fit()
            return
        super().mouseDoubleClickEvent(event)

    def wheelEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Wheel steps slices; Ctrl+wheel zooms.

        The web app has no wheel handler - it steps slices with a slider and
        buttons.  Scrolling through a stack is how a CT is actually read, so the
        desktop binds it, and puts zoom behind Ctrl where every other application
        puts it.
        """
        if self._image is None:
            super().wheelEvent(event)
            return
        notches = event.angleDelta().y()
        if notches == 0:
            super().wheelEvent(event)
            return
        steps = 1 if notches > 0 else -1
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            self.set_view(self._view.zoomed(steps * ZOOM_STEP), notify=True)
        else:
            # Wheel away from the reader goes to the previous slice, which is the
            # direction a scroll bar would move: down means deeper into the stack.
            self.sliceStep.emit(-steps)
        event.accept()

    def keyPressEvent(self, event) -> None:  # noqa: N802 - Qt name
        """Arrows step slices, ``+``/``-`` zoom, ``0`` fits.

        Everything else is passed up, deliberately: the slice bar owns Space for
        cine, and swallowing it here would break the play button whenever the
        canvas happened to hold focus.
        """
        key = event.key()
        if key in (Qt.Key.Key_Left, Qt.Key.Key_Up):
            self.sliceStep.emit(-1)
        elif key in (Qt.Key.Key_Right, Qt.Key.Key_Down):
            self.sliceStep.emit(1)
        elif key in (Qt.Key.Key_Plus, Qt.Key.Key_Equal):
            self.set_view(self._view.zoomed(ZOOM_STEP), notify=True)
        elif key == Qt.Key.Key_Minus:
            self.set_view(self._view.zoomed(-ZOOM_STEP), notify=True)
        elif key == Qt.Key.Key_0:
            self.fit()
        else:
            super().keyPressEvent(event)
            return
        event.accept()


def _clamp_percent(value: float) -> int:
    """Window/level percentages, kept in a range that still shows anatomy.

    The toolbar's own steps only reach 140, but a drag is continuous and wants
    more room.  The floor is not zero because ``brightness(0%)`` is a black
    frame, and a control that can make the image disappear reads as a crash.
    """
    return int(round(min(WL_MAX, max(WL_MIN, value))))
