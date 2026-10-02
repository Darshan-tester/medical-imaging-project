"""
NIfTI Volume Adapter for Meridian AI Worker.
Supports 3D and 4D NIfTI medical images, orientation headers,
voxel spacing, and temporal dimension indexing.
"""

from __future__ import annotations

import os
from typing import Tuple, Dict, Any, Optional
import numpy as np
import nibabel as nib


class NiftiVolumeData:
    def __init__(
        self,
        voxels: np.ndarray,
        affine: np.ndarray,
        spacing: Tuple[float, float, float],
        metadata: Dict[str, Any],
        is_4d: bool = False,
        time_frames: int = 1,
        time_spacing: float = 0.0,
    ):
        self.voxels = voxels  # shape: (Z, Y, X) or (T, Z, Y, X)
        self.affine = affine  # 4x4 coordinate matrix
        self.spacing = spacing  # (sz, sy, sx) in mm
        self.metadata = metadata
        self.is_4d = is_4d
        self.time_frames = time_frames
        self.time_spacing = time_spacing

    @property
    def shape(self) -> Tuple[int, ...]:
        return self.voxels.shape


def load_nifti_volume(file_path: str) -> NiftiVolumeData:
    """
    Loads a NIfTI file (.nii or .nii.gz), preserving orientation affine and spacing.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"NIfTI file not found: {file_path}")

    img = nib.load(file_path)
    data = img.get_fdata(dtype=np.float32)
    header = img.header
    affine = img.affine

    pixdim = header["pixdim"]
    # pixdim: [dim0, dx, dy, dz, dt, ...]
    dx = float(pixdim[1]) if len(pixdim) > 1 else 1.0
    dy = float(pixdim[2]) if len(pixdim) > 2 else 1.0
    dz = float(pixdim[3]) if len(pixdim) > 3 else 1.0
    dt = float(pixdim[4]) if len(pixdim) > 4 else 0.0

    # In nibabel, standard array indexing is (X, Y, Z) or (X, Y, Z, T)
    is_4d = False
    time_frames = 1

    if data.ndim == 4:
        is_4d = True
        time_frames = data.shape[3]
        # Transpose from (X, Y, Z, T) to (T, Z, Y, X)
        voxels = np.transpose(data, (3, 2, 1, 0))
    elif data.ndim == 3:
        # Transpose from (X, Y, Z) to (Z, Y, X)
        voxels = np.transpose(data, (2, 1, 0))
    else:
        raise ValueError(f"Unsupported NIfTI array dimensions: {data.ndim}")

    spacing = (dz, dy, dx)

    meta: Dict[str, Any] = {
        "filename": os.path.basename(file_path),
        "dimensions": list(voxels.shape),
        "voxelSpacingMm": list(spacing),
        "is4D": is_4d,
        "timeFrames": time_frames,
        "timeStepSec": dt,
        "dataType": str(header.get_data_dtype()),
        "minVal": float(np.min(voxels)),
        "maxVal": float(np.max(voxels)),
        "meanVal": float(np.mean(voxels)),
    }

    return NiftiVolumeData(
        voxels=voxels,
        affine=affine,
        spacing=spacing,
        metadata=meta,
        is_4d=is_4d,
        time_frames=time_frames,
        time_spacing=dt,
    )


def save_nifti_volume(
    file_path: str,
    data: np.ndarray,
    affine: Optional[np.ndarray] = None,
    spacing: Optional[Tuple[float, float, float]] = None,
) -> str:
    """
    Saves a 3D or 4D array into a compressed NIfTI file (.nii.gz).
    """
    os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
    if affine is None:
        if spacing is not None and len(spacing) >= 3:
            affine = np.diag([spacing[2], spacing[1], spacing[0], 1.0])
        else:
            affine = np.eye(4)

    # Convert back from (Z, Y, X) to (X, Y, Z)
    if data.ndim == 3:
        arr_xyz = np.transpose(data, (2, 1, 0))
    elif data.ndim == 4:
        arr_xyz = np.transpose(data, (3, 2, 1, 0))
    else:
        arr_xyz = data

    img = nib.Nifti1Image(arr_xyz.astype(np.float32), affine)
    nib.save(img, file_path)
    return file_path


# Aliases
load_nifti = load_nifti_volume
save_nifti = save_nifti_volume

