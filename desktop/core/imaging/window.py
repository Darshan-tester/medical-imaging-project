"""Volume-wide display window (image-render.ts:659-711).

A NIfTI file carries no window/level, so one is measured from the voxels: a
0.5 % / 99.5 % percentile clip estimated from a 1024-bin histogram over at most
four million strided samples.  It is computed **once per volume**, not per
slice, which is what stops brightness from pulsing while scrolling a PET
series.  No modality preset is ever applied.
"""

from __future__ import annotations

import math

import numpy as np

from .gray import WINDOW_BINS, WINDOW_MAX_SAMPLES, WINDOW_PCT_HI, WINDOW_PCT_LO


def compute_volume_window(data: np.ndarray, slope: float, inter: float) -> tuple[float, float]:
    """Return ``(lo, range)`` exactly as ``computeVolumeWindow`` does.

    ``data`` is the whole decoded voxel array - for a 4-D file that includes
    every time point, because the JavaScript walks ``data.length``.
    """
    n = int(data.size)
    if not n:
        return 0.0, 1.0
    stride = max(1, int(math.ceil(n / WINDOW_MAX_SAMPLES)))

    samples = data[::stride].astype(np.float64) * float(slope) + float(inter)
    finite = samples[np.isfinite(samples)]
    count = int(finite.size)
    if count == 0:
        # min stays +Infinity in the JS, so `Number.isFinite(min)` is false.
        return 0.0, 1.0
    lo_v = float(finite.min())
    hi_v = float(finite.max())
    if hi_v <= lo_v:
        return lo_v, 1.0

    span = hi_v - lo_v
    bins = np.floor(((finite - lo_v) / span) * WINDOW_BINS)
    bins = np.clip(bins, 0, WINDOW_BINS - 1).astype(np.int64)
    hist = np.bincount(bins, minlength=WINDOW_BINS)

    lo_target = count * WINDOW_PCT_LO
    hi_target = count * WINDOW_PCT_HI
    cumulative = np.cumsum(hist)
    lo_hits = np.nonzero(cumulative >= lo_target)[0]
    hi_hits = np.nonzero(cumulative >= hi_target)[0]
    lo_bin = int(lo_hits[0]) if lo_hits.size else 0
    hi_bin = int(hi_hits[0]) if hi_hits.size else WINDOW_BINS - 1

    lo = lo_v + (lo_bin / WINDOW_BINS) * span
    hi = lo_v + ((hi_bin + 1) / WINDOW_BINS) * span
    return lo, max(1e-6, hi - lo)
