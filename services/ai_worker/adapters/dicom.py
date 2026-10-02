"""
DICOM Volume Adapter for Meridian AI Worker.
Ingests CT/MRI DICOM stacks, preserving physical coordinates, slice ordering,
spacing, orientation, and Hounsfield unit calibrations.
"""

from __future__ import annotations

import os
from typing import List, Dict, Any, Tuple, Optional
import numpy as np
import pydicom


class DicomVolumeData:
    def __init__(
        self,
        voxels: np.ndarray,
        affine: np.ndarray,
        spacing: Tuple[float, float, float],
        metadata: Dict[str, Any],
        slice_locations: List[float],
        file_paths: List[str],
    ):
        self.voxels = voxels  # shape: (Z, Y, X)
        self.affine = affine  # 4x4 coordinate matrix
        self.spacing = spacing  # (sz, sy, sx) in mm
        self.metadata = metadata
        self.slice_locations = slice_locations
        self.file_paths = file_paths

    @property
    def shape(self) -> Tuple[int, int, int]:
        return self.voxels.shape


def _safe_float(val: Any, default: float = 1.0) -> float:
    if val is None:
        return default
    if hasattr(val, "__iter__") and not isinstance(val, (str, bytes)):
        try:
            for item in val:
                return _safe_float(item, default)
        except Exception:
            return default
    try:
        f = float(val)
        return f if not np.isnan(f) else default
    except (ValueError, TypeError):
        return default


def load_dicom_stack(file_paths: List[str]) -> DicomVolumeData:
    """
    Loads and reassembles a stack of DICOM slices into a calibrated 3D volume.
    Never alters or overwrites the input files.
    """
    if not file_paths:
        raise ValueError("Cannot load DICOM stack: empty file list")

    parsed_slices = []
    for fp in file_paths:
        if not os.path.exists(fp):
            continue
        try:
            ds = pydicom.dcmread(fp, stop_before_pixels=False, force=True)
            # Must contain pixel data
            if not hasattr(ds, "PixelData"):
                continue

            # Determine position along slice normal
            ipp = getattr(ds, "ImagePositionPatient", None)
            iop = getattr(ds, "ImageOrientationPatient", None)

            if ipp is not None and iop is not None:
                # Normal vector from row and col direction cosines
                r = np.array(iop[:3], dtype=np.float64)
                c = np.array(iop[3:], dtype=np.float64)
                normal = np.cross(r, c)
                norm_len = np.linalg.norm(normal)
                if norm_len > 1e-6:
                    normal /= norm_len
                pos_along_normal = float(np.dot(np.array(ipp, dtype=np.float64), normal))
            elif ipp is not None:
                pos_along_normal = float(ipp[2])
            elif hasattr(ds, "SliceLocation"):
                pos_along_normal = float(ds.SliceLocation)
            elif hasattr(ds, "InstanceNumber"):
                pos_along_normal = float(ds.InstanceNumber)
            else:
                pos_along_normal = 0.0

            parsed_slices.append((pos_along_normal, fp, ds))
        except Exception:
            continue

    if not parsed_slices:
        raise ValueError(f"No valid DICOM instances could be read from {len(file_paths)} candidate files")

    # Sort strictly by physical position along normal
    parsed_slices.sort(key=lambda item: item[0])

    first_ds = parsed_slices[0][2]
    last_ds = parsed_slices[-1][2]

    # Spacing
    pix_spacing = getattr(first_ds, "PixelSpacing", [1.0, 1.0])
    try:
        sy = _safe_float(pix_spacing[0] if len(pix_spacing) > 0 else 1.0, 1.0)
        sx = _safe_float(pix_spacing[1] if len(pix_spacing) > 1 else 1.0, 1.0)
    except Exception:
        sy, sx = 1.0, 1.0

    # Slice thickness / inter-slice distance
    if len(parsed_slices) > 1:
        locs = [item[0] for item in parsed_slices]
        deltas = np.diff(locs)
        sz = float(np.median(np.abs(deltas)))
        if sz < 1e-4:
            sz = _safe_float(getattr(first_ds, "SliceThickness", 1.0), 1.0)
    else:
        sz = _safe_float(getattr(first_ds, "SliceThickness", 1.0), 1.0)

    spacing = (sz, sy, sx)

    # Build 3D voxel array
    slices_data = []
    slice_locs = []
    valid_fps = []

    for pos, fp, ds in parsed_slices:
        arr = ds.pixel_array.astype(np.float32)
        slope = _safe_float(getattr(ds, "RescaleSlope", 1.0), 1.0)
        intercept = _safe_float(getattr(ds, "RescaleIntercept", 0.0), 0.0)
        hu = arr * slope + intercept
        slices_data.append(hu)
        slice_locs.append(pos)
        valid_fps.append(fp)

    volume_3d = np.stack(slices_data, axis=0)  # Shape (Z, Y, X)

    # Build standard DICOM patient coordinate affine matrix (LPS to voxel or vice-versa)
    affine = np.diag([sx, sy, sz, 1.0])
    ipp = getattr(first_ds, "ImagePositionPatient", [0.0, 0.0, 0.0])
    try:
        affine[0, 3] = _safe_float(ipp[0], 0.0)
        affine[1, 3] = _safe_float(ipp[1], 0.0)
        affine[2, 3] = _safe_float(ipp[2], 0.0)
    except Exception:
        pass

    meta: Dict[str, Any] = {
        "patientId": str(getattr(first_ds, "PatientID", "UNKNOWN")),
        "studyInstanceUID": str(getattr(first_ds, "StudyInstanceUID", "")),
        "seriesInstanceUID": str(getattr(first_ds, "SeriesInstanceUID", "")),
        "modality": str(getattr(first_ds, "Modality", "CT")),
        "seriesDescription": str(getattr(first_ds, "SeriesDescription", "")),
        "rows": int(getattr(first_ds, "Rows", volume_3d.shape[1])),
        "columns": int(getattr(first_ds, "Columns", volume_3d.shape[2])),
        "sliceCount": len(slices_data),
        "windowCenter": _safe_float(getattr(first_ds, "WindowCenter", 40.0), 40.0),
        "windowWidth": _safe_float(getattr(first_ds, "WindowWidth", 400.0), 400.0),
        "minHu": float(np.min(volume_3d)),
        "maxHu": float(np.max(volume_3d)),
        "meanHu": float(np.mean(volume_3d)),
    }

    return DicomVolumeData(
        voxels=volume_3d,
        affine=affine,
        spacing=spacing,
        metadata=meta,
        slice_locations=slice_locs,
        file_paths=valid_fps,
    )


def find_dicom_series_in_directory(dir_path: str) -> Dict[str, List[str]]:
    """
    Finds and groups all DICOM files in a directory by SeriesInstanceUID.
    """
    series_map: Dict[str, List[str]] = {}
    if not os.path.exists(dir_path):
        return series_map

    for root, _, files in os.walk(dir_path):
        for f in files:
            if f.endswith((".dcm", ".ima", ".DCM")) or "." not in f:
                fp = os.path.join(root, f)
                try:
                    ds = pydicom.dcmread(fp, stop_before_pixels=True, force=True)
                    if hasattr(ds, "SeriesInstanceUID"):
                        suid = str(ds.SeriesInstanceUID)
                        if suid not in series_map:
                            series_map[suid] = []
                        series_map[suid].append(fp)
                except Exception:
                    pass
    return series_map

