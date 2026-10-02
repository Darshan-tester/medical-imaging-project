"""
Quantitative Volumetric and Morphometric Metrics Calculator.
Computes physical volume, caliper diameter, surface area, and centroids.
"""

from __future__ import annotations

from typing import Dict, Any, Tuple, Optional
import numpy as np


class OrganMetrics(dict):
    """Dictionary subclass supporting attribute access for common volume metrics."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__dict__ = self

    @property
    def volume_ml(self) -> float:
        return float(self.get("volumeMl", 0.0))

    @property
    def volume_mm3(self) -> float:
        return float(self.get("volumeMm3", 0.0))

    @property
    def max_diameter_mm(self) -> float:
        return float(self.get("maxDiameterMm", 0.0))

    @property
    def voxel_count(self) -> int:
        return int(self.get("voxelCount", 0))

    @property
    def surface_area_cm2(self) -> float:
        return float(self.get("surfaceAreaCm2", 0.0))


def compute_structure_metrics(
    mask: np.ndarray,
    spacing: Tuple[float, float, float],
    affine: Optional[np.ndarray] = None,
    intensity_voxels: Optional[np.ndarray] = None,
    structure_name: str = "structure",
) -> OrganMetrics:
    """
    Computes rigorous physical morphometrics for a binary mask.
    spacing: (sz, sy, sx) in mm.
    affine: 4x4 coordinate transform matrix (defaults to np.eye(4)).
    """
    if affine is None:
        affine = np.eye(4)

    voxel_count = int(np.count_nonzero(mask))
    if voxel_count == 0:
        return OrganMetrics({
            "structure": structure_name,
            "voxelCount": 0,
            "volumeMl": 0.0,
            "volumeMm3": 0.0,
            "surfaceAreaCm2": 0.0,
            "maxDiameterMm": 0.0,
            "centroidWorld": {"x": 0.0, "y": 0.0, "z": 0.0},
        })

    sz, sy, sx = spacing
    voxel_vol_mm3 = sz * sy * sx
    vol_mm3 = voxel_count * voxel_vol_mm3
    vol_ml = vol_mm3 / 1000.0

    # Voxel indices where mask is positive
    z_idx, y_idx, x_idx = np.where(mask > 0)

    # Voxel-space centroid
    z_mean = float(np.mean(z_idx))
    y_mean = float(np.mean(y_idx))
    x_mean = float(np.mean(x_idx))

    # Convert centroid to physical world space via affine (X, Y, Z, 1)
    pt_vox = np.array([x_mean, y_mean, z_mean, 1.0])
    pt_world = affine @ pt_vox

    # Bounding extents
    dz = (float(np.max(z_idx) - np.min(z_idx)) + 1) * sz
    dy = (float(np.max(y_idx) - np.min(y_idx)) + 1) * sy
    dx = (float(np.max(x_idx) - np.min(x_idx)) + 1) * sx

    # 3D diagonal bounding box diameter as an upper bound / RECIST-oriented measure
    max_diameter_mm = round(float(np.sqrt(dx**2 + dy**2 + dz**2)), 1)

    # Approximate surface area from boundary voxel count
    # (6-neighborhood boundary)
    surface_area_cm2 = round((voxel_count ** (2.0 / 3.0)) * 6.0 * ((voxel_vol_mm3 ** (2.0 / 3.0)) / 100.0), 1)

    # Adaptive precision: retain up to 4 decimal places for micro-lesions (<0.1 ml)
    if vol_ml < 0.1:
        rounded_vol_ml = round(vol_ml, 4)
    elif vol_ml < 10.0:
        rounded_vol_ml = round(vol_ml, 3)
    else:
        rounded_vol_ml = round(vol_ml, 2)

    result: Dict[str, Any] = {
        "structure": structure_name,
        "voxelCount": voxel_count,
        "volumeMl": rounded_vol_ml,
        "volumeMm3": round(vol_mm3, 1),
        "surfaceAreaCm2": surface_area_cm2,
        "maxDiameterMm": max_diameter_mm,
        "boundingExtentsMm": {"dx": round(dx, 1), "dy": round(dy, 1), "dz": round(dz, 1)},
        "centroidWorld": {
            "x": round(float(pt_world[0]), 2),
            "y": round(float(pt_world[1]), 2),
            "z": round(float(pt_world[2]), 2),
        },
    }

    # Intensity statistics if provided (e.g. Hounsfield units for CT)
    if intensity_voxels is not None:
        values = intensity_voxels[mask > 0]
        if len(values) > 0:
            result["meanHu"] = round(float(np.mean(values)), 1)
            result["stdHu"] = round(float(np.std(values)), 1)
            result["minHu"] = round(float(np.min(values)), 1)
            result["maxHu"] = round(float(np.max(values)), 1)

    return OrganMetrics(result)


# Backwards compatibility and shorthand alias
compute_organ_metrics = compute_structure_metrics
