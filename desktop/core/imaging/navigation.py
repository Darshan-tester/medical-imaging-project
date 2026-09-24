"""Linked-navigation math: one voxel point, every plane.

The viewer keeps the reader's position as a single **voxel index triple**
``(i, j, k)`` of the open volume.  That is the right canonical form because all
three MPR planes are views of the same array (``geometry.planes_from_affine``
derives every plane's axes from the same affine), so converting a picked point
between planes is index arithmetic, not matrix arithmetic, and it is exactly
invertible.

The physical dimensions are respected without ever appearing here: a plane's
reslice already scales the in-plane raster by voxel spacing
(``PlaneGeometry.width/height``), so a normalized in-plane position maps
linearly onto the volume's voxel extent of that plane, and anisotropic data
lands where it should.  World coordinates are still available for annotations
through ``volume_affine`` / ``voxel_to_world`` below.

These functions are pure and numpy-free, so they are testable headless.
"""

from __future__ import annotations

from .geometry import PlaneGeometry, VolumeGeometry, resolve_index


def clamp_index(value: int, n: int) -> int:
    if n <= 0:
        return 0
    return max(0, min(n - 1, int(value)))


def voxel_from_plane(
    geom: VolumeGeometry,
    plane_name: str,
    slice_index: int,
    nx: float,
    ny: float,
) -> tuple[int, int, int]:
    """A plane position -> the voxel triple it names.

    ``nx``/``ny`` are normalized frame coordinates (0..1, as FrameView reports
    clicks) *as painted on screen*, i.e. with the plane's flips applied.  The
    through axis carries no flip by construction, so ``slice_index`` is the
    array index as the viewer numbered it.
    """
    plane = geom.plane(plane_name)
    n_h = geom.dims[plane.horizontal.axis]
    n_v = geom.dims[plane.vertical.axis]
    # Undo the screen flip first, then undo the linear reslice map.  The
    # reslice walks output pixels linearly over the voxel extent, so the
    # inverse map is a plain scale regardless of the output size.
    hx = _undo_flip(min(1.0, max(0.0, nx)), plane.horizontal.flip)
    vy = _undo_flip(min(1.0, max(0.0, ny)), plane.vertical.flip)
    ijk = [0, 0, 0]
    ijk[plane.horizontal.axis] = clamp_index(round(hx * (n_h - 1)), n_h)
    ijk[plane.vertical.axis] = clamp_index(round(vy * (n_v - 1)), n_v)
    ijk[plane.through.axis] = clamp_index(
        resolve_index(slice_index, geom.dims[plane.through.axis], False),
        geom.dims[plane.through.axis])
    return (ijk[0], ijk[1], ijk[2])


def _undo_flip(fraction: float, flip: bool) -> float:
    return (1.0 - fraction) if flip else fraction


def plane_position(
    geom: VolumeGeometry,
    plane_name: str,
    ijk: tuple[int, int, int],
) -> tuple[int, float, float]:
    """A voxel triple -> ``(slice_index, nx, ny)`` in one plane.

    ``nx``/``ny`` are normalized (0..1) on-screen frame coordinates with the
    plane's flips applied, so the viewer can paint a crosshair at exactly the
    voxel the reader picked in another plane.
    """
    plane = geom.plane(plane_name)
    slice_index = resolve_index(ijk[plane.through.axis],
                                geom.dims[plane.through.axis], False)
    n_h = geom.dims[plane.horizontal.axis]
    n_v = geom.dims[plane.vertical.axis]
    hx = ijk[plane.horizontal.axis] / (n_h - 1) if n_h > 1 else 0.0
    vy = ijk[plane.vertical.axis] / (n_v - 1) if n_v > 1 else 0.0
    return (slice_index, _undo_flip(hx, plane.horizontal.flip),
            _undo_flip(vy, plane.vertical.flip))


def all_planes(
    geom: VolumeGeometry,
    ijk: tuple[int, int, int],
) -> dict[str, tuple[int, float, float]]:
    return {name: plane_position(geom, name, ijk) for name in geom.planes}


# ---------------------------------------------------------------------------
# World (patient) coordinates
# ---------------------------------------------------------------------------

def volume_affine(
    dims: tuple[int, int, int],
    spacing: tuple[float, float, float],
    affine: list[list[float]] | None,
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Column vectors and origin of the voxel->world transform.

    ``affine`` is the NIfTI/stack 4x4 as row lists.  When absent, the NIfTI
    default (RAS with the given spacing) is used - the same fallback
    ``planes_from_affine`` assumes, so annotations and crosshairs never disagree
    about the frame.
    """
    cols: list[tuple[float, float, float]] = []
    for voxel in range(3):
        vec = tuple(
            float(affine[r][voxel]) if affine is not None else 0.0
            for r in range(3)
        )
        if affine is None:
            vec = (spacing[voxel], 0.0, 0.0) if voxel == 0 else (
                (0.0, spacing[voxel], 0.0) if voxel == 1 else (0.0, 0.0, spacing[voxel]))
        cols.append(vec)
    origin: tuple[float, float, float] = (
        tuple(float(affine[r][3]) for r in range(3)) if affine is not None
        else (0.0, 0.0, 0.0))  # type: ignore[assignment]
    return (cols[0], cols[1], cols[2]), origin


def voxel_to_world(
    matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]],
    origin: tuple[float, float, float],
    ijk: tuple[int, int, int],
) -> tuple[float, float, float]:
    c0, c1, c2 = matrix
    return (
        origin[0] + c0[0] * ijk[0] + c1[0] * ijk[1] + c2[0] * ijk[2],
        origin[1] + c0[1] * ijk[0] + c1[1] * ijk[1] + c2[1] * ijk[2],
        origin[2] + c0[2] * ijk[0] + c1[2] * ijk[1] + c2[2] * ijk[2],
    )


def world_to_voxel(
    matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]],
    origin: tuple[float, float, float],
    xyz: tuple[float, float, float],
) -> tuple[int, int, int]:
    """World -> nearest voxel, via the inverse of an orthonormal-ish affine.

    Solved per-axis with Cramer's rule on the 3x3 column matrix.  A truly
    degenerate matrix returns (0,0,0) rather than raising: an annotation stored
    against an unreadable frame should be invisible, not fatal.
    """
    c0, c1, c2 = matrix
    d = tuple(xyz[k] - origin[k] for k in range(3))
    det = _det3(c0, c1, c2)
    if not det or abs(det) < 1e-12:
        return (0, 0, 0)
    i = _det3(d, c1, c2) / det
    j = _det3(c0, d, c2) / det
    k = _det3(c0, c1, d) / det
    return (int(round(i)), int(round(j)), int(round(k)))


def _det3(a, b, c) -> float:
    return (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )