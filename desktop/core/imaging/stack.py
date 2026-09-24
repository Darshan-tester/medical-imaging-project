"""Reconstructed DICOM volumes - CT MPR (image-render.ts:939-1491).

A CT series arrives as hundreds of single-slice instances.  Each renders on its
own through ``dicom.render_dicom``; a coronal or sagittal view exists only
across the stack, so this module rebuilds the stack into a real 3-D array and
sends it through the same ``reslice_to_gray`` a NIfTI volume uses.  Nothing here
rotates an axial image.

Only the render-time half of the web module is ported.  ``orderDicomStack`` and
``describeDicomStack`` run at index time, and indexing stays with the existing
Node adapter, which writes the finished descriptor into the manifest as
``study.volumes[volumeId]``: files in spatial order, in-plane size, pixel
spacing, ImageOrientationPatient and the measured slice delta.  Re-deriving
those from 558 DICOM headers on every reslice is exactly the I/O the manifest
exists to avoid.
"""

from __future__ import annotations

import math
import os
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from . import dicom
from .geometry import VolumeGeometry, is_mpr_plane, planes_from_affine, positive_or
from .gray import VOLUME3D_MAX_EDGE, VOLUME_MAX_EDGE, VOLUME_MAX_MB, GrayImage, to_uint8
from .reslice import reslice_to_gray

#: image-render.ts:1140 - below this a "volume" is a localiser or a scout pair.
MIN_STACK_SLICES = 8

#: image-render.ts:1211 - one 384 MB volume in memory, not two.
STACK_CACHE_MAX = 1

#: How many instances are read at once.  The JavaScript loop is sequential
#: because Node's fs is; slices land in disjoint regions of the buffer and the
#: min/max reduction is order-independent, so a thread pool produces the same
#: volume, the same window and the same pixels - just sooner.  Reading 558
#: instances is the slowest thing the viewer does.
STACK_WORKERS = max(1, min(8, (os.cpu_count() or 4)))


class StackError(Exception):
    """Raised when a series cannot be reconstructed; the UI shows the message."""


@dataclass(frozen=True)
class DicomVolumeRef:
    """``study.volumes[volumeId]`` from the manifest, in Python form.

    ``pixel_spacing`` keeps the DICOM order - [between rows, between columns],
    i.e. [dj, di] - because that is how the indexer wrote it.
    """

    files: tuple[str, ...]
    rows: int
    columns: int
    pixel_spacing: tuple[float, float]
    iop: tuple[float, float, float, float, float, float]
    slice_delta: float
    spacing_from_positions: bool

    @classmethod
    def from_manifest(cls, raw: dict, resolve: Callable[[str], str] | None = None) -> "DicomVolumeRef":
        """Build a ref from manifest JSON, mapping each recorded path.

        ``resolve`` is how the desktop build turns the indexer's absolute paths
        into paths inside the delivered ``dataset/`` folder; without it the
        recorded paths are used unchanged.
        """
        files = [str(f) for f in (raw.get("files") or [])]
        if resolve is not None:
            files = [resolve(f) for f in files]
        spacing = list(raw.get("pixelSpacing") or [1.0, 1.0])
        while len(spacing) < 2:
            spacing.append(1.0)
        iop = [float(v) for v in (raw.get("iop") or [1, 0, 0, 0, 1, 0])]
        while len(iop) < 6:
            iop.append(0.0)
        return cls(
            files=tuple(files),
            rows=int(raw.get("rows") or 0),
            columns=int(raw.get("columns") or 0),
            pixel_spacing=(float(spacing[0]), float(spacing[1])),
            iop=(iop[0], iop[1], iop[2], iop[3], iop[4], iop[5]),
            slice_delta=float(raw.get("sliceDelta") or 0.0),
            spacing_from_positions=bool(raw.get("spacingFromPositions")),
        )

    @property
    def count(self) -> int:
        return len(self.files)


