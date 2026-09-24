"""The main window: study list and viewer, assembled from the existing parts.

Pages:

* **Studies** - the ``StudyTableModel`` over the SQLite index, a filter row,
  double-click (or Enter) opens the viewer.
* **Viewer** - the ``LayoutManager`` panes on the left, series strip and the
  report panel on the right, the toolbar and W/L/annotation panels above/beside.

All decoding stays inside ``ui.bridge``'s worker pool; this window only moves
QImages and plain values across threads via signals, and drives navigation math
(``core.imaging.navigation``), which is cheap enough for the UI thread.

Data for the 3-D pane: the volume is prepared on a background thread
(``core.imaging.volume3d.prepare_volume``) and handed to the shared
``Volume3DView`` when ready, so a large volume never blocks the pane switch.
"""

from __future__ import annotations

import threading

import numpy as np
from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QGuiApplication, QImage, QKeySequence, QShortcut
from PySide6.QtWidgets import (QApplication, QComboBox, QHBoxLayout, QLabel,
                               QLineEdit, QMainWindow, QMessageBox, QSplitter,
                               QStackedWidget, QToolBar, QVBoxLayout, QWidget)

from core.db import Index, IndexError_, SeriesRow, StudyDetail
from core.imaging.navigation import all_planes, voxel_from_plane, plane_position
from core.loader import FrameLoad, Loader
from core.log import log

from . import theme
from .bridge import FrameBridge, to_qimage
from .layout import (LAYOUT_1, LAYOUT_2, LAYOUT_4, LayoutManager)
from .models import StudyTableModel
from .viewport import (VIEW_3D, VIEW_2D, ViewportPane)
from .widgets.annotation_panel import AnnotationPanel, AnnotationStyle
from .widgets.frame_view import FrameView, Overlay, ViewState
from .widgets.report_panel import ReportPanel
from .widgets.slice_bar import SliceBar
from .widgets.toolbar import ViewerToolbar
from .widgets.volume3d import Volume3DView
from .widgets.wl_panel import WindowLevelPanel
from core import reports as reports_mod
from core.annotations import (Annotation, AnnotationStore, POINT, LINE)
from core.imaging.volume3d import prepare_volume, PRESETS, DEFAULT_PRESET

try:  # packaged app
    from app_paths import CACHE_DIR, ensure_writable_dirs
except ImportError:  # from a checkout
    from pathlib import Path as _P
    CACHE_DIR = _P(__file__).resolve().parent / "cache"

    def ensure_writable_dirs() -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)


