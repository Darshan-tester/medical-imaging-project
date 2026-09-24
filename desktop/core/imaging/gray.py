"""Shared 8-bit grayscale output type, size rules and tunables.

The web renderer's last step is a PNG encode; the desktop viewer paints a
QImage instead, so the port stops at the 8-bit grayscale raster.  Every pixel
value up to that point is computed the same way, which is what the parity test
against the mirrored PNGs checks.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

import numpy as np


def env_int(name: str, fallback: int, lo: int, hi: int) -> int:
    """image-render.ts:1009-1015 - unset or unparseable falls back, then clamps."""
    raw = os.environ.get(name)
    if not raw:
        return fallback
    try:
        value = int(str(raw).strip(), 10)
    except ValueError:
        return fallback
    return max(lo, min(hi, value))


MAX_RENDER_EDGE = 1024
MIN_THUMBNAIL_EDGE = 16
MIN_FULL_EDGE = env_int("SCANLAB_RENDER_MIN_EDGE", 512, 64, MAX_RENDER_EDGE)
VOLUME_MAX_EDGE = env_int("SCANLAB_VOLUME_MAX_EDGE", 256, 64, 1024)
VOLUME_MAX_MB = env_int("SCANLAB_VOLUME_MAX_MB", 384, 32, 4096)
VOLUME3D_MAX_EDGE = env_int("SCANLAB_VOLUME3D_MAX_EDGE", 128, 32, 256)
WINDOW_PCT_LO = env_int("SCANLAB_NIFTI_WINDOW_PCT_LO", 5, 0, 200) / 1000.0
WINDOW_PCT_HI = env_int("SCANLAB_NIFTI_WINDOW_PCT_HI", 995, 800, 1000) / 1000.0
WINDOW_BINS = 1024
WINDOW_MAX_SAMPLES = 4_000_000


@dataclass(frozen=True)
class GrayImage:
    """A single decoded frame: ``pixels`` is (height, width) uint8."""

    pixels: np.ndarray

    @property
    def width(self) -> int:
        return int(self.pixels.shape[1])

    @property
    def height(self) -> int:
        return int(self.pixels.shape[0])

    @property
    def nbytes(self) -> int:
        return int(self.pixels.nbytes)


def normalize_max_edge(value: int | float | None) -> int | None:
    """image-render.ts:66-73 - out of range means 'full size', not a clamp."""
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n < MIN_THUMBNAIL_EDGE or n > MAX_RENDER_EDGE:
        return None
    return n


def js_round(a: np.ndarray) -> np.ndarray:
    """``Math.round`` - half away from +inf, not numpy's banker's rounding."""
    return np.floor(a + 0.5)


def js_round_scalar(value: float) -> int:
    """``Math.round`` for one number, as an int.

    Non-finite input would make ``int()`` raise, so it is reported as 0 - the
    callers all wrap this in ``max(1, ...)`` for a size, which is the same
    outcome JavaScript reaches when it stores NaN into an integer field.
    """
    v = float(value)
    if not math.isfinite(v):
        return 0
    return int(math.floor(v + 0.5))


def fit_edge(width: int, height: int, max_edge: int | None) -> tuple[int, int]:
    """image-render.ts:578-583 - downscale only."""
    longest = max(width, height)
    if not max_edge or longest <= max_edge:
        return width, height
    scale = max_edge / longest
    return max(1, js_round_scalar(width * scale)), max(1, js_round_scalar(height * scale))


def output_size(width: int, height: int, max_edge: int | None) -> tuple[int, int]:
    """image-render.ts:569-583 - volumetric renders are upscaled to MIN_FULL_EDGE."""
    if max_edge:
        return fit_edge(width, height, max_edge)
    longest = max(width, height)
    if longest >= MIN_FULL_EDGE:
        return width, height
    scale = MIN_FULL_EDGE / longest
    return max(1, js_round_scalar(width * scale)), max(1, js_round_scalar(height * scale))


def downscale_nearest(image: GrayImage, max_edge: int | None) -> GrayImage:
    """image-render.ts:1505-1533 - nearest neighbour, applied after the decode."""
    if not max_edge:
        return image
    width, height = fit_edge(image.width, image.height, max_edge)
    if width == image.width and height == image.height:
        return image
    ys = np.minimum(image.height - 1, (np.arange(height) * image.height) // height)
    xs = np.minimum(image.width - 1, (np.arange(width) * image.width) // width)
    return GrayImage(image.pixels[ys[:, None], xs[None, :]])


def to_uint8(values: np.ndarray) -> np.ndarray:
    """Store a float raster into 8 bits the way ``Buffer[i] = v`` does.

    Values are already clamped by the callers; a non-finite value becomes 0,
    which is what assigning NaN into a Node Buffer produces.
    """
    return np.nan_to_num(values, nan=0.0, posinf=255.0, neginf=0.0).astype(np.uint8)