def _cross(a: Iterable[float], b: Iterable[float]) -> tuple[float, float, float]:
    ax, ay, az = (list(a) + [0.0, 0.0, 0.0])[:3]
    bx, by, bz = (list(b) + [0.0, 0.0, 0.0])[:3]
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


def _lps_to_ras(v: Iterable[float]) -> tuple[float, float, float]:
    """image-render.ts:1005-1007 - DICOM patient space is LPS, the core is RAS+."""
    x, y, z = (list(v) + [0.0, 0.0, 0.0])[:3]
    return (-x, -y, z)


def decimation_for(rows: int, columns: int, count: int) -> int:
    """image-render.ts:1187-1194.

    In-plane only.  The through-plane axis is never decimated: it is the point
    of an MPR and is already the coarsest direction.  Spacing is scaled by the
    same factor in ``dicom_volume_geometry``, so a 2 mm-wide decimated voxel is
    described as 2 mm wide and the reconstruction stays proportional.
    """
    step = max(1, math.ceil(max(rows, columns) / VOLUME_MAX_EDGE))
    budget = VOLUME_MAX_MB * 1024 * 1024
    while math.ceil(columns / step) * math.ceil(rows / step) * count * 4 > budget and step < 32:
        step += 1
    return step


@dataclass(frozen=True)
class StackGeometry(VolumeGeometry):
    """``DicomStackGeometry`` - the shared plane geometry plus stack facts."""

    count: int = 0
    #: In-plane decimation applied while loading (1 = full resolution).
    step: int = 1
    source_rows: int = 0
    source_columns: int = 0
    #: Signed mm step along the slice normal between consecutive instances.
    slice_delta: float = 0.0
    #: True when the spacing came from measured positions, not SliceThickness.
    spacing_from_positions: bool = False


def dicom_volume_geometry(ref: DicomVolumeRef) -> StackGeometry | None:
    """image-render.ts:1098-1137 - pure, header-free, driven by the manifest.

    Returns None rather than a guess when the descriptor cannot describe a
    volume: too few instances, no in-plane size, or a zero/non-finite slice
    delta.  A guessed spacing would produce a reslice that looks plausible and
    is anatomically wrong.
    """
    count = ref.count
    if count < MIN_STACK_SLICES or not ref.rows or not ref.columns:
        return None

    iop = ref.iop
    col_dir = _lps_to_ras(iop[0:3])  # +1 column => +1 along array axis i
    row_dir = _lps_to_ras(iop[3:6])  # +1 row    => +1 along array axis j
    normal_ras = _lps_to_ras(_cross(iop[0:3], iop[3:6]))

    row_spacing = positive_or(ref.pixel_spacing[0], 1.0)
    col_spacing = positive_or(ref.pixel_spacing[1], 1.0)
    delta = float(ref.slice_delta)
    if not math.isfinite(delta) or delta == 0.0:
        return None

    step = decimation_for(ref.rows, ref.columns, count)
    dims = (
        max(1, math.ceil(ref.columns / step)),
        max(1, math.ceil(ref.rows / step)),
        count,
    )
    spacing = (col_spacing * step, row_spacing * step, abs(delta))

    # Column j of the affine is the world direction of +1 step along array axis j.
    affine = [
        [col_dir[world] * spacing[0], row_dir[world] * spacing[1], normal_ras[world] * delta]
        for world in (0, 1, 2)
    ]
    base = planes_from_affine(dims, spacing, affine, True)
    return StackGeometry(
        dims=base.dims,
        spacing=base.spacing,
        planes=base.planes,
        acquired_plane=base.acquired_plane,
        has_spatial_transform=True,
        count=count,
        step=step,
        source_rows=ref.rows,
        source_columns=ref.columns,
        slice_delta=delta,
        spacing_from_positions=ref.spacing_from_positions,
    )


@dataclass
class LoadedStack:
    """A reconstructed volume: rescaled values (HU for CT) in i-fastest order."""

    geometry: StackGeometry
    data: np.ndarray
    #: One window for the whole stack, so scrolling does not pulse in brightness.
    window: tuple[float, float]
    invert: bool

    @property
    def nbytes(self) -> int:
        return int(self.data.nbytes)


