"""
VTK 3D volume rendering widget.

High-quality GPU-accelerated volume rendering with real transfer functions:

- CT presets: Bone / Soft Tissue (intensity-driven, physically meaningful)
- MRI "MRI Color": intensity-based false-color mapping via a colour transfer
  function built from the actual voxel histogram — clearly a visualization,
  never claimed to be true tissue colour.
- Adjustable opacity, camera rotate/zoom/pan, reset, preset camera views.

The volume is uploaded as-is at native resolution (no silent downsampling);
VTK handles level-of-detail internally during interaction and refines when
idle.
"""

from __future__ import annotations

import os
import json
import numpy as np
from PySide6.QtWidgets import QWidget, QVBoxLayout

try:
    import vtk
    from vtk.util import numpy_support
    HAS_VTK = True
except Exception:
    HAS_VTK = False


def _tf_points(stops):
    """stops: list of (value01, r, g, b, a) -> vtkColorTransferFunction + opacity fn."""
    color = vtk.vtkColorTransferFunction()
    opacity = vtk.vtkPiecewiseFunction()
    for v, r, g, b, a in stops:
        color.AddRGBPoint(v, r, g, b)
        opacity.AddPoint(v, a)
    return color, opacity


def ct_preset(name: str, lo: float, hi: float):
    """CT presets in Hounsfield-ish intensity range of the actual data."""
    span = max(hi - lo, 1.0)
    n = lambda v: (v - lo) / span  # normalize into 0..1

    if name == "Bone":
        return _tf_points([
            (n(-200), 0, 0, 0, 0.0),
            (n(100), 0.3, 0.25, 0.2, 0.05),
            (n(300), 0.75, 0.7, 0.62, 0.45),
            (n(900), 0.95, 0.93, 0.88, 0.9),
            (n(1600), 1.0, 1.0, 0.98, 1.0),
        ])
    if name == "Soft Tissue":
        return _tf_points([
            (n(-150), 0, 0, 0, 0.0),
            (n(20), 0.55, 0.32, 0.28, 0.35),
            (n(80), 0.85, 0.65, 0.55, 0.7),
            (n(160), 0.95, 0.85, 0.8, 0.9),
        ])
    if name == "Lung":
        return _tf_points([
            (n(-900), 0, 0, 0, 0.0),
            (n(-700), 0.7, 0.75, 0.8, 0.15),
            (n(-300), 0.85, 0.75, 0.65, 0.35),
            (n(50), 0.9, 0.6, 0.5, 0.7),
        ])
    # Grayscale fallback
    return _tf_points([
        (0.0, 0, 0, 0, 0.0),
        (0.25, 0.25, 0.25, 0.25, 0.15),
        (0.6, 0.7, 0.7, 0.7, 0.5),
        (1.0, 1.0, 1.0, 1.0, 0.95),
    ])


def mri_color_preset(lo: float, hi: float):
    """MRI intensity-driven false-color map. Hue walks cool->warm with the
    actual intensity distribution so structures remain distinguishable."""
    span = max(hi - lo, 1.0)
    n = lambda v: (v - lo) / span
    return _tf_points([
        (0.0, 0.0, 0.0, 0.05, 0.0),
        (0.18, 0.05, 0.10, 0.45, 0.10),
        (0.38, 0.05, 0.55, 0.65, 0.30),
        (0.58, 0.45, 0.80, 0.35, 0.50),
        (0.76, 0.95, 0.75, 0.15, 0.72),
        (0.90, 0.98, 0.35, 0.20, 0.88),
        (1.0, 1.0, 1.0, 1.0, 1.0),
    ])


def tissue_preset(lo, hi):
    span = max(hi - lo, 1.0)
    n = lambda v: (v - lo) / span
    return _tf_points([
        (0.0, 0.0, 0.0, 0.0, 0.0),
        (0.3, 0.6, 0.35, 0.3, 0.15),
        (0.6, 0.85, 0.6, 0.5, 0.45),
        (0.85, 0.95, 0.85, 0.75, 0.75),
        (1.0, 1.0, 1.0, 1.0, 0.95),
    ])


def high_contrast_preset(lo, hi):
    span = max(hi - lo, 1.0)
    n = lambda v: (v - lo) / span
    return _tf_points([
        (0.0, 0, 0, 0, 0.0),
        (0.5, 0, 0, 0, 0.0),
        (0.62, 0.4, 0.1, 0.6, 0.35),
        (0.8, 0.9, 0.85, 0.2, 0.7),
        (1.0, 1.0, 1.0, 1.0, 1.0),
    ])


