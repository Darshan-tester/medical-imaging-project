"""
Meridian desktop workstation main window.

Connects the manifest/data services to the 2-D SliceView and optional VTK
3-D viewer.  Image and volume decoding stay off the GUI thread.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np

from PySide6.QtCore import Qt, QTimer, QPointF
from PySide6.QtWidgets import (
    QMainWindow,
    QWidget,
    QHBoxLayout,
    QVBoxLayout,
    QLabel,
    QLineEdit,
    QComboBox,
    QListWidget,
    QListWidgetItem,
    QTabWidget,
    QTextEdit,
    QSplitter,
    QToolBar,
    QPushButton,
    QSlider,
    QMessageBox,
    QStatusBar,
    QSizePolicy,
)

import sys
_desktop_dir = Path(__file__).resolve().parent
if str(_desktop_dir) not in sys.path:
    sys.path.insert(0, str(_desktop_dir))

try:
    from ..config import Config
    from ..dataset.manifest import ManifestIndex, Study, Series
    from ..dataset.imageloader import SliceCache, SliceLoader
    from ..dataset.volumes import VolumeService
    from ..dataset.annotations import (
        Annotation,
        AnnotationStore,
        plane_px_to_voxel,
        measurement_length_mm,
    )
    from ..viewer.sliceview import SliceView
    try:
        from ..viewer.vtk3d import VTKVolumeWidget, HAS_VTK
    except Exception:
        VTKVolumeWidget = None
        HAS_VTK = False
except (ImportError, ValueError):
    try:
        from meridian_desktop.config import Config
        from meridian_desktop.dataset.manifest import ManifestIndex, Study, Series
        from meridian_desktop.dataset.imageloader import SliceCache, SliceLoader
        from meridian_desktop.dataset.volumes import VolumeService
        from meridian_desktop.dataset.annotations import (
            Annotation,
            AnnotationStore,
            plane_px_to_voxel,
            measurement_length_mm,
        )
        from meridian_desktop.viewer.sliceview import SliceView
        try:
            from meridian_desktop.viewer.vtk3d import VTKVolumeWidget, HAS_VTK
        except Exception:
            VTKVolumeWidget = None
            HAS_VTK = False
    except ImportError:
        from config import Config
        from dataset.manifest import ManifestIndex, Study, Series
        from dataset.imageloader import SliceCache, SliceLoader
        from dataset.volumes import VolumeService
        from dataset.annotations import (
            Annotation,
            AnnotationStore,
            plane_px_to_voxel,
            measurement_length_mm,
        )
        from viewer.sliceview import SliceView
        try:
            from viewer.vtk3d import VTKVolumeWidget, HAS_VTK
        except Exception:
            VTKVolumeWidget = None
            HAS_VTK = False


log = logging.getLogger(__name__)


STYLESHEET = """
QMainWindow {
    background: #101317;
    color: #d8dee5;
}

QWidget {
    background: #101317;
    color: #d8dee5;
}

QLineEdit, QComboBox, QTextEdit, QListWidget {
    background: #181d22;
    border: 1px solid #303840;
    border-radius: 3px;
    padding: 5px;
    color: #e2e8ee;
}

QComboBox QAbstractItemView {
    background: #181d22;
    color: #e2e8ee;
    selection-background-color: #29465a;
}

QListWidget::item {
    padding: 7px;
    border-bottom: 1px solid #252b31;
}

QListWidget::item:selected {
    background: #24435a;
}

QPushButton {
    background: #20272e;
    border: 1px solid #39434d;
    border-radius: 3px;
    padding: 5px 9px;
}

QPushButton:hover {
    background: #29333c;
}

QPushButton:checked {
    background: #315b78;
    border-color: #4e86aa;
}

QToolBar {
    background: #151a1f;
    border: none;
    spacing: 3px;
    padding: 3px;
}

QSlider::groove:horizontal {
    height: 4px;
    background: #303840;
}

QSlider::handle:horizontal {
    width: 12px;
    margin: -5px 0;
    background: #5d91b2;
    border-radius: 6px;
}

QStatusBar {
    background: #151a1f;
    color: #9aa7b3;
}

QTabWidget::pane {
    border: 1px solid #303840;
}

QTabBar::tab {
    background: #181d22;
    padding: 6px 10px;
}

QTabBar::tab:selected {
    background: #27333d;
}