_cache: "OrderedDict[str, LoadedStack]" = OrderedDict()
_cache_lock = threading.RLock()


def stack_cache_clear() -> None:
    with _cache_lock:
        _cache.clear()


def _stack_key(ref: DicomVolumeRef, step: int) -> str:
    """image-render.ts:1217-1221 - count, decimation and the two end paths."""
    first = ref.files[0] if ref.files else ""
    last = ref.files[-1] if ref.files else ""
    return f"{len(ref.files)}::{step}::{first}::{last}"


def load_dicom_stack(ref: DicomVolumeRef, use_cache: bool = True) -> LoadedStack | None:
    """image-render.ts:1223-1245 - one entry, most-recently-used kept."""
    geometry = dicom_volume_geometry(ref)
    if geometry is None:
        return None
    key = _stack_key(ref, geometry.step)
    if use_cache:
        with _cache_lock:
            cached = _cache.get(key)
            if cached is not None:
                _cache.move_to_end(key)
                return cached
    built = _build_stack(ref, geometry)
    if built is None:
        return None
    if use_cache:
        with _cache_lock:
            _cache[key] = built
            while len(_cache) > STACK_CACHE_MAX:
                _cache.popitem(last=False)
    return built


def _sample_index(geometry: StackGeometry) -> np.ndarray:
    """The (ny, nx) element offsets this stack samples out of each instance.

    ``min(jj * step, rows - 1)`` is the JavaScript loop's clamp, kept so the
    last decimated row/column repeats rather than wrapping.
    """
    nx, ny = geometry.dims[0], geometry.dims[1]
    step = geometry.step
    js = np.minimum(np.arange(ny, dtype=np.int64) * step, geometry.source_rows - 1)
    ii = np.minimum(np.arange(nx, dtype=np.int64) * step, geometry.source_columns - 1)
    return js[:, None] * geometry.source_columns + ii[None, :]


def _build_stack(ref: DicomVolumeRef, geometry: StackGeometry, workers: int | None = None) -> LoadedStack | None:
    """image-render.ts:1247-1284 - decode every instance into one buffer."""
    nx, ny, nz = geometry.dims
    slice_voxels = nx * ny
    data = np.zeros(slice_voxels * nz, dtype=np.float32)
    index = _sample_index(geometry)

    def work(k: int) -> "DecodedSlice | None":
        path = ref.files[k] if k < len(ref.files) else ""
        if not path:
            return None
        return decode_instance_into(path, geometry, data, k * slice_voxels, index)

    n = max(1, min(workers or STACK_WORKERS, nz))
    if n > 1:
        with ThreadPoolExecutor(max_workers=n) as ex:
            slices = list(ex.map(work, range(nz)))
    else:
        slices = [work(k) for k in range(nz)]
    if any(s is None for s in slices):
        return None

    min_v = min(s.min for s in slices)  # type: ignore[union-attr]
    max_v = max(s.max for s in slices)  # type: ignore[union-attr]
    first = slices[0]
    invert = bool(first.invert)  # type: ignore[union-attr]
    stored = first.window  # type: ignore[union-attr]
    if not math.isfinite(min_v) or not math.isfinite(max_v):
        min_v, max_v = 0.0, 1.0

    # The scanner's own window if it stored one, else this volume's measured
    # range.  Never a hardcoded lung/bone preset invented here.
    if stored is not None and stored[1] > 0:
        window = (stored[0] - stored[1] / 2.0, stored[1])
    else:
        window = (min_v, max(1e-6, max_v - min_v))
    return LoadedStack(geometry=geometry, data=data, window=window, invert=invert)


@dataclass(frozen=True)
class DecodedSlice:
    __slots__ = ("min", "max", "invert", "window")
    min: float
    max: float
    invert: bool
    #: (center, width) as stored by the scanner, or None.
    window: tuple[float, float] | None


