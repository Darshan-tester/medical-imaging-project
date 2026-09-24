"""Voxel-axis -> anatomical-plane mapping (image-render.ts:761-923).

This is the shared geometry core.  NIfTI volumes get their affine from
qform/sform; reconstructed DICOM stacks build one from
ImageOrientationPatient - and both then land here, which is what stops a
coronal CT and a coronal MR from disagreeing about which side of the image is
the patient's left.

Display convention, fixed for every modality::

    Axial     screen x -> patient Left,  screen y -> Posterior
    Coronal   screen x -> patient Left,  screen y -> Inferior
    Sagittal  screen x -> Posterior,     screen y -> Inferior

Every screen axis therefore travels in the *negative* world direction, so an
array axis that increases along the positive world direction is walked
backwards.  The through-axis is deliberately never flipped: slice 0 stays array
index 0, so axial slice numbering is unchanged from the pre-MPR renderer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .gray import MAX_RENDER_EDGE, js_round_scalar

WORLD_R = 0
WORLD_A = 1
WORLD_S = 2

MPR_PLANES: tuple[str, str, str] = ("Axial", "Coronal", "Sagittal")

#: image-render.ts:837-841.
PLANE_SCREEN_AXES: dict[str, tuple[int, int, int]] = {
    "Axial": (WORLD_S, WORLD_R, WORLD_A),
    "Coronal": (WORLD_A, WORLD_R, WORLD_S),
    "Sagittal": (WORLD_R, WORLD_A, WORLD_S),
}


@dataclass(frozen=True)
class AxisRef:
    __slots__ = ("axis", "flip")
    axis: int
    flip: bool


@dataclass(frozen=True)
class PlaneGeometry:
    """One anatomical plane: how many real slices, and the on-screen raster."""

    __slots__ = ("slice_count", "width", "height", "through", "horizontal", "vertical")
    slice_count: int
    width: int
    height: int
    through: AxisRef
    horizontal: AxisRef
    vertical: AxisRef


@dataclass(frozen=True)
class VolumeGeometry:
    dims: tuple[int, int, int]
    spacing: tuple[float, float, float]
    planes: dict[str, PlaneGeometry]
    #: The plane whose normal has the coarsest spacing - the slice-select
    #: direction, i.e. the plane the scanner actually acquired.
    acquired_plane: str
    #: False when the file carried no qform/sform, so the axis mapping is the
    #: NIfTI default (assumed RAS) rather than measured.
    has_spatial_transform: bool

    def plane(self, name: str | None) -> PlaneGeometry:
        return self.planes[name if name in self.planes else self.acquired_plane]


def is_mpr_plane(value: str | None) -> bool:
    return value in ("Axial", "Coronal", "Sagittal")


def positive_or(value: float | None, fallback: float) -> float:
    if value is None:
        return fallback
    try:
        v = float(value)
    except (TypeError, ValueError):
        return fallback
    return v if math.isfinite(v) and v > 0 else fallback


def clamp_int(value: float, lo: int, hi: int) -> int:
    """image-render.ts:589-592 - non-finite collapses to ``lo``, then truncate."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return lo
    if not math.isfinite(v):
        return lo
    return max(lo, min(hi, int(math.trunc(v))))


def resolve_index(i: int, n: int, flip: bool) -> int:
    return (n - 1 - i) if flip else i


@dataclass(frozen=True)
class AxisAssignment:
    __slots__ = ("voxel_axis_for", "sign")
    #: world axis -> which array axis travels along it.
    voxel_axis_for: tuple[int, int, int]
    #: world axis -> +1 if increasing that array index moves positively.
    sign: tuple[int, int, int]


def assign_axes(affine: list[list[float]] | None) -> AxisAssignment:
    """image-render.ts:782-814 - greedy strongest-component matching.

    Sorting by descending magnitude is *stable* in both languages, so ties
    resolve world-major/voxel-minor identically.  A NaN component is treated as
    magnitude 0 (unreachable for any real header; a NaN comparator result in
    JavaScript leaves the order untouched, which for zero-magnitude candidates
    has the same effect).
    """
    candidates = []
    for world in range(3):
        for voxel in range(3):
            v = 0.0
            try:
                v = float(affine[world][voxel])  # type: ignore[index]
            except (TypeError, ValueError, IndexError, KeyError):
                v = 0.0
            magnitude = abs(v)
            if magnitude != magnitude:  # NaN
                magnitude = 0.0
            candidates.append((world, voxel, magnitude, -1 if v < 0 else 1))
    candidates.sort(key=lambda c: -c[2])

    voxel_axis_for: list[int | None] = [None, None, None]
    sign = [1, 1, 1]
    used: set[int] = set()
    for world, voxel, _magnitude, s in candidates:
        if voxel_axis_for[world] is not None or voxel in used:
            continue
        voxel_axis_for[world] = voxel
        sign[world] = s
        used.add(voxel)
    # Degenerate affine: fall back to the NIfTI default of i,j,k = R,A,S.
    for world in range(3):
        if voxel_axis_for[world] is None:
            free = next((v for v in (0, 1, 2) if v not in used), world)
            voxel_axis_for[world] = free
            used.add(free)

    return AxisAssignment(
        (int(voxel_axis_for[0]), int(voxel_axis_for[1]), int(voxel_axis_for[2])),
        (sign[0], sign[1], sign[2]),
    )


def planes_from_affine(
    dims: tuple[int, int, int],
    spacing: tuple[float, float, float],
    affine: list[list[float]] | None,
    has_spatial_transform: bool,
) -> VolumeGeometry:
    """image-render.ts:874-923."""
    assignment = assign_axes(affine)
    voxel_axis_for = assignment.voxel_axis_for
    sign = assignment.sign

    planes: dict[str, PlaneGeometry] = {}
    for plane in MPR_PLANES:
        map_through, map_h, map_v = PLANE_SCREEN_AXES[plane]
        through = AxisRef(voxel_axis_for[map_through], False)
        horizontal = AxisRef(voxel_axis_for[map_h], sign[map_h] > 0)
        vertical = AxisRef(voxel_axis_for[map_v], sign[map_v] > 0)

        n_h = dims[horizontal.axis]
        n_v = dims[vertical.axis]
        pixel = min(spacing[horizontal.axis], spacing[vertical.axis])
        width = max(1, js_round_scalar((n_h * spacing[horizontal.axis]) / pixel))
        height = max(1, js_round_scalar((n_v * spacing[vertical.axis]) / pixel))
        longest = max(width, height)
        if longest > MAX_RENDER_EDGE:
            scale = MAX_RENDER_EDGE / longest
            width = max(1, js_round_scalar(width * scale))
            height = max(1, js_round_scalar(height * scale))

        planes[plane] = PlaneGeometry(dims[through.axis], width, height, through, horizontal, vertical)

    # Coarsest through-plane spacing wins; the strict ">" means a tie keeps
    # Axial, because MPR_PLANES is walked in that order.
    acquired = "Axial"
    coarsest = -math.inf
    for plane in MPR_PLANES:
        s = spacing[planes[plane].through.axis]
        if s > coarsest:
            coarsest = s
            acquired = plane

    return VolumeGeometry(dims, spacing, planes, acquired, has_spatial_transform)
