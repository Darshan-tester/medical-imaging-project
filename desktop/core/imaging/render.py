"""The one entry point every viewer request goes through (image-render.ts:36-118).

``render_image`` resolves any indexed reference to something paintable, exactly
as the web module does, and the four kinds behave the same way they do there:

* ``raster`` - an already-encoded JPEG/PNG/GIF/WebP, handed back untouched.  The
  web app streams these to an ``<img>``; the desktop hands the same bytes to
  ``QImage.fromData``.  ``max_edge`` is deliberately ignored, as it is on the
  web, so a thumbnail never re-encodes (and never degrades) a source photo.
* ``dicom`` - decoded to grayscale at full size, then resampled if a thumbnail
  was asked for.
* ``nifti`` and ``dicom-volume`` - ``max_edge`` goes *into* the reslice, so the
  output grid is built at the requested size rather than shrunk afterwards.

The bounded render cache below is the port of ``renderImageCached``, and it is
also the RAM frame cache the desktop viewer scrolls through: one cache, one
budget, keyed by the caller so a re-index cannot serve stale pixels.  Prefetch
scheduling lives outside it, in the data layer.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .dicom import render_dicom
from .gray import GrayImage, downscale_nearest, env_int, normalize_max_edge
from .nifti import render_nifti
from .stack import DicomVolumeRef, render_dicom_volume

RASTER = "raster"
DICOM = "dicom"
NIFTI = "nifti"
DICOM_VOLUME = "dicom-volume"

#: image-render.ts:59, with the desktop's own rebuild step named instead of npm.
MISSING_VOLUME = (
    "This reconstructed series is missing its volume descriptor — rebuild the "
    "study index"
)


class RenderError(Exception):
    """Raised when a reference cannot be resolved to pixels at all."""


def frame_ref_id(series_id: str, index: int) -> str:
    """series-frames.ts:12 - the id a compact run's frame answers to."""
    return f"{series_id}-{index}"


@dataclass(frozen=True)
class ImageRef:
    """``DatasetImageRef`` (types.ts:50-79) - one addressable frame.

    A series carries *either* an ``images`` list *or* a single compact ``frames``
    run, never both, so the two constructors below are the only two ways a ref
    comes into being.  Both accept ``resolve`` because the desktop stores paths
    relative to the delivered ``dataset/`` folder and joins them at read time -
    the reason no developer-specific path can end up in the index.
    """

    kind: str
    abs_path: str
    index: int = 0
    id: str = ""
    frame_index: int | None = None
    orientation: str | None = None
    width: int | None = None
    height: int | None = None

    @classmethod
    def from_image(cls, raw: dict, resolve: "Callable[[str], str] | None" = None) -> "ImageRef":
        """A materialised ``series.images[i]`` entry."""
        path = str(raw.get("absPath") or "")
        return cls(
            kind=str(raw.get("kind") or RASTER),
            abs_path=resolve(path) if resolve is not None and path else path,
            index=int(raw.get("index") or 0),
            id=str(raw.get("id") or ""),
            frame_index=None if raw.get("frameIndex") is None else int(raw["frameIndex"]),
            orientation=raw.get("orientation") or None,
            width=None if raw.get("width") is None else int(raw["width"]),
            height=None if raw.get("height") is None else int(raw["height"]),
        )

    @classmethod
    def from_frames(
        cls,
        series_id: str,
        run: dict,
        index: int,
        resolve: "Callable[[str], str] | None" = None,
    ) -> "ImageRef | None":
        """series-frames.ts:31-54 - materialise frame ``index`` of a compact run.

        Returns None for an index outside the run instead of a clamped frame:
        the web accessor returns ``undefined`` there, and the viewer shows
        "Unable to load image." rather than silently displaying a neighbour.
        """
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            return None
        count = int(run.get("count") or 0)
        if index >= count:
            return None
        path = str(run.get("absPath") or "")
        return cls(
            kind=str(run.get("kind") or RASTER),
            abs_path=resolve(path) if resolve is not None and path else path,
            index=index,
            id=frame_ref_id(series_id, index),
            frame_index=index,
            orientation=run.get("orientation") or None,
            width=None if run.get("width") is None else int(run["width"]),
            height=None if run.get("height") is None else int(run["height"]),
        )


def raster_content_type(abs_path: str | Path) -> str:
    """image-render.ts:122-123 - by extension, and anything else is a JPEG.

    The fallback is not a guess: the corpus's rasters are X-ray JPEGs, and Qt
    sniffs the real format from the bytes anyway.  It is carried across so the
    desktop reports the same type the web API sends for the same file.
    """
    lower = str(abs_path).lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".gif"):
        return "image/gif"
    if lower.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"


@dataclass(frozen=True)
class RenderedFrame:
    """``RenderedImage``, split by what the UI has to do with it.

    ``gray`` is set for the three decoded kinds and painted as an 8-bit
    ``QImage``; ``data`` is set for ``raster`` and handed to ``QImage.fromData``
    still encoded.  Exactly one of the two is ever present.
    """

    content_type: str
    gray: GrayImage | None = None
    data: bytes | None = None

    @property
    def nbytes(self) -> int:
        if self.gray is not None:
            return self.gray.nbytes
        return len(self.data or b"")

    @property
    def width(self) -> int | None:
        return self.gray.width if self.gray is not None else None

    @property
    def height(self) -> int | None:
        return self.gray.height if self.gray is not None else None


