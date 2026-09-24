"""Volume rendering: transfer functions and downsampled volumes.

The transfer-function half is pure and numpy-free so it can be tested headless.
The renderer itself (``ui/widgets/volume3d.py``) is a QOpenGLWidget doing
single-pass GPU ray casting: it uploads the downsampled intensity volume as an
``R16`` texture and per-samples this module's transfer functions on the GPU,
so no fabricated geometry is ever computed here - a voxel's color and opacity
are exactly what its measured intensity maps to.

Honesty constraints this module enforces by construction:

* MRI intensity data has no true tissue colors.  Every non-grayscale preset is
  labeled pseudocolor and the legend string travels with the preset, so the UI
  cannot present generated colors as recovered tissue colors.
* A volume too large for the GPU is downsampled by integer factors before
  upload, and the renderer says so ("reduced quality"), never pretending the
  full resolution was rendered.
"""

from __future__ import annotations

import numpy as np

# ---------------------------------------------------------------------------
# Transfer functions
# ---------------------------------------------------------------------------

#: (id, label, legend, kind).  ``kind`` "gray" is the measured intensity; every
#: other kind is pseudocolor and its legend says so.
PRESETS: tuple[tuple[str, str, str, str], ...] = (
    ("gray", "Grayscale", "Measured intensity, no color mapping", "gray"),
    ("bone", "Bone (pseudocolor)", "Pseudocolor: intensity mapped to a bone-like ramp", "ramp"),
    ("soft", "Soft tissue (pseudocolor)", "Pseudocolor: intensity mapped to a soft-tissue ramp", "ramp"),
    ("mri-rainbow", "MRI spectrum (pseudocolor)", "Pseudocolor: intensity mapped to a spectral ramp - not natural tissue colors", "ramp"),
    ("mri-warm", "MRI warm (pseudocolor)", "Pseudocolor: intensity mapped to a warm ramp - not natural tissue colors", "ramp"),
)
DEFAULT_PRESET = "gray"


def preset_by_id(preset_id: str) -> tuple[str, str, str, str] | None:
    for entry in PRESETS:
        if entry[0] == preset_id:
            return entry
    return None


def _ramp(stops: list[tuple[float, tuple[float, float, float]]],
          value: float) -> tuple[float, float, float]:
    """Piecewise-linear color ramp; value in 0..1."""
    if value <= stops[0][0]:
        return stops[0][1]
    for (a0, c0), (a1, c1) in zip(stops, stops[1:]):
        if value <= a1:
            t = (value - a0) / max(1e-6, a1 - a0)
            return tuple(c0[k] + (c1[k] - c0[k]) * t for k in range(3))
    return stops[-1][1]


_BONE = [(0.0, (0.0, 0.0, 0.0)), (0.35, (0.2, 0.12, 0.08)),
         (0.6, (0.8, 0.72, 0.55)), (1.0, (1.0, 0.98, 0.92))]
_SOFT = [(0.0, (0.01, 0.01, 0.02)), (0.4, (0.55, 0.2, 0.15)),
         (0.7, (0.9, 0.75, 0.5)), (1.0, (1.0, 1.0, 0.98))]
_RAINBOW = [(0.0, (0.0, 0.0, 0.1)), (0.25, (0.0, 0.2, 0.7)),
            (0.5, (0.0, 0.75, 0.35)), (0.75, (0.95, 0.85, 0.1)),
            (1.0, (0.95, 0.2, 0.15))]
_WARM = [(0.0, (0.02, 0.0, 0.05)), (0.45, (0.65, 0.15, 0.3)),
         (0.8, (0.98, 0.6, 0.15)), (1.0, (1.0, 0.95, 0.7))]
_RAMPS = {"bone": _BONE, "soft": _SOFT, "mri-rainbow": _RAINBOW, "mri-warm": _WARM}


def color_for(preset_id: str, intensity01: float) -> tuple[float, float, float]:
    """RGB (0..1) for a normalized intensity. Grayscale maps to itself."""
    if preset_id == DEFAULT_PRESET:
        v = min(1.0, max(0.0, intensity01))
        return (v, v, v)
    ramp = _RAMPS.get(preset_id)
    if ramp is None:
        v = min(1.0, max(0.0, intensity01))
        return (v, v, v)
    return _ramp(ramp, min(1.0, max(0.0, intensity01)))


def opacity_for(intensity01: float, threshold: float, falloff: float) -> float:
    """Scalar-opacity transfer function: transparent below the threshold."""
    v = min(1.0, max(0.0, intensity01))
    if v <= threshold:
        return 0.0
    return min(1.0, (v - threshold) / max(1e-6, falloff))


def build_lut(preset_id: str, n: int = 256) -> np.ndarray:
    """RGBA lookup table (n x 4, float32 0..1) baked once per setting change.

    The GPU shader indexes this by normalized intensity, so a color/opacity
    change costs one 1 KB upload rather than a re-render of the math.
    """
    lut = np.zeros((n, 4), dtype=np.float32)
    for i in range(n):
        v = i / (n - 1)
        r, g, b = color_for(preset_id, v)
        lut[i, 0], lut[i, 1], lut[i, 2] = r, g, b
    return lut


# ---------------------------------------------------------------------------
# Volume preparation
# ---------------------------------------------------------------------------

def prepare_volume(
    data: np.ndarray,
    max_voxels: int = 8_000_000,
) -> tuple[np.ndarray, tuple[int, int, int], int, float, float]:
    """Downsample to a GPU-friendly size; report what was done.

    Returns ``(volume_u16, dims, step, vmin, vmax)``.  ``step`` is the integer
    decimation applied per axis (1 = none); the renderer reports any step > 1
    as reduced quality rather than hiding it.  Intensities are preserved with
    slope/inter applied, clipped to a finite 16-bit range - the raw storage is
    never modified.
    """
    data = np.asarray(data)
    finite = data[np.isfinite(data)]
    if finite.size == 0:
        raise ValueError("volume has no finite samples")
    vmin = float(finite.min())
    vmax = float(finite.max())
    span = max(1e-9, vmax - vmin)
    scaled = (data - vmin) / span
    scaled = np.nan_to_num(scaled, nan=0.0, posinf=1.0, neginf=0.0)
    u16 = np.clip(scaled * 65535.0, 0, 65535).astype(np.uint16)

    dims = u16.shape[:3]
    step = 1
    while int(dims[0]) * int(dims[1]) * int(dims[2]) > max_voxels:
        dims = (max(1, dims[0] // 2), max(1, dims[1] // 2), max(1, dims[2] // 2))
        step *= 2
    if step > 1:
        u16 = u16[::step, ::step, ::step]
    return (np.ascontiguousarray(u16), tuple(int(d) for d in u16.shape), step,
            vmin, vmax)