def _read_plane(buf: bytes, offset: int, count: int, bytes_per_sample: int, signed: bool) -> np.ndarray:
    """One instance's pixel plane as stored, tolerating an odd ``dataOffset``.

    The web renderer reads through a ``DataView`` for exactly this reason.
    ``np.frombuffer`` cannot start a 16-bit view at an odd address, so those -
    legal, and present in the wild - are recomposed from bytes instead.
    """
    if bytes_per_sample == 1:
        dtype = np.dtype("i1") if signed else np.dtype("u1")
        return np.frombuffer(buf, dtype=dtype, count=count, offset=offset)
    dtype = np.dtype("<i2") if signed else np.dtype("<u2")
    if offset % 2 == 0:
        return np.frombuffer(buf, dtype=dtype, count=count, offset=offset)
    raw = np.frombuffer(buf, dtype=np.uint8, count=count * 2, offset=offset)
    combined = raw[0::2].astype(np.uint16) | (raw[1::2].astype(np.uint16) << 8)
    return combined.view(np.int16) if signed else combined


def decode_instance_into(
    path: str | Path,
    geometry: StackGeometry,
    target: np.ndarray,
    offset: int,
    index: np.ndarray | None = None,
) -> DecodedSlice | None:
    """image-render.ts:1306-1377 - one instance straight into the volume buffer.

    A separate decoder from ``render_dicom`` on purpose: that is the live
    single-slice path and stays as it is.  The pixel interpretation mirrors it -
    bits allocated, pixel representation, rescale slope/intercept, photometric
    inversion - and, as there, an instance whose size disagrees with the stack
    is rejected rather than stretched.
    """
    try:
        ds = dicom.read_file(path)
    except Exception:
        return None

    transfer_syntax = ds.transfer_syntax
    if transfer_syntax and transfer_syntax not in dicom.READABLE_TRANSFER_SYNTAXES:
        return None

    rows = ds.uint16(dicom.T_ROWS) or 0
    columns = ds.uint16(dicom.T_COLUMNS) or 0
    if rows != geometry.source_rows or columns != geometry.source_columns:
        return None

    element = ds.elements.get(dicom.T_PIXEL_DATA)
    if element is None or element.length <= 0:
        return None

    bits_allocated = ds.uint16(dicom.T_BITS_ALLOCATED)
    bits_allocated = 16 if bits_allocated is None else bits_allocated
    representation = ds.uint16(dicom.T_PIXEL_REPRESENTATION)
    signed = (0 if representation is None else representation) == 1
    samples = ds.uint16(dicom.T_SAMPLES_PER_PIXEL)
    if (1 if samples is None else samples) != 1:
        # Colour CT does not exist; unreadable beats guessing a luma.
        return None
    slope = ds.float_string(dicom.T_RESCALE_SLOPE)
    slope = 1.0 if slope is None else slope
    inter = ds.float_string(dicom.T_RESCALE_INTERCEPT)
    inter = 0.0 if inter is None else inter
    bytes_per_sample = 1 if bits_allocated == 8 else 2

    available = min(element.length, len(ds.buf) - element.offset)
    if available < rows * columns * bytes_per_sample:
        return None

    nx, ny = geometry.dims[0], geometry.dims[1]
    if index is None:
        index = _sample_index(geometry)
    plane = _read_plane(ds.buf, element.offset, rows * columns, bytes_per_sample, signed)
    values = plane[index].astype(np.float64) * float(slope) + float(inter)
    # min/max come from the full-precision values, as they do in JavaScript,
    # while the buffer itself is float32 - the same two-precision arrangement.
    target[offset : offset + nx * ny] = values.reshape(-1)

    center = ds.float_string(dicom.T_WINDOW_CENTER)
    width = ds.float_string(dicom.T_WINDOW_WIDTH)
    stored = (float(center), float(width)) if center is not None and width is not None and width > 0 else None
    photometric = ds.string(dicom.T_PHOTOMETRIC)
    return DecodedSlice(
        min=float(values.min()),
        max=float(values.max()),
        invert=("MONOCHROME2" if photometric is None else photometric) == "MONOCHROME1",
        window=stored,
    )