QLabel#sectionLabel {
    color: #8da1b2;
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1px;
}
"""


class WorkstationWindow(QMainWindow):
    """Main Meridian medical imaging workstation."""

    def __init__(self, cfg: Config) -> None:
        super().__init__()

        self.cfg = cfg
        self.index: Optional[ManifestIndex] = None
        self.current_study: Optional[Study] = None
        self.current_series: Optional[Series] = None

        self.current_slice = 0
        self.current_plane = "axial"

        self._volume = None
        self._spacing = (1.0, 1.0, 1.0)

        self.slice_cache = SliceCache(max_items=256)
        self.slice_loader = SliceLoader(self.slice_cache, max_workers=4)
        self.volume_service = VolumeService(max_workers=2)

        annotation_dir = (
            Path.home() / ".meridian" / "annotations"
        )
        self.annotation_store = AnnotationStore(str(annotation_dir))

        self._views_widgets: dict[str, SliceView] = {}
        self._tool_buttons: dict[str, QPushButton] = {}
        self._loading_volume = False

        self.setWindowTitle("Meridian — Medical Imaging Workstation")
        self.resize(1600, 950)
        self.setStyleSheet(STYLESHEET)

        self._build_ui()
        self._load_manifest()

    # ------------------------------------------------------------------
    # UI construction
    # ------------------------------------------------------------------

    def _build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)

        root = QHBoxLayout(central)
        root.setContentsMargins(6, 6, 6, 6)
        root.setSpacing(6)

        # ------------------------------------------------------------
        # LEFT: STUDIES
        # ------------------------------------------------------------

        left = QWidget()
        lv = QVBoxLayout(left)
        lv.setContentsMargins(0, 0, 0, 0)

        lab = QLabel("STUDIES")
        lab.setObjectName("sectionLabel")
        lv.addWidget(lab)

        self.search = QLineEdit()
        self.search.setPlaceholderText(
            "Search patient / study ID / modality…"
        )
        self.search.textChanged.connect(self._refresh_study_list)
        lv.addWidget(self.search)

        self.modality_filter = QComboBox()
        self.modality_filter.currentTextChanged.connect(
            self._refresh_study_list
        )
        lv.addWidget(self.modality_filter)

        self.study_list = QListWidget()
        self.study_list.itemActivated.connect(self._open_study)
        self.study_list.itemClicked.connect(self._open_study)
        lv.addWidget(self.study_list)

        leftw = QWidget()
        leftw.setLayout(lv)
        leftw.setFixedWidth(280)

        # ------------------------------------------------------------
        # CENTRE: VIEWER
        # ------------------------------------------------------------

        centre = QWidget()

        cv = QVBoxLayout(centre)
        cv.setContentsMargins(0, 0, 0, 0)
        cv.setSpacing(4)

        self.viewer_area = QWidget()

        self.viewer_layout_v = QVBoxLayout(self.viewer_area)
        self.viewer_layout_v.setContentsMargins(0, 0, 0, 0)
        self.viewer_layout_v.setSpacing(4)

        cv.addWidget(self._build_toolbar())
        cv.addWidget(self.viewer_area, 1)

        centre_w = centre

        # ------------------------------------------------------------
        # RIGHT: REPORT / ANNOTATIONS
        # ------------------------------------------------------------

        right = QWidget()

        rv = QVBoxLayout(right)
        rv.setContentsMargins(0, 0, 0, 0)

        self.right_tabs = QTabWidget()

        self.report_text = QTextEdit()
        self.report_text.setReadOnly(True)
        self.right_tabs.addTab(self.report_text, "Report")

        self.findings_text = QTextEdit()
        self.findings_text.setReadOnly(True)
        self.right_tabs.addTab(self.findings_text, "AI Findings")

        self.ann_list = QListWidget()
        self.right_tabs.addTab(self.ann_list, "Annotations")

        rv.addWidget(self.right_tabs, 1)

        disclaimer = QLabel(
            "This report is AI-assisted and requires review and "
            "approval by a licensed radiologist before clinical use."
        )
        disclaimer.setWordWrap(True)
        disclaimer.setStyleSheet(
            "color:#8a6d3b; background:#1a160c; padding:6px;"
        )
        rv.addWidget(disclaimer)

        rightw = QWidget()
        rightw.setLayout(rv)
        rightw.setFixedWidth(340)

        # ------------------------------------------------------------
        # MAIN SPLITTER
        # ------------------------------------------------------------

        self.split = QSplitter()
        self.split.addWidget(leftw)
        self.split.addWidget(centre_w)
        self.split.addWidget(rightw)
        self.split.setSizes([280, 1000, 340])

        root.addWidget(self.split)

        self.statusBar().showMessage("Ready")

        self._wl_status_timer = QTimer(self)
        self._wl_status_timer.setInterval(400)
        self._wl_status_timer.timeout.connect(
            self._update_wl_status
        )
        self._wl_status_timer.start()

    def _build_toolbar(self) -> QToolBar:
        toolbar = QToolBar()
        toolbar.setMovable(False)

        for tool, label in (
            ("select", "Select"),
            ("pan", "Pan"),
            ("zoom", "Zoom"),
            ("wl", "W/L"),
            ("line", "Line"),
            ("measure", "Measure"),
            ("rect", "Rect"),
            ("ellipse", "Ellipse"),
            ("freehand", "Freehand"),
            ("text", "Text"),
        ):
            btn = QPushButton(label)
            btn.setCheckable(True)
            btn.clicked.connect(
                lambda checked=False, t=tool: self._set_tool(t)
            )
            self._tool_buttons[tool] = btn
            toolbar.addWidget(btn)

        toolbar.addSeparator()

        for plane in ("axial", "coronal", "sagittal"):
            btn = QPushButton(plane.capitalize())
            btn.setCheckable(True)
            btn.clicked.connect(
                lambda checked=False, p=plane: self._set_plane(p)
            )
            self._tool_buttons[f"plane:{plane}"] = btn
            toolbar.addWidget(btn)

        toolbar.addSeparator()

        fit = QPushButton("Fit")
        fit.clicked.connect(self._fit_views)
        toolbar.addWidget(fit)

        invert = QPushButton("Invert")
        invert.setCheckable(True)
        invert.clicked.connect(self._set_invert)
        toolbar.addWidget(invert)

        reset = QPushButton("Reset 3D")
        reset.clicked.connect(self._reset_3d)
        toolbar.addWidget(reset)

        self._set_tool("wl")
        self._set_plane("axial")

        return toolbar

    # ------------------------------------------------------------------
    # Manifest / studies
    # ------------------------------------------------------------------

    def _load_manifest(self) -> None:
        manifest_path = self.cfg.manifest_path()

        if not manifest_path:
            self.statusBar().showMessage(
                "No manifest found. Configure SCANLAB_DATA_ROOT or manifest_path."
            )
            return

        try:
            self.index = ManifestIndex(manifest_path)
            count = self.index.load()

            self.modality_filter.blockSignals(True)
            self.modality_filter.clear()
            self.modality_filter.addItem("All modalities")
            self.modality_filter.addItems(self.index.modalities())
            self.modality_filter.blockSignals(False)

            self._refresh_study_list()

            self.statusBar().showMessage(
                f"Loaded {count} studies"
            )

        except Exception as exc:
            log.exception("Failed to load manifest")
            self.statusBar().showMessage(
                f"Manifest error: {exc}"
            )

    def _refresh_study_list(self) -> None:
        if self.index is None:
            return

        modality = self.modality_filter.currentText()
        if modality == "All modalities":
            modality = ""

        studies = self.index.search(
            self.search.text(),
            modality,
        )

        self.study_list.blockSignals(True)
        self.study_list.clear()

        for study in studies:
            label = self._study_label(study)
            item = QListWidgetItem(label)
            item.setData(Qt.UserRole, study.id)
            self.study_list.addItem(item)

        self.study_list.blockSignals(False)

    @staticmethod
    def _study_label(study: Study) -> str:
        patient = study.patient_alias or "Unknown patient"
        modality = study.modality or "?"
        date = study.date or ""
        code = study.study_code or study.id

        suffix = f"  {date}" if date else ""

        return f"{patient}\n{modality} · {code}{suffix}"

    def _open_study(self, item: QListWidgetItem) -> None:
        if self.index is None:
            return

        study_id = item.data(Qt.UserRole)
        study = self.index.by_id(study_id)

        if study is None:
            return

        self.current_study = study
        self.current_series = None
        self.current_slice = 0
        self._volume = None
        self._loading_volume = False

        self._update_report(study)
        self._update_findings(study)
        self._update_annotations()

        if not study.series:
            self.statusBar().showMessage(
                f"{study.patient_alias}: no image series"
            )
            return

        # Prefer the first series with images.
        series = next(
            (s for s in study.series if s.num_images > 0),
            study.series[0],
        )

        self._set_series(series)

    # ------------------------------------------------------------------
    # Series / slices
    # ------------------------------------------------------------------

    def _set_series(self, series: Series) -> None:
        self.current_series = series
        self.current_slice = min(
            self.current_slice,
            max(0, series.num_images - 1),
        )

        self.statusBar().showMessage(
            f"{series.label or series.id} · "
            f"{series.num_images} slices"
        )

        self._request_current_slice()

        # Volume creation is lazy.
        if series.num_images > 1:
            self._request_volume()

    def _request_current_slice(self) -> None:
        series = self.current_series

        if series is None or series.num_images <= 0:
            return

        index = max(
            0,
            min(self.current_slice, series.num_images - 1),
        )

        self.current_slice = index

        self.statusBar().showMessage(
            f"{self.current_plane.capitalize()} "
            f"{index + 1}/{series.num_images}"
        )

        self.slice_loader.request_slice(
            series,
            index,
            self._slice_loaded,
        )

    def _slice_loaded(self, index: int, arr) -> None:
        # Worker callbacks are normally invoked from the loader worker.
        # Marshal UI changes back onto the Qt event loop.
        QTimer.singleShot(
            0,
            lambda i=index, a=arr: self._apply_loaded_slice(i, a),
        )

    def _apply_loaded_slice(self, index: int, arr) -> None:
        if self.current_series is None:
            return

        if index != self.current_slice:
            return

        view = self._views_widgets.get(self.current_plane)
        if view is None:
            return

        if arr is None:
            view.overlay_info = "Unable to load image"
            view.set_slice(None)
            self.statusBar().showMessage(
                "Unable to decode image"
            )
            return

        spacing = self._slice_spacing()

        view.set_slice(
            arr,
            spacing=spacing,
            keep_wl=True,
        )

        view.overlay_info = (
            f"{self.current_plane.capitalize()} "
            f"{index + 1}/{self.current_series.num_images}"
        )

        self._update_annotations()
        view.update()

    def _slice_spacing(self) -> tuple[float, float]:
        if self.current_series is None:
            return (1.0, 1.0)

        if self._spacing:
            # spacing is z,y,x; SliceView expects row,col.
            return (
                float(self._spacing[1]),
                float(self._spacing[2]),
            )

        return (1.0, 1.0)

    # ------------------------------------------------------------------
    # Viewer construction
    # ------------------------------------------------------------------

    def _views(self) -> dict[str, SliceView]:
        return self._views_widgets

    def _ensure_views(self) -> None:
        if self._views_widgets:
            return

        for plane in ("axial", "coronal", "sagittal"):
            view = SliceView(self.viewer_area)

            view.sliceSelected.connect(
                lambda delta, p=plane: self._change_slice(delta, p)
            )

            view.wlChanged.connect(
                lambda ww, wl, p=plane: self._sync_wl(p, ww, wl)
            )

            view.annotationCreated.connect(
                lambda data, p=plane: self._create_annotation(p, data)
            )

            view.statusMessage.connect(
                self.statusBar().showMessage
            )

            self._views_widgets[plane] = view

        # Build a simple MPR layout.
        top = QWidget()
        top_layout = QHBoxLayout(top)
        top_layout.setContentsMargins(0, 0, 0, 0)
        top_layout.setSpacing(3)

        top_layout.addWidget(self._views_widgets["axial"])
        top_layout.addWidget(self._views_widgets["coronal"])

        bottom = QWidget()
        bottom_layout = QHBoxLayout(bottom)
        bottom_layout.setContentsMargins(0, 0, 0, 0)

        bottom_layout.addWidget(self._views_widgets["sagittal"])

        if HAS_VTK and VTKVolumeWidget is not None:
            try:
                self.volume_view = VTKVolumeWidget()
                bottom_layout.addWidget(self.volume_view)
            except Exception:
                self.volume_view = None
        else:
            self.volume_view = None

        self.viewer_layout_v.addWidget(top, 1)
        self.viewer_layout_v.addWidget(bottom, 1)

    # ------------------------------------------------------------------
    # Tools / planes
    # ------------------------------------------------------------------

    def _set_tool(self, tool: str) -> None:
        self._ensure_views()

        for name, button in self._tool_buttons.items():
            if name.startswith("plane:"):
                continue
            button.setChecked(name == tool)

        for view in self._views_widgets.values():
            view.tool = tool

        self.statusBar().showMessage(
            f"Tool: {tool}"
        )

    def _set_plane(self, plane: str) -> None:
        self._ensure_views()

        self.current_plane = plane

        for name, button in self._tool_buttons.items():
            if name.startswith("plane:"):
                button.setChecked(name == f"plane:{plane}")

        self._request_current_slice()

    def _change_slice(self, delta: int, plane: str) -> None:
        if self.current_series is None:
            return

        count = self.current_series.num_images
        if count <= 0:
            return

        self.current_slice = max(
            0,
            min(count - 1, self.current_slice + delta),
        )

        self._request_current_slice()

    def _fit_views(self) -> None:
        self._ensure_views()

        for view in self._views_widgets.values():
            view.fit()

    def _set_invert(self, checked: bool) -> None:
        self._ensure_views()

        for view in self._views_widgets.values():
            view.set_invert(checked)

    def _sync_wl(self, source_plane: str, ww: float, wl: float) -> None:
        self._ensure_views()

        for plane, view in self._views_widgets.items():
            if plane != source_plane:
                view.set_ww_wl(
                    ww,
                    wl,
                    from_external=True,
                )

    def _update_wl_status(self) -> None:
        view = self._views_widgets.get(self.current_plane)

        if view is None:
            return

        ww, wl = view.ww_wl()

        self.statusBar().showMessage(
            f"{self.current_plane.capitalize()} · "
            f"Slice {self.current_slice + 1} · "
            f"WW {ww:.0f} · WL {wl:.0f}"
        )

    # ------------------------------------------------------------------
    # Volume / 3D
    # ------------------------------------------------------------------

    def _request_volume(self) -> None:
        if (
            self.current_study is None
            or self.current_series is None
            or self._loading_volume
        ):
            return

        self._loading_volume = True

        study = self.current_study
        series = self.current_series

        self.volume_service.get_volume(
            study,
            series,
            self._volume_loaded,
        )

    def _volume_loaded(
        self,
        series_id: str,
        volume,
        spacing,
        error,
    ) -> None:
        QTimer.singleShot(
            0,
            lambda: self._apply_volume(
                series_id,
                volume,
                spacing,
                error,
            ),
        )

    def _apply_volume(
        self,
        series_id: str,
        volume,
        spacing,
        error,
    ) -> None:
        self._loading_volume = False

        if (
            self.current_series is None
            or self.current_series.id != series_id
        ):
            return

        if error:
            log.warning(
                "Volume load failed for %s: %s",
                series_id,
                error,
            )
            return

        if volume is None:
            return

        self._volume = volume
        self._spacing = spacing or (1.0, 1.0, 1.0)

        if self.volume_view is not None:
            try:
                self.volume_view.set_volume(
                    volume,
                    self._spacing,
                )
            except Exception:
                log.exception("Failed to display 3D volume")

        self._update_mpr_views()

    def _update_mpr_views(self) -> None:
        if self._volume is None:
            return

        zyx = self._volume

        try:
            z, y, x = zyx.shape
        except ValueError:
            return

        views = self._views_widgets

        if not views:
            return

        # Axial
        axial_index = max(0, min(z - 1, self.current_slice))
        axial = zyx[axial_index, :, :]

        if "axial" in views:
            views["axial"].set_slice(
                axial,
                spacing=(self._spacing[1], self._spacing[2]),
                keep_wl=True,
            )
            views["axial"].overlay_info = (
                f"Axial {axial_index + 1}/{z}"
            )

        # Coronal
        coronal_index = max(0, min(y - 1, self.current_slice))
        coronal = zyx[:, coronal_index, :]

        if "coronal" in views:
            views["coronal"].set_slice(
                coronal,
                spacing=(self._spacing[0], self._spacing[2]),
                keep_wl=True,
            )
            views["coronal"].overlay_info = (
                f"Coronal {coronal_index + 1}/{y}"
            )

        # Sagittal
        sagittal_index = max(0, min(x - 1, self.current_slice))
        sagittal = zyx[:, :, sagittal_index]

        if "sagittal" in views:
            views["sagittal"].set_slice(
                sagittal,
                spacing=(self._spacing[0], self._spacing[1]),
                keep_wl=True,
            )
            views["sagittal"].overlay_info = (
                f"Sagittal {sagittal_index + 1}/{x}"
            )

        self._update_annotations()

    def _reset_3d(self) -> None:
        if getattr(self, "volume_view", None) is not None:
            try:
                self.volume_view.reset_camera()
            except Exception:
                log.exception("Failed to reset 3D camera")

    # ------------------------------------------------------------------
    # Reports
    # ------------------------------------------------------------------

    def _update_report(self, study: Study) -> None:
        report = study.report

        if not report:
            self.report_text.setPlainText(
                "No report available."
            )
            return

        if isinstance(report, str):
            text = report
        elif isinstance(report, dict):
            parts = []

            for key, value in report.items():
                if value in (None, ""):
                    continue

                title = str(key).replace("_", " ").title()
                parts.append(f"{title}\n{value}")

            text = "\n\n".join(parts)
        else:
            text = str(report)

        self.report_text.setPlainText(text)

    def _update_findings(self, study: Study) -> None:
        findings = study.ai_findings

        if not findings:
            self.findings_text.setPlainText(
                "No AI findings available."
            )
            return

        lines = []

        for finding in findings:
            if isinstance(finding, dict):
                label = (
                    finding.get("label")
                    or finding.get("title")
                    or finding.get("finding")
                    or "Finding"
                )
                value = (
                    finding.get("text")
                    or finding.get("description")
                    or finding.get("value")
                    or ""
                )
                lines.append(f"{label}: {value}")
            else:
                lines.append(str(finding))

        self.findings_text.setPlainText(
            "\n\n".join(lines)
        )

    # ------------------------------------------------------------------
    # Annotations
    # ------------------------------------------------------------------

    def _create_annotation(
        self,
        plane: str,
        data: dict,
    ) -> None:
        if (
            self.current_study is None
            or self.current_series is None
        ):
            return

        points_2d = data.get("points", [])

        if not points_2d:
            return

        points = []

        for p in points_2d:
            points.append(
                plane_px_to_voxel(
                    float(p.get("x", 0)),
                    float(p.get("y", 0)),
                    plane,
                    self.current_slice,
                )
            )

        measurement = None

        if data.get("tool") == "measure":
            measurement = measurement_length_mm(
                points,
                self._spacing,
            )

        ann = Annotation.create(
            study_id=self.current_study.id,
            series_id=self.current_series.id,
            tool=data.get("tool", "select"),
            plane=plane,
            slice_index=self.current_slice,
            points=points,
            measurement_mm=measurement,
        )

        self.annotation_store.add(
            self.current_study.id,
            ann,
        )

        self._update_annotations()

    def _update_annotations(self) -> None:
        if self.current_study is None:
            return

        annotations = self.annotation_store.load(
            self.current_study.id
        )

        # Show annotations relevant to the current plane/slice.
        relevant = [
            ann
            for ann in annotations
            if ann.series_id
            == (
                self.current_series.id
                if self.current_series is not None
                else ""
            )
            and ann.plane == self.current_plane
            and ann.slice_index == self.current_slice
        ]

        self.ann_list.clear()

        for ann in annotations:
            text = (
                f"{ann.tool} · "
                f"{ann.plane} · "
                f"slice {ann.slice_index + 1}"
            )

            if ann.measurement_mm is not None:
                text += f" · {ann.measurement_mm:.1f} mm"

            self.ann_list.addItem(text)

        view = self._views_widgets.get(
            self.current_plane
        )

        if view is not None:
            view.set_annotations(relevant)

    # ------------------------------------------------------------------
    # Window lifecycle
    # ------------------------------------------------------------------

    def closeEvent(self, event) -> None:
        try:
            self.cfg.settings.window_geometry = (
                self.saveGeometry().toHex().data().decode()
            )
            self.cfg.settings.maximized = self.isMaximized()
            self.cfg.save()
        except Exception:
            log.exception("Failed to save window state")

        try:
            self.slice_loader.shutdown()
        except Exception:
            pass

        try:
            self.volume_service.shutdown()
        except Exception:
            pass

        super().closeEvent(event)
 
 
MainWindow = WorkstationWindow


if __name__ == "__main__":
    from meridian_desktop.app import main
    sys.exit(main())