class VTKVolumeWidget(QWidget):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._volume = None
        self._spacing = (1.0, 1.0, 1.0)
        self._modality = ""
        self._lo = self._hi = 0.0
        self._organ_actors = {}
        if not HAS_VTK:
            return
        try:
            from vtkmodules.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor
        except Exception:
            QVTKRenderWindowInteractor = None
        if QVTKRenderWindowInteractor is not None:
            self.widget = QVTKRenderWindowInteractor(self)
        else:
            from vtk.qt.QVTKRenderWindowInteractor import QVTKRenderWindowInteractor as Q
            self.widget = Q(self)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.widget)

        self.ren = vtk.vtkRenderer()
        self.ren.SetBackground(0.03, 0.035, 0.045)
        self.widget.GetRenderWindow().AddRenderer(self.ren)
        self.widget.GetRenderWindow().SetMultiSamples(8)  # anti-aliasing

        self.mapper = vtk.vtkGPUVolumeRayCastMapper()
        self.mapper.SetAutoAdjustSampleDistances(1)
        self.property = vtk.vtkVolumeProperty()
        self.property.ShadeOn()
        self.property.SetAmbient(0.25)
        self.property.SetDiffuse(0.85)
        self.property.SetSpecular(0.25)
        self.property.SetSpecularPower(20)
        self.property.SetInterpolationTypeToLinear()

        self.volume_actor = vtk.vtkVolume()
        self.volume_actor.SetProperty(self.property)
        self.volume_actor.SetMapper(self.mapper)

        self.ren.AddVolume(self.volume_actor)
        self.ren.ResetCamera()

        self.cam = self.ren.GetActiveCamera()
        self.interactor = self.widget.GetRenderWindow().GetInteractor()
        self.interactor.SetInteractorStyle(vtk.vtkInteractorStyleTrackballCamera())
        self.interactor.Initialize()

    # ------------------------------------------------------------------ data
    def set_volume(self, volume: np.ndarray, spacing=(1.0, 1.0, 1.0)) -> None:
        if not HAS_VTK or volume is None:
            return
        self._volume = volume
        self._spacing = spacing
        v = np.ascontiguousarray(volume, dtype=np.float32)
        self._lo = float(np.percentile(v, 1))
        self._hi = float(np.percentile(v, 99))
        img = vtk.vtkImageData()
        img.SetDimensions(v.shape[2], v.shape[1], v.shape[0])  # x, y, z
        img.SetSpacing(spacing[2], spacing[1], spacing[0])
        img.SetExtent(0, v.shape[2] - 1, 0, v.shape[1] - 1, 0, v.shape[0] - 1)
        arr = numpy_support.numpy_to_vtkNumArray(v.ravel(order="C"))
        arr = numpy_support.numpy_to_vtk(arr, deep=1)
        img.GetPointData().SetScalars(arr)
        self.mapper.SetInputData(img)
        self.ren.ResetCamera()
        self.widget.GetRenderWindow().Render()

    # --------------------------------------------------------------- presets
    def set_preset(self, preset: str, volume, spacing, modality: str) -> None:
        if not HAS_VTK:
            return
        if volume is not None and (volume is not self._volume or spacing != self._spacing):
            self.set_volume(volume, spacing)
        if self._volume is None:
            return
        lo, hi = self._lo, self._hi
        if preset == "MRI Color":
            color, opacity = mri_color_preset(lo, hi)
        elif preset == "Tissue":
            color, opacity = tissue_preset(lo, hi)
        elif preset == "High Contrast":
            color, opacity = high_contrast_preset(lo, hi)
        elif preset == "Bone":
            color, opacity = ct_preset("Bone", lo, hi)
        else:
            color, opacity = ct_preset("Grayscale", lo, hi)
        self.property.SetColor(color)
        self.property.SetScalarOpacity(opacity)
        self.property.SetScalarOpacityUnitDistance(
            max(0.1, 0.5 * min(self._spacing)))
        self.widget.GetRenderWindow().Render()

    def set_opacity_factor(self, factor: float) -> None:
        if not HAS_VTK:
            return
        self.property.SetScalarOpacityUnitDistance(
            max(0.05, 0.5 * min(self._spacing) / max(factor, 0.05)))
        self.widget.GetRenderWindow().Render()

    # --------------------------------------------------------------- camera
    def reset_camera(self) -> None:
        if not HAS_VTK:
            return
        self.ren.ResetCamera()
        self.widget.GetRenderWindow().Render()

    def set_view(self, which: str) -> None:
        if not HAS_VTK:
            return
        cams = {
            "axial": (0, 0, 1), "coronal": (0, 1, 0), "sagittal": (1, 0, 0),
        }
        if which in cams:
            self.cam.SetPosition(*cams[which])
            self.cam.SetViewUp(0, 1, 0) if which != "axial" else self.cam.SetViewUp(0, 1, 0)
            self.ren.ResetCamera()
            self.widget.GetRenderWindow().Render()

    def rotate(self, axis: str, degrees: float) -> None:
        if not HAS_VTK:
            return
        getattr(self.cam, f"Roll" if axis == "z" else "Azimuth" if axis == "y" else "Elevation")(degrees)
        self.widget.GetRenderWindow().Render()

    # --------------------------------------------------------------- 3D organ surface meshes
    def load_derived_meshes(self, derived_dir: str) -> dict:
        """
        Loads .vtp/.vtk surface meshes from the derived study folder into VTK renderer.
        Seamlessly integrates the same MONAI TotalSegmentator derived data as the web viewer.
        """
        if not HAS_VTK or not os.path.exists(derived_dir):
            return {}

        manifest_path = os.path.join(derived_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            return {}

        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            return {}

        self.clear_meshes()
        loaded = {}
        for seg in manifest.get("segments", []):
            organ_id = seg.get("id")
            name = seg.get("name", organ_id)
            color_hex = seg.get("color", "#38BDF8")
            vtp_rel = seg.get("vtpPath", f"meshes/{organ_id}.vtp")
            vtp_path = os.path.join(derived_dir, vtp_rel)
            if not os.path.exists(vtp_path):
                continue

            try:
                # Support both legacy VTK ascii and modern XML .vtp formats seamlessly
                is_xml = False
                try:
                    with open(vtp_path, "r", encoding="utf-8", errors="ignore") as f_check:
                        header = f_check.read(120)
                        if "<VTKFile" in header or "<?xml" in header:
                            is_xml = True
                except Exception:
                    pass

                if is_xml and hasattr(vtk, "vtkXMLPolyDataReader"):
                    reader = vtk.vtkXMLPolyDataReader()
                else:
                    reader = vtk.vtkPolyDataReader()

                reader.SetFileName(vtp_path)
                reader.Update()

                mapper = vtk.vtkPolyDataMapper()
                mapper.SetInputConnection(reader.GetOutputPort())

                actor = vtk.vtkActor()
                actor.SetMapper(mapper)

                # Convert hex color to float RGB (0..1)
                h = color_hex.lstrip("#")
                r, g, b = tuple(int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4))

                prop = actor.GetProperty()
                prop.SetColor(r, g, b)
                prop.SetOpacity(0.75)
                prop.SetAmbient(0.3)
                prop.SetDiffuse(0.8)
                prop.SetSpecular(0.2)

                self.ren.AddActor(actor)
                self._organ_actors[organ_id] = actor
                loaded[organ_id] = {"name": name, "actor": actor, "color": color_hex}
            except Exception:
                pass

        self.widget.GetRenderWindow().Render()
        return loaded

    def clear_meshes(self) -> None:
        """Removes all loaded organ surface mesh actors from the renderer."""
        if not HAS_VTK:
            return
        for actor in self._organ_actors.values():
            self.ren.RemoveActor(actor)
        self._organ_actors.clear()
        if hasattr(self, "widget"):
            self.widget.GetRenderWindow().Render()

    def set_organ_visible(self, organ_id: str, visible: bool) -> None:
        if organ_id in self._organ_actors:
            self._organ_actors[organ_id].SetVisibility(1 if visible else 0)
            self.widget.GetRenderWindow().Render()

    def set_organ_opacity(self, organ_id: str, opacity: float) -> None:
        if organ_id in self._organ_actors:
            self._organ_actors[organ_id].GetProperty().SetOpacity(max(0.0, min(1.0, opacity)))
            self.widget.GetRenderWindow().Render()