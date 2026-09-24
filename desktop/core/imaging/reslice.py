"""Bilinear reslicing (image-render.ts:463-562).

One implementation serves NIfTI volumes and reconstructed DICOM stacks.  The
output grid is physically square: a 4.07 x 4.07 x 5 mm PET volume comes out 271
rows tall coronally rather than a squashed 221, because the geometry comes from
measured spacing.

Interpolation is strictly in-plane and adds no information - it replaces the
blocky replicated rows of a nearest-neighbour upsample with a linear ramp
between the same two measured samples.

Voxel indexing assumes array axis 0 is fastest-varying (``strides = [1, nx,
nx*ny]``), which is true for NIfTI and is how the DICOM stack loader packs its
slices.  Getting this backwards transposes every reslice.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometry import PlaneGeometry, clamp_int, resolve_index
from .gray import GrayImage, js_round, output_size, to_uint8


@dataclass(frozen=True)
class AxisSamples:
    """Source offsets and weights for one output axis, resolved once per reslice."""

    __slots__ = ("a", "b", "w")
    #: Element offsets (already multiplied by the array stride) of the two taps.
    a: np.ndarray
    b: np.ndarray
    #: Fraction of the way from ``a`` to ``b``.
    w: np.ndarray


def sample_axis(out: int, n: int, flip: bool, stride: int) -> AxisSamples:
    """Output pixel centres map to source coordinate ``(o + 0.5) * n / out - 0.5``.

    A 1:1 axis therefore lands exactly on ``w = 0``, so an unscaled acquired
    plane still comes out byte-for-byte identical to the nearest-neighbour
    render it replaced.  A flip is a mirror and preserves adjacency, so both
    taps are mirrored while the weight is left alone.
    """
    o = np.arange(out, dtype=np.float64)
    s = ((o + 0.5) * n) / out - 0.5
    i0 = np.floor(s)
    frac = s - i0

    lo0 = np.clip(i0, 0, n - 1).astype(np.int64)
    lo1 = np.clip(i0 + 1.0, 0, n - 1).astype(np.int64)
    if flip:
        lo0 = (n - 1) - lo0
        lo1 = (n - 1) - lo1
    return AxisSamples(lo0 * stride, lo1 * stride, np.clip(frac, 0.0, 1.0))


def reslice_to_gray(
    data: np.ndarray,
    dims: tuple[int, int, int],
    plane: PlaneGeometry,
    through_index: int,
    slope: float,
    inter: float,
    window: tuple[float, float] | None = None,
    invert: bool = False,
    max_edge: int | None = None,
) -> GrayImage:
    """image-render.ts:500-562, stopping at the 8-bit raster instead of a PNG."""
    strides = (1, dims[0], dims[0] * dims[1])

    index = clamp_int(through_index, 0, plane.slice_count - 1)
    n_h = dims[plane.horizontal.axis]
    n_v = dims[plane.vertical.axis]
    base = resolve_index(index, dims[plane.through.axis], plane.through.flip) * strides[plane.through.axis]

    width, height = output_size(plane.width, plane.height, max_edge)
    cols = sample_axis(width, n_h, plane.horizontal.flip, strides[plane.horizontal.axis])
    rows = sample_axis(height, n_v, plane.vertical.flip, strides[plane.vertical.axis])

    row_a = (base + rows.a)[:, None]
    row_b = (base + rows.b)[:, None]
    col_a = cols.a[None, :]
    col_b = cols.b[None, :]
    wx = cols.w[None, :]
    wy = rows.w[:, None]

    aa = data[row_a + col_a].astype(np.float64)
    ab = data[row_a + col_b].astype(np.float64)
    ba = data[row_b + col_a].astype(np.float64)
    bb = data[row_b + col_b].astype(np.float64)
    top = aa + (ab - aa) * wx
    bot = ba + (bb - ba) * wx
    values = (top + (bot - top) * wy) * float(slope) + float(inter)

    if window is not None:
        lo = float(window[0])
        span = max(1e-6, float(window[1]))
    else:
        # JavaScript's running min/max ignore NaN (every comparison is false)
        # but do take an infinity, which then fails the finite check below.
        usable = values[~np.isnan(values)]
        if usable.size:
            lo_v = float(usable.min())
            hi_v = float(usable.max())
        else:
            lo_v, hi_v = float("inf"), float("-inf")
        if not np.isfinite(lo_v) or not np.isfinite(hi_v):
            lo_v, hi_v = 0.0, 1.0
        lo = lo_v
        span = max(1e-6, hi_v - lo_v)

    scaled = js_round(((values - lo) / span) * 255.0)
    scaled = np.clip(scaled, 0.0, 255.0)
    if invert:
        # After the clamp, exactly as the JS does it, so NaN stays NaN -> 0.
        scaled = 255.0 - scaled
    return GrayImage(to_uint8(scaled).reshape(height, width))