class MainWindow(QMainWindow):
    """One window, two pages, one bridge."""

    def __init__(self, index: Index, store: AnnotationStore | None = None) -> None:
        super().__init__()
        self._index = index
        self._bridge = FrameBridge(index, self)
        self._store = store or AnnotationStore(CACHE_DIR / "annotations.json")
        self._style = AnnotationStyle()
        self._detail: StudyDetail | None = None
        self._series: SeriesRow | None = None
        self._series_list: tuple[SeriesRow, ...] = ()
        self._ijk: tuple[int, int, int] = (0, 0, 0)
        self._linked = True
        self._show_crosshairs = True
        self._3d_shared = Volume3DView(theme_name="light")
        self._3d_host_pane: ViewportPane | None = None
        self._3d_thread: threading.Thread | None = None
        self._geom = None
        self._study_ids: list[str] = []
        self._study_pos = -1
        self._pane_slices: dict = {}
        #: (build_id, series, plane, slice) -> decoded reslice, LRU-bounded.
        self._reslice_cache = _LRUCache(max_items=256)

        self._build_ui()
        self._connect()
        self._apply_shortcuts()

    # ------------------------------------------------------------------ UI

    def _build_ui(self) -> None:
        self.setWindowTitle("Meridian / Vedh Medical Imaging")
        self.resize(1500, 940)

        self._pages = QStackedWidget(self)
        self.setCentralWidget(self._pages)
        self._pages.addWidget(self._build_studies_page())
        self._pages.addWidget(self._build_viewer_page())
        self._pages.setCurrentIndex(0)

    def _build_studies_page(self) -> QWidget:
        page = QWidget(self)
        column = QVBoxLayout(page)
        column.setContentsMargins(12, 12, 12, 12)
        column.setSpacing(8)

        from PySide6.QtWidgets import QTableView, QHeaderView
        from .widgets.badges import BadgeDelegate

        filter_row = QHBoxLayout()
        self._search = QLineEdit(page)
        self._search.setPlaceholderText("Search patient, study, modality, region…")
        self._search.setClearButtonEnabled(True)
        filter_row.addWidget(self._search, 1)
        self._modality = QComboBox(page)
        self._modality.addItem("All modalities", None)
        filter_row.addWidget(self._modality)
        self._dataset = QComboBox(page)
        self._dataset.addItem("All datasets", None)
        filter_row.addWidget(self._dataset)
        column.addLayout(filter_row)

        self._table_model = StudyTableModel(self._index)
        self._table = QTableView(page)
        self._table.setModel(self._table_model)
        self._table.setSelectionBehavior(QTableView.SelectionBehavior.SelectRows)
        self._table.setSelectionMode(QTableView.SelectionMode.SingleSelection)
        self._table.setEditTriggers(QTableView.EditTrigger.NoEditTriggers)
        self._table.verticalHeader().hide()
        self._table.horizontalHeader().setStretchLastSection(True)
        self._table.horizontalHeader().resizeSections(QHeaderView.ResizeMode.ResizeToContents)
        self._table.setItemDelegateForColumn(2, BadgeDelegate("light", self._table))
        self._table.setItemDelegateForColumn(5, BadgeDelegate("light", self._table))
        self._table.doubleClicked.connect(self._open_study)
        column.addWidget(self._table, 1)

        self._count_label = QLabel("", page)
        column.addWidget(self._count_label)
        self._table_model.countChanged.connect(
            lambda n: self._count_label.setText(f"{n:,} studies"))
        self._table_model.failed.connect(self._show_index_error)

        # populate filters from the index
        for modality, _count in self._index.modalities():
            label = theme.MODALITY_LABELS.get(modality, modality or "?")
            self._modality.addItem(label, modality)
        for dataset_id, label, _count in self._index.datasets():
            self._dataset.addItem(label, dataset_id)
        return page

    def _build_viewer_page(self) -> QWidget:
        page = QWidget(self)
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # top bar: back, layout, linking
        bar = QToolBar(page)
        self._back = bar.addAction("← Studies")
        self._layout_combo = QComboBox(page)
        self._layout_combo.addItem("Single pane", LAYOUT_1)
        self._layout_combo.addItem("Two panes", LAYOUT_2)
        self._layout_combo.addItem("Four panes", LAYOUT_4)
        self._series_combo = QComboBox(page)
        self._link_check = QLabel("", page)
        bar.addWidget(self._widget_wrapper(self._back, bar))
        bar.addWidget(self._widget_wrapper(self._layout_combo, bar))
        bar.addWidget(self._widget_wrapper(self._series_combo, bar))
        self._link_toggle = QLabel("", page)
        outer.addWidget(bar)

        body = QSplitter(Qt.Orientation.Horizontal, page)

        viewer_column = QWidget(page)
        vcol = QVBoxLayout(viewer_column)
        vcol.setContentsMargins(0, 0, 0, 0)
        vcol.setSpacing(0)

        self._layout_manager = LayoutManager("light", viewer_column)
        vcol.addWidget(self._layout_manager, 1)
        self._toolbar = ViewerToolbar(viewer_column)
        vcol.addWidget(self._toolbar, 0)
        body.addWidget(viewer_column, 1)

        # right rail: series list + report + W/L + annotations
        rail = QWidget(page)
        rc = QVBoxLayout(rail)
        rc.setContentsMargins(8, 8, 8, 8)
        rc.setSpacing(8)
        self._series_strip = SliceBar(rail)
        rc.addWidget(self._series_strip)
        self._report = ReportPanel("light", rail)
        rc.addWidget(self._report, 1)
        self._wl_panel = WindowLevelPanel(rail)
        rc.addWidget(self._wl_panel)
        self._annotation_panel = AnnotationPanel(self._style, rail)
        rc.addWidget(self._annotation_panel)
        body.addWidget(rail, 0)
        outer.addWidget(body, 1)

        # viewer status line
        self._viewer_status = QLabel("", page)
        outer.addWidget(self._viewer_status)
        return page

    def _widget_wrapper(self, widget, bar):
        from PySide6.QtWidgets import QWidgetAction
        action = QWidgetAction(bar)
        action.setDefaultWidget(widget)
        return action

    # -------------------------------------------------------------- wiring

    def _connect(self) -> None:
        self._back.triggered.connect(self._back_to_studies)
        self._search.textChanged.connect(self._apply_filter)
        self._modality.currentIndexChanged.connect(self._apply_filter)
        self._dataset.currentIndexChanged.connect(self._apply_filter)
        self._layout_combo.currentIndexChanged.connect(self._on_layout_combo)
        self._series_combo.currentIndexChanged.connect(self._on_series_combo)

        self._bridge.frameReady.connect(self._on_frame_ready)
        self._bridge.thumbReady.connect(self._on_thumb_ready)

        lm = self._layout_manager
        lm.activePaneChanged.connect(self._on_active_pane)
        lm.layoutChanged.connect(self._on_layout_changed)
        for _ in ():
            pass
        # pane signals are connected as panes are created
        self._wl_panel.viewChanged.connect(self._on_wl_changed)
        self._wl_panel.wlApplied.connect(self._on_wl_shared)
        self._toolbar.viewChanged.connect(self._on_toolbar_view)
        self._toolbar.layerToggled.connect(self._on_layer_toggled)
        self._annotation_panel.changed.connect(self._refresh_annotations)
        self._annotation_panel.clearRequested.connect(self._clear_annotations)

    def _connect_pane(self, pane: ViewportPane) -> None:
        pane.activated.connect(self._on_pane_activated)
        pane.positionPicked.connect(self._on_position_picked)
        pane.sliceChanged.connect(self._on_pane_slice)
        pane.viewChanged.connect(self._on_pane_view)
        pane.annotationAdded.connect(self._on_annotation_line)
        pane.markerAdded.connect(self._on_annotation_marker)
        pane.presetChanged.connect(self._on_3d_preset)

    # ------------------------------------------------------------ shortcuts

    def _apply_shortcuts(self) -> None:
        QShortcut(QKeySequence("L"), self, self._toggle_link)
        QShortcut(QKeySequence("C"), self, self._toggle_crosshairs)
        QShortcut(QKeySequence("M"), self, self._cycle_layout)
        QShortcut(QKeySequence("Esc"), self, self._restore_layout)

    # ------------------------------------------------------------- studies

    def _apply_filter(self) -> None:
        from core.db import StudyQuery
        query = StudyQuery(
            text=self._search.text(),
            modality=self._modality.currentData(),
            dataset=self._dataset.currentData(),
        )
        self._table_model.set_query(query)

    def _show_index_error(self, message: str) -> None:
        QMessageBox.warning(self, "Study list unavailable", str(message))

    def _open_study(self, index_or_id) -> None:
        if hasattr(index_or_id, "row"):
            row = index_or_id.row()
            study = self._table_model.study_at(row)
            if study is None:
                return
            study_id = study.id
        else:
            study_id = str(index_or_id)
        self.open_study(study_id)

    def open_study(self, study_id: str) -> None:
        detail = self._bridge.loader.detail(study_id)
        if detail is None:
            QMessageBox.warning(self, "Unable to load study",
                                "This study is not in the index.")
            return
        self._detail = detail
        self._study_ids = self._table_model.ids()
        try:
            self._study_pos = self._study_ids.index(study_id)
        except ValueError:
            self._study_pos = -1

        self._series_list = detail.series
        self._series_combo.blockSignals(True)
        self._series_combo.clear()
        for s in detail.series:
            label = s.label or s.id
            self._series_combo.addItem(f"{label} ({s.frame_count})", s.id)
        self._series_combo.blockSignals(False)

        self._report.set_report(
            self._index.source_report(study_id)) if hasattr(self._report, "set_report") else None
        self._pages.setCurrentIndex(1)
        if detail.series:
            self._select_series(detail.series[0].id)

    def _back_to_studies(self) -> None:
        self._pages.setCurrentIndex(0)
        self._close_study_resources()

    def _close_study_resources(self) -> None:
        """Drop per-study GPU memory and stop prefetch when leaving the viewer."""
        self._3d_shared.set_volume(None, (0, 0, 0), (1.0, 1.0, 1.0))
        self._geom = None
        self._reslice_cache.clear()
        self._bridge.prefetcher.clear()

    # ------------------------------------------------------------- series

    def _on_series_combo(self, _index: int) -> None:
        sid = self._series_combo.currentData()
        if sid:
            self._select_series(sid)

    def _select_series(self, series_id: str) -> None:
        if self._detail is None:
            return
        series = self._detail.series_by_id(series_id)
        if series is None:
            return
        self._series = series
        volume = self._detail.volume_for(series)
        self._geom = None
        if volume is not None:
            self._load_volume_geometry(volume)
        lm = self._layout_manager
        for pane in lm.panes():
            total = series.frame_count
            if self._geom is not None:
                plane_geom = self._geom.plane(
                    self._pane_to_plane(pane))
                total = max(total, plane_geom.slice_count)
            pane.set_series(total, series.orientation or "", 0)
        self._ijk = (0, 0, 0)
        self._refresh_all_panes()
        self._maybe_start_3d()
        self._refresh_annotations()

    # -------------------------------------------------- volume geometry/3-D

    def _load_volume_geometry(self, volume) -> None:
        from core.imaging.stack import dicom_volume_geometry, DicomVolumeRef
        from core.imaging.nifti import read_nifti_geometry
        if getattr(volume, "files", None):
            ref = self._bridge.loader.volume_ref(volume)
            self._geom = dicom_volume_geometry(ref)
        else:
            try:
                path = self._bridge.loader.resolve(str(getattr(volume, "frames_path", "") or ""))
                self._geom = read_nifti_geometry(path)
            except ValueError:
                self._geom = None

    def _maybe_start_3d(self) -> None:
        """Prepare and upload the volume for the shared 3-D pane, off-thread."""
        if self._series is None or self._detail is None:
            return
        volume = self._detail.volume_for(self._series)
        if volume is None:
            return
        if self._3d_thread is not None and self._3d_thread.is_alive():
            return
        series = self._series

        def work() -> None:
            try:
                from core.imaging.stack import export_dicom_volume
                from core.imaging.nifti import read_nifti_geometry
                from pathlib import Path as _P
                prepared = None
                if getattr(volume, "files", None):
                    ref = self._bridge.loader.volume_ref(volume)
                    exported = export_dicom_volume(ref, use_cache=True)
                    if exported is not None:
                        prepared = prepare_volume(exported.data)
                else:
                    path = self._bridge.loader.resolve(str(volume.frames_path or ""))
                    from core.imaging.nifti import load_volume
                    vol = load_volume(path)
                    prepared = prepare_volume(vol.data)
                if prepared is not None:
                    data, dims, step, vmin, vmax = prepared
                    QGuiApplication.instance().metaObject()  # touch main lib
                    self._3d_apply(data, dims, (1.0, 1.0, 1.0), step, vmin, vmax)
            except Exception:  # noqa: BLE001
                log.exception("3d: volume preparation failed")

        self._3d_thread = threading.Thread(target=work, daemon=True,
                                           name="volume-3d-prepare")
        self._3d_thread.start()

    def _3d_apply(self, data, dims, spacing, step, vmin, vmax) -> None:
        # GL updates must happen on the GL thread; marshal through a QTimer.
        QTimer.singleShot(0, lambda: (self._3d_shared.set_volume(
            data, dims, spacing, step_note=step, vmin=vmin, vmax=vmax),
            self._3d_shared.update()))

    # --------------------------------------------------------- linked nav

    def _on_pane_activated(self, pane) -> None:
        self._connect_pane_once(pane)

    def _connect_pane_once(self, pane) -> None:
        if getattr(pane, "_page_connected", False):
            return
        self._connect_pane(pane)
        pane._page_connected = True

    def _on_active_pane(self, pane) -> None:
        self._connect_pane_once(pane)
        self._refresh_wl_panel(pane)

    def _pane_to_plane(self, pane) -> str:
        return pane.plane if pane.plane in VIEW_2D else "Axial"

    def _on_position_picked(self, pane, plane, nx, ny) -> None:
        self._connect_pane_once(pane)
        if self._geom is None or plane not in VIEW_2D:
            return
        slice_index = pane.slice_index()
        self._ijk = voxel_from_plane(self._geom, plane, slice_index, nx, ny)
        self._propagate_position(from_pane=pane)

    def _on_pane_slice(self, pane, plane, index) -> None:
        self._connect_pane_once(pane)
        if self._geom is not None and plane in VIEW_2D:
            # keep the in-plane point, move the through-axis to this slice
            _, nx, ny = plane_position(self._geom, plane, self._ijk)
            self._ijk = voxel_from_plane(self._geom, plane, index, nx, ny)
        self._propagate_position(from_pane=pane, moved_pane=pane, moved_slice=True)
        self._refresh_all_panes(except_pane=pane)

    def _propagate_position(self, from_pane=None, moved_pane=None,
                            moved_slice: bool = False) -> None:
        if self._geom is None:
            return
        if not self._linked:
            if moved_pane is not None:
                self._set_crosshair(moved_pane, None)
            return
        positions = all_planes(self._geom, self._ijk)
        for pane in self._layout_manager.panes():
            if pane.plane not in VIEW_2D:
                continue
            slice_index, nx, ny = positions[pane.plane]
            if pane is not moved_pane or moved_slice:
                pane.set_slice_index(slice_index)
            if self._show_crosshairs:
                pane.set_crosshair((nx, ny))
                self._show_crosshair_on(pane, nx, ny)
            if pane is not from_pane and pane is not moved_pane:
                self._request_frame(pane, slice_index)

    def _show_crosshair_on(self, pane, nx: float, ny: float) -> None:
        """Paint the crosshair inside FrameView's overlay coordinate space."""
        overlay = pane.overlay()
        overlay.markers.append(_CrosshairMarker(nx, ny))
        pane.set_overlay(overlay)

    def _set_crosshair(self, pane, pos) -> None:
        pane.set_crosshair(pos)

    def _on_pane_view(self, pane, view) -> None:
        self._toolbar.set_view(view)

    # ------------------------------------------------------------ frames

    def _request_frame(self, pane: ViewportPane, slice_index: int) -> None:
        if self._detail is None or self._series is None:
            return
        if self._geom is not None and pane.plane in VIEW_2D:
            # MPR reslice path through the NIfTI/volume renderer is handled by
            # core; here we reuse the series frame path when the pane shows the
            # acquired plane, else ask the loader for a plane frame.
            plane_name = pane.plane
            acquired = self._geom.acquired_plane
            if plane_name == acquired:
                self._request_series_frame(pane, slice_index)
                return
            # reslice: delegate to the nifti/stack render via a synthetic frame
            self._request_reslice_frame(pane, plane_name, slice_index)
            return
        self._request_series_frame(pane, slice_index)

    def _request_series_frame(self, pane, index: int) -> None:
        key = (id(pane), self._series.id, index)
        self._pane_slices[key] = True
        stats = self._bridge.focus(self._detail, self._series, index)
        _ = stats

    def _request_reslice_frame(self, pane, plane_name: str, slice_index: int) -> None:
        """Render a non-acquired plane through core on a worker, with an LRU.

        A reslice costs a real decode, so results are memoised per
        (series, plane, slice, index build): scrolling back through a sagittal
        stack hits the cache instead of re-slicing, exactly as the acquired
        plane hits ``render_image_cached``.  The cache is dropped when the
        study changes so memory does not accumulate across studies.
        """
        import threading
        series = self._series
        volume = self._detail.volume_for(series)
        cache_key = (self._bridge.loader.build_id, series.id, plane_name, slice_index)
        hit = self._reslice_cache.get(cache_key)
        if hit is not None:
            image = _gray_to_qimage(hit)
            pane.set_frame(image)
            return

        def work() -> None:
            try:
                from core.imaging.render import RenderedFrame
                gray = None
                if volume is not None and getattr(volume, "files", None):
                    from core.imaging.stack import (DicomVolumeRef, load_dicom_stack,
                                                    render_dicom_volume)
                    from dataclasses import replace as _replace
                    ref = self._bridge.loader.volume_ref(volume)
                    stack = load_dicom_stack(ref)
                    if stack is not None:
                        g = self._geom.plane(plane_name)
                        from core.imaging.reslice import reslice_to_gray
                        gray = reslice_to_gray(
                            stack.data, stack.geometry.dims, g, slice_index,
                            stack.slope, stack.intercept)
                else:
                    from core.imaging.nifti import load_volume, render_nifti
                    path = self._bridge.loader.resolve(str(series.frames_path or ""))
                    vol = load_volume(path)
                    from core.imaging.reslice import reslice_to_gray
                    g = self._geom.plane(plane_name)
                    gray = reslice_to_gray(
                        vol.data, self._geom.dims, g, slice_index,
                        vol.slope, vol.intercept, window=vol.window)
                if gray is not None:
                    self._reslice_cache.put(cache_key, gray)
                    QTimer.singleShot(0, lambda: self._deliver_reslice(
                        pane, plane_name, slice_index, gray))
            except Exception:  # noqa: BLE001
                log.exception("reslice failed: %s slice %d", plane_name, slice_index)

        threading.Thread(target=work, daemon=True, name="reslice").start()

    def _deliver_reslice(self, pane, plane_name, slice_index, gray) -> None:
        if self._geom is None or pane.plane != plane_name:
            return
        if pane.slice_index() != slice_index:
            return
        image = _gray_to_qimage(gray)
        pane.set_frame(image)

    # ----------------------------------------------------- frame delivery

    def _on_frame_ready(self, key: str, load) -> None:
        if load is None or self._detail is None:
            return
        if self._series is None or not key.startswith(str(self._series.id)):
            return
        image = to_qimage(load.frame if hasattr(load, "frame") else None)
        if image is None and load.gray is not None:
            image = _gray_to_qimage(load.gray)
        if image is None:
            pane = self._active_pane_for_key(key)
            pane.set_message("Unable to load image.",
                             getattr(load, "message", "") or "")
            return
        target = self._pane_for_key(key)
        if target is not None:
            target.set_frame(image)

    def _on_thumb_ready(self, key: str, load) -> None:  # thumbnails unused in MVP rail
        pass

    def _pane_for_key(self, key: str):
        """Route a bridge frame to the pane showing the acquired plane."""
        for pane in self._layout_manager.panes():
            if pane.plane in VIEW_2D and self._geom is not None and \
                    self._geom.acquired_plane == pane.plane:
                return pane
        return self._layout_manager.active_pane()

    def _active_pane_for_key(self, key: str):
        return self._layout_manager.active_pane()

    # --------------------------------------------------------- W/L sharing

    def _refresh_wl_panel(self, pane) -> None:
        self._wl_panel.set_view(pane.view_state())

    def _on_wl_changed(self, view) -> None:
        active = self._layout_manager.active_pane()
        if active is not None:
            active.set_view(view)

    def _on_wl_shared(self, brightness: int, contrast: int, inverted: bool) -> None:
        if not self._wl_panel.linked():
            return
        for pane in self._layout_manager.panes():
            if pane is self._layout_manager.active_pane():
                continue
            if pane.plane in VIEW_2D:
                pane.set_view(_with_wl(pane.view_state(), brightness, contrast, inverted))

    def _on_toolbar_view(self, view) -> None:
        active = self._layout_manager.active_pane()
        if active is not None:
            active.set_view(view)

    def _on_layer_toggled(self, name: str, visible: bool) -> None:
        for pane in self._layout_manager.panes():
            pane.view.set_layer_visible(name, visible)

    # ----------------------------------------------------------- annotations

    def _on_annotation_line(self, pane, kind, x1, y1, x2, y2) -> None:
        self._add_annotation_from_pane(pane, LINE, [(x1, y1), (x2, y2)])

    def _on_annotation_marker(self, pane, x, y) -> None:
        self._add_annotation_from_pane(pane, POINT, [(x, y)])

    def _add_annotation_from_pane(self, pane, kind, norm_points) -> None:
        if self._geom is None or self._detail is None:
            return
        from core.imaging.navigation import volume_affine
        matrix, origin = volume_affine(
            self._geom.dims, self._geom.spacing, self._current_affine())
        ijk_points = []
        for nx, ny in norm_points:
            ijk = voxel_from_plane(self._geom, self._pane_to_plane(pane),
                                   pane.slice_index(), nx, ny)
            ijk_points.append(ijk)
        ann = Annotation(
            id=f"{self._detail.study.id}-{kind}-{int(QTimer().remainingTime() if False else _now_ms())}",
            kind=kind, study_id=self._detail.study.id,
            series_id=self._series.id if self._series else "",
            points=[(0.0, 0.0, 0.0)] * len(ijk_points),
            plane=self._pane_to_plane(pane), slice_index=pane.slice_index(),
        )
        from core.annotations import voxel_to_annotation
        ann = voxel_to_annotation(
            matrix, origin, kind, self._detail.study.id,
            self._series.id if self._series else "", ijk_points,
            ann.id, plane=ann.plane, slice_index=ann.slice_index)
        self._store.add(ann)
        self._refresh_annotations()

    def _current_affine(self):
        return getattr(self, "_affine", None)

    def _clear_annotations(self) -> None:
        if self._detail is not None:
            self._store.clear_study(self._detail.study.id)
            self._refresh_annotations()

    def _refresh_annotations(self) -> None:
        if self._detail is None:
            return
        # display-only refresh: annotations repaint through FrameView overlays
        for pane in self._layout_manager.panes():
            pane.view.update()

    def _on_3d_preset(self, preset_id: str, legend: str) -> None:
        self._viewer_status.setText(f"3-D color mapping: {legend}")

    # -------------------------------------------------------------- layout

    def _on_layout_combo(self, _index: int) -> None:
        layout = self._layout_combo.currentData()
        if layout:
            self._layout_manager.set_layout(layout)
            for pane in self._layout_manager.panes():
                self._connect_pane_once(pane)
            self._refresh_all_panes()
            self._maybe_start_3d()

    def _cycle_layout(self) -> None:
        idx = self._layout_combo.currentIndex()
        self._layout_combo.setCurrentIndex((idx + 1) % self._layout_combo.count())

    def _restore_layout(self) -> None:
        self._layout_manager.restore()

    def _toggle_link(self) -> None:
        self._linked = not self._linked
        self._viewer_status.setText(
            "Linked navigation: ON" if self._linked else "Linked navigation: OFF")
        if self._linked:
            self._propagate_position()

    def _toggle_crosshairs(self) -> None:
        self._show_crosshairs = not self._show_crosshairs
        for pane in self._layout_manager.panes():
            pane.set_crosshair(None if not self._show_crosshairs else pane.crosshair())

    def _on_layout_changed(self, layout: str) -> None:
        for pane in self._layout_manager.panes():
            self._connect_pane_once(pane)

    def _refresh_all_panes(self, except_pane=None) -> None:
        if self._geom is None:
            # fall back to plain series frames everywhere
            for pane in self._layout_manager.panes():
                if pane is except_pane:
                    continue
                self._request_series_frame(pane, pane.slice_index())
            return
        for pane in self._layout_manager.panes():
            if pane is except_pane or pane.plane not in VIEW_2D:
                continue
            self._request_frame(pane, pane.slice_index())

    # ------------------------------------------------------------- close

    def closeEvent(self, event) -> None:  # noqa: N802
        self._bridge.shutdown()
        super().closeEvent(event)


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)


class _CrosshairMarker:
    """A tiny marker the FrameView paints as crosshair lines."""

    def __init__(self, nx: float, ny: float) -> None:
        self.x = nx
        self.y = ny
        self.label = "+"


def _gray_to_qimage(gray) -> QImage:
    import numpy as _np
    pixels = _np.ascontiguousarray(gray.pixels)
    h, w = pixels.shape
    image = QImage(pixels.data, w, h, w, QImage.Format.Format_Indexed8).copy()
    image.setColorTable([0xFF000000 | (v << 16) | (v << 8) | v for v in range(256)])
    return image


def _with_wl(view: ViewState, brightness: int, contrast: int, inverted: bool) -> ViewState:
    from dataclasses import replace
    return replace(view, brightness=brightness, contrast=contrast, inverted=inverted)


class _LRUCache:
    """Small thread-safe LRU for decoded reslices (bounded by item count)."""

    def __init__(self, max_items: int = 256) -> None:
        import threading as _t
        self._lock = _t.Lock()
        self._items: dict = {}
        self._max = max_items

    def get(self, key):
        with self._lock:
            hit = self._items.get(key)
            if hit is not None:
                self._items.move_to_end(key)
            return hit

    def put(self, key, value) -> None:
        with self._lock:
            if key in self._items:
                self._items.move_to_end(key)
            self._items[key] = value
            while len(self._items) > self._max:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()