def render_raster(abs_path: str | Path) -> RenderedFrame:
    """image-render.ts:120-125 - read and hand over, no decode, no re-encode."""
    with open(abs_path, "rb") as fh:
        return RenderedFrame(content_type=raster_content_type(abs_path), data=fh.read())


def render_image(
    ref: ImageRef,
    volume: DicomVolumeRef | None = None,
    max_edge: int | float | None = None,
) -> RenderedFrame:
    """image-render.ts:43-63 - the whole dispatch, in the same order.

    An unknown ``kind`` raises instead of returning nothing.  The TypeScript
    switch is exhaustive over its union and falls off the end as ``undefined``
    for anything else; here that would be a blank frame with no explanation, so
    it is surfaced as an error and the viewer's "Unable to load image." shows.
    """
    edge = normalize_max_edge(max_edge)
    kind = ref.kind
    if kind == RASTER:
        # Already-encoded bytes; max_edge is ignored, as on the web.
        return render_raster(ref.abs_path)
    if kind == DICOM:
        # The full-resolution path is untouched, so a thumbnail request is a
        # normal render followed by a resample rather than a second decoder.
        full = render_dicom(ref.abs_path)
        return RenderedFrame(content_type="image/png", gray=downscale_nearest(full, edge) if edge else full)
    if kind == NIFTI:
        gray = render_nifti(ref.abs_path, ref.frame_index or 0, ref.orientation, edge)
        return RenderedFrame(content_type="image/png", gray=gray)
    if kind == DICOM_VOLUME:
        if volume is None or volume.count == 0:
            raise RenderError(MISSING_VOLUME)
        gray = render_dicom_volume(volume, ref.frame_index or 0, ref.orientation, edge)
        return RenderedFrame(content_type="image/png", gray=gray)
    raise RenderError(f"Unsupported image kind: {kind!r}")


# ---------------------------------------------------------------------------
# Rendered-frame cache (image-render.ts:76-118)
# ---------------------------------------------------------------------------
#
# On the web this stops a thumbnail strip re-decoding the same 41 images on
# every slice change.  On the desktop it is also the viewer's RAM frame cache:
# what prev/next scrolling and prefetch land in.  One budget for both jobs,
# because two caches over the same pixels would double the memory for no gain.
#
# The budget counts *raw* pixels here, not an encoded PNG, so 96 MB holds fewer
# frames than the web's 96 MB - and 96 MB of 512x512 frames is still ~390 of
# them.  Keys are supplied by the caller and must fold in the index build id,
# so rebuilding the index cannot serve pixels the previous indexer produced.

RENDER_CACHE_MAX_BYTES = env_int("SCANLAB_RENDER_CACHE_MB", 96, 8, 1024) * 1024 * 1024

_cache: "OrderedDict[str, RenderedFrame]" = OrderedDict()
_cache_bytes = 0
_cache_lock = threading.RLock()


def render_cache_clear() -> None:
    global _cache_bytes
    with _cache_lock:
        _cache.clear()
        _cache_bytes = 0


def render_cache_stats() -> dict:
    """What the Settings page reports; also what the cache tests assert on."""
    with _cache_lock:
        return {
            "entries": len(_cache),
            "bytes": _cache_bytes,
            "max_bytes": RENDER_CACHE_MAX_BYTES,
        }


def render_cache_get(key: str) -> RenderedFrame | None:
    """The cached frame for ``key``, or None - without rendering anything.

    Split out of ``render_image_cached`` so a caller can answer "do I already
    have this?" before doing the work that only exists to *produce* the
    arguments: joining and containment-checking a path, or resolving the 558
    slice files of a volume.  On the desktop that preparation was measurably
    more expensive than the lookup it preceded, which turned a cache hit into
    something the viewer could feel.  A hit counts as a use, so it moves to the
    end of the LRU here exactly as it would there.
    """
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
        return hit


def render_image_cached(
    key: str,
    ref: ImageRef,
    volume: DicomVolumeRef | None = None,
    max_edge: int | float | None = None,
) -> RenderedFrame:
    """image-render.ts:93-118 - LRU on a byte budget, oversized entries passed
    through without being retained so one huge render cannot evict a whole strip.
    """
    global _cache_bytes
    hit = render_cache_get(key)
    if hit is not None:
        return hit

    # Rendered outside the lock: decoding a 512x512x558 reslice must not block
    # every other worker's cache lookup.  A duplicate render under a race costs
    # time, never correctness - the second store simply replaces an equal value.
    rendered = render_image(ref, volume, max_edge)

    if rendered.nbytes * 4 <= RENDER_CACHE_MAX_BYTES:
        with _cache_lock:
            existing = _cache.pop(key, None)
            if existing is not None:
                _cache_bytes -= existing.nbytes
            _cache[key] = rendered
            _cache_bytes += rendered.nbytes
            while _cache_bytes > RENDER_CACHE_MAX_BYTES and _cache:
                _, evicted = _cache.popitem(last=False)
                _cache_bytes -= evicted.nbytes
    return rendered