#: image-render.ts:1394 - the exact text the web UI shows, kept verbatim.
UNRECONSTRUCTABLE = (
    "This series could not be reconstructed into a volume — its instances are "
    "inconsistent, or their pixel data is in a compressed transfer syntax this "
    "renderer cannot read"
)


def render_dicom_volume(
    ref: DicomVolumeRef,
    frame_index: int,
    plane: str | None = None,
    max_edge: int | None = None,
    use_cache: bool = True,
) -> GrayImage:
    """image-render.ts:1385-1417.

    ``frame_index`` counts slices along the requested plane's axis, exactly as
    it does for NIfTI: both volumetric sources share ``reslice_to_gray``, so a
    coronal CT and a coronal MR come out of the same code with the same
    left/right convention.  Rescale slope and intercept were applied per
    instance while the volume was built, so the values here are already HU.
    """
    stack = load_dicom_stack(ref, use_cache=use_cache)
    if stack is None:
        raise StackError(UNRECONSTRUCTABLE)
    requested = plane if is_mpr_plane(plane) else stack.geometry.acquired_plane
    p = stack.geometry.planes[requested]
    if p.slice_count < 1:
        raise StackError(
            f"This volume has no {requested.lower()} extent, so that plane cannot be reconstructed"
        )
    return reslice_to_gray(
        stack.data,
        stack.geometry.dims,
        p,
        frame_index,
        1.0,
        0.0,
        window=stack.window,
        invert=stack.invert,
        max_edge=max_edge,
    )


@dataclass(frozen=True)
class ExportedVolume:
    """A whole stack as one 8-bit scalar field, for the interactive 3-D view."""

    bytes: np.ndarray
    #: i-fastest, matching ``bytes``.
    dims: tuple[int, int, int]
    #: Real physical size of one exported voxel along each of those axes.
    spacing_mm: tuple[float, float, float]
    #: The HU window mapped onto 0-255, so the view can label its own controls.
    window_lo: float
    window_hi: float


def export_dicom_volume(ref: DicomVolumeRef, use_cache: bool = True) -> ExportedVolume | None:
    """image-render.ts:1452-1491.

    Quantising to 8 bits is a display decision, not a data one - the 2-D planes
    still read full precision.  This exists so a 3-D view can exist at all: a
    512x512x558 float volume is 585 MB.
    """
    stack = load_dicom_stack(ref, use_cache=use_cache)
    if stack is None:
        return None
    nx, ny, nz = stack.geometry.dims
    step = max(1, math.ceil(max(nx, ny, nz) / VOLUME3D_MAX_EDGE))
    ox = max(1, math.ceil(nx / step))
    oy = max(1, math.ceil(ny / step))
    oz = max(1, math.ceil(nz / step))

    lo, rng = stack.window
    scale = 255.0 / rng if rng > 0 else 0.0
    si = np.minimum(np.arange(ox, dtype=np.int64) * step, nx - 1)
    sj = np.minimum(np.arange(oy, dtype=np.int64) * step, ny - 1)
    sk = np.minimum(np.arange(oz, dtype=np.int64) * step, nz - 1)
    grid = stack.data.reshape(nz, ny, nx)[sk[:, None, None], sj[None, :, None], si[None, None, :]]
    out = (grid.astype(np.float64) - lo) * scale
    np.clip(out, 0.0, 255.0, out=out)
    if stack.invert:
        out = 255.0 - out
    # A float stored into a Uint8Array truncates; ``to_uint8`` does the same.
    sx, sy, sz = stack.geometry.spacing
    return ExportedVolume(
        bytes=to_uint8(out).reshape(-1),
        dims=(ox, oy, oz),
        spacing_mm=(sx * step, sy * step, sz * step),
        window_lo=lo,
        window_hi=lo + rng,
    )









