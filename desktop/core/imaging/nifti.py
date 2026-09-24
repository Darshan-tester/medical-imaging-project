"""NIfTI volumes, ported from ``nifti-reader-js`` 0.6.8 + image-render.ts.

The web renderer delegates header parsing to ``nifti-reader-js``, so parity
means reproducing *that* library rather than the NIfTI specification where the
two differ.  Three such differences matter and are reproduced deliberately:

* ``isCompressed`` is an **or**: a file whose second byte is 0x8B is treated as
  gzip even if the first is not 0x1F.
* the affine is built by the library's METHOD 0 / METHOD 2 / METHOD 3 cascade,
  and ``quatern_a = sqrt(1 - (b*b + c*c + d*d))`` is allowed to come out NaN.
* ``niftiTypedArray`` views the voxel bytes with the **platform** endianness
  (little, on every machine this ships to), not the endianness detected from
  the header.  A big-endian NIfTI would therefore be misread - by both the web
  app and this port, identically.  None exist in the indexed corpus.

Only the 3-D reslicing path is used; a 4-D file's extra time points still count
towards the display window, exactly as ``data.length`` does in JavaScript.
"""

from __future__ import annotations

import math
import struct
import threading
import zlib
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .geometry import VolumeGeometry, is_mpr_plane, planes_from_affine, positive_or
from .gray import GrayImage
from .reslice import reslice_to_gray
from .window import compute_volume_window

NIFTI1_HEADER_SIZE = 348
NIFTI2_HEADER_SIZE = 540
_NIFTI1_MAGIC = b"n+1"
_NIFTI2_MAGIC = b"n+2"

#: nifti-voxels.ts:41-62.  An unrecognised code falls back to int16, the
#: commonest NIfTI element type, rather than refusing the volume outright.
_DTYPES: dict[int, str] = {
    2: "<u1",
    4: "<i2",
    8: "<i4",
    16: "<f4",
    64: "<f8",
    256: "<i1",
    512: "<u2",
    768: "<u4",
}
_FALLBACK_DTYPE = "<i2"

DATATYPE_NAMES = {
    2: "uint8",
    4: "int16",
    8: "int32",
    16: "float32",
    64: "float64",
    128: "rgb24",
    256: "int8",
    512: "uint16",
    768: "uint32",
}

#: image-render.ts:720 - two entries covers "scrolling one study, occasionally
#: flipping to its second series" without holding much memory.
VOLUME_CACHE_MAX = 2


class NiftiError(Exception):
    """Raised for files this reader cannot decode; callers surface it as text."""


def _js_or(value: float, fallback: float) -> float:
    """JavaScript ``value || fallback``: 0, -0 and NaN all take the fallback."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return fallback
    if v != v or v == 0.0:
        return fallback
    return v


def _js_to_integer(value: float) -> int:
    """``ToIntegerOrInfinity`` as ``ArrayBuffer.slice`` applies it: NaN -> 0."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0
    if v != v:
        return 0
    if v == math.inf:
        return 1 << 62
    if v == -math.inf:
        return -(1 << 62)
    return int(math.trunc(v))


def _fmt(little: bool) -> str:
    return "<" if little else ">"


def _i8(buf: bytes, off: int) -> int:
    return struct.unpack_from("b", buf, off)[0]


def _i16(buf: bytes, off: int, little: bool) -> int:
    return struct.unpack_from(_fmt(little) + "h", buf, off)[0]


def _i32(buf: bytes, off: int, little: bool) -> int:
    return struct.unpack_from(_fmt(little) + "i", buf, off)[0]


def _i64(buf: bytes, off: int, little: bool) -> int:
    return struct.unpack_from(_fmt(little) + "q", buf, off)[0]


def _f32(buf: bytes, off: int, little: bool) -> float:
    return float(struct.unpack_from(_fmt(little) + "f", buf, off)[0])


def _f64(buf: bytes, off: int, little: bool) -> float:
    return float(struct.unpack_from(_fmt(little) + "d", buf, off)[0])


def _string(buf: bytes, start: int, end: int) -> str:
    return bytes(b for b in buf[start:end] if b != 0).decode("latin-1")


@dataclass
class NiftiHeader:
    """Only the fields this application uses, shared by NIfTI-1 and NIfTI-2."""

    version: int
    little_endian: bool
    #: dims[0] is the dimensionality; dims[1..3] are nx, ny, nz.
    dims: list[int]
    pix_dims: list[float]
    affine: list[list[float]]
    qform_code: int
    sform_code: int
    datatype_code: int
    num_bits_per_voxel: int
    vox_offset: float
    scl_slope: float
    scl_inter: float
    magic: str
    qfac: float = 1.0
    #: Which of the library's three affine methods produced ``affine``.
    affine_method: int = 0

    @property
    def voxel_dtype(self) -> np.dtype:
        return np.dtype(_DTYPES.get(self.datatype_code, _FALLBACK_DTYPE))

    @property
    def datatype_name(self) -> str:
        return DATATYPE_NAMES.get(self.datatype_code, f"unknown({self.datatype_code})")

    @property
    def voxel_count(self) -> int:
        nx = max(1, self.dims[1] if len(self.dims) > 1 else 1)
        ny = max(1, self.dims[2] if len(self.dims) > 2 else 1)
        nz = max(1, self.dims[3] if len(self.dims) > 3 else 1)
        return nx * ny * nz


def is_compressed(buf: bytes) -> bool:
    """nifti.js:isCompressed - deliberately an ``or``, not an ``and``."""
    if len(buf) < 2:
        return False
    return buf[0] == 31 or buf[1] == 139


def decompress(buf: bytes) -> bytes:
    """``fflate.decompressSync`` - gzip, zlib or raw deflate, auto-detected."""
    try:
        return zlib.decompress(buf, 47)
    except zlib.error:
        pass
    try:
        return zlib.decompress(buf, -15)
    except zlib.error as exc:
        raise NiftiError(f"compressed NIfTI data could not be inflated: {exc}") from exc


def is_nifti1(buf: bytes) -> bool:
    return len(buf) >= NIFTI1_HEADER_SIZE and bytes(buf[344:347]) == _NIFTI1_MAGIC


def is_nifti2(buf: bytes) -> bool:
    return len(buf) >= NIFTI1_HEADER_SIZE and bytes(buf[4:7]) == _NIFTI2_MAGIC


def is_nifti(buf: bytes) -> bool:
    return is_nifti1(buf) or is_nifti2(buf)


def _detect_endian(buf: bytes, cookie: int) -> bool:
    """Big-endian is tried first, exactly as ``readHeader`` does."""
    if _i32(buf, 0, False) == cookie:
        return False
    if _i32(buf, 0, True) == cookie:
        return True
    raise NiftiError("This does not appear to be a NIFTI file!")


def _read_nifti1(buf: bytes) -> NiftiHeader:
    """nifti1.js:readHeader."""
    little = _detect_endian(buf, NIFTI1_HEADER_SIZE)
    dims = [_i16(buf, 40 + i * 2, little) for i in range(8)]
    datatype_code = _i16(buf, 70, little)
    num_bits = _i16(buf, 72, little)
    pix_dims = [_f32(buf, 76 + i * 4, little) for i in range(8)]
    vox_offset = _f32(buf, 108, little)
    scl_slope = _f32(buf, 112, little)
    scl_inter = _f32(buf, 116, little)
    qform_code = _i16(buf, 252, little)
    sform_code = _i16(buf, 254, little)

    affine = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
    qfac = 1.0
    method = 3 if sform_code > 0 else 0
    if qform_code < 1 and sform_code < 1:
        # METHOD 0: no spatial transform at all, so pixdim is the whole story.
        method = 0
        affine[0][0] = pix_dims[1]
        affine[1][1] = pix_dims[2]
        affine[2][2] = pix_dims[3]
    if qform_code > 0 and sform_code < qform_code:
        method = 2
        b = _f32(buf, 256, little)
        c = _f32(buf, 260, little)
        d = _f32(buf, 264, little)
        radicand = 1.0 - (b * b + c * c + d * d)
        # JavaScript's Math.sqrt of a negative is NaN, not an exception, and the
        # resulting NaN affine is what assign_axes then has to survive.
        a = math.sqrt(radicand) if radicand >= 0 else math.nan
        qfac = 1.0 if pix_dims[0] == 0 else pix_dims[0]
        rotation = [
            [a * a + b * b - c * c - d * d, 2 * b * c - 2 * a * d, 2 * b * d + 2 * a * c],
            [2 * b * c + 2 * a * d, a * a + c * c - b * b - d * d, 2 * c * d - 2 * a * b],
            [2 * b * d - 2 * a * c, 2 * c * d + 2 * a * b, a * a + d * d - c * c - b * b],
        ]
        for out in range(3):
            for inn in range(3):
                value = rotation[out][inn] * pix_dims[inn + 1]
                if inn == 2:
                    value *= qfac
                affine[out][inn] = value
        affine[0][3] = _f32(buf, 268, little)
        affine[1][3] = _f32(buf, 272, little)
        affine[2][3] = _f32(buf, 276, little)
    elif sform_code > 0:
        method = 3
        for out in range(3):
            for inn in range(4):
                affine[out][inn] = _f32(buf, 280 + (out * 4 + inn) * 4, little)
    affine[3] = [0.0, 0.0, 0.0, 1.0]

    return NiftiHeader(
        version=1,
        little_endian=little,
        dims=dims,
        pix_dims=pix_dims,
        affine=affine,
        qform_code=qform_code,
        sform_code=sform_code,
        datatype_code=datatype_code,
        num_bits_per_voxel=num_bits,
        vox_offset=vox_offset,
        scl_slope=scl_slope,
        scl_inter=scl_inter,
        magic=_string(buf, 344, 348),
        qfac=qfac,
        affine_method=method,
    )


def _long_at(buf: bytes, off: int) -> int:
    """``Utils.getLongAt`` - little-endian composition of **signed** bytes.

    The library reads each of the eight bytes with ``getInt8`` and then folds
    them ``value = value * 256 + array[ctr]`` from the top down, which ignores
    the endianness flag and makes any byte >= 128 contribute negatively.  For
    the values that actually occur (dimensions, ``vox_offset``) every byte is
    below 128 and the result is the correct little-endian integer; it is ported
    verbatim so a pathological header cannot diverge.
    """
    value = 0
    for ctr in range(7, -1, -1):
        value = value * 256 + _i8(buf, off + ctr)
    return value


def _read_nifti2(buf: bytes) -> NiftiHeader:
    """nifti2.js:readHeader - always srow-based, never quaternion-derived."""
    if len(buf) < NIFTI2_HEADER_SIZE:
        raise NiftiError("NIfTI-2 header is truncated")
    little = _detect_endian(buf, NIFTI2_HEADER_SIZE)
    datatype_code = _i16(buf, 12, little)
    num_bits = _i16(buf, 14, little)
    dims = [_long_at(buf, 16 + i * 8) for i in range(8)]
    pix_dims = [_f64(buf, 104 + i * 8, little) for i in range(8)]
    vox_offset = float(_long_at(buf, 168))
    scl_slope = _f64(buf, 176, little)
    scl_inter = _f64(buf, 184, little)
    qform_code = _i32(buf, 344, little)
    sform_code = _i32(buf, 348, little)
    affine = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
    for out in range(3):
        for inn in range(4):
            affine[out][inn] = _f64(buf, 400 + (out * 4 + inn) * 8, little)
    affine[3] = [0.0, 0.0, 0.0, 1.0]
    return NiftiHeader(
        version=2,
        little_endian=little,
        dims=dims,
        pix_dims=pix_dims,
        affine=affine,
        qform_code=qform_code,
        sform_code=sform_code,
        datatype_code=datatype_code,
        num_bits_per_voxel=num_bits,
        vox_offset=vox_offset,
        scl_slope=scl_slope,
        scl_inter=scl_inter,
        magic=_string(buf, 4, 12),
        affine_method=3,
    )


def read_header(buf: bytes) -> NiftiHeader:
    """nifti.js:readHeader - decompress first, then pick the header version."""
    if is_compressed(buf):
        buf = decompress(buf)
    if is_nifti1(buf):
        return _read_nifti1(buf)
    if is_nifti2(buf):
        return _read_nifti2(buf)
    raise NiftiError("That file does not appear to be NIFTI!")


def read_image(header: NiftiHeader, buf: bytes) -> np.ndarray:
    """nifti.js:readImage + nifti-voxels.ts:niftiTypedArray.

    ``vox_offset`` is truncated the way ``ArrayBuffer.slice`` coerces it, and a
    short file simply yields a short array - the reslicer treats reads past the
    end as zero, which is what ``data[i] ?? 0`` does.
    """
    offset = _js_to_integer(header.vox_offset)
    dims = header.dims
    time_dim = dims[4] if len(dims) > 4 and dims[4] else 1
    stat_dim = dims[5] if len(dims) > 5 and dims[5] else 1
    size = int(dims[1] * dims[2] * dims[3] * time_dim * stat_dim * (header.num_bits_per_voxel / 8))
    # ArrayBuffer.prototype.slice semantics, including the negative-index case.
    n = len(buf)
    start = min(max(n + offset, 0) if offset < 0 else offset, n)
    end_raw = offset + size
    end = min(max(n + end_raw, 0) if end_raw < 0 else end_raw, n)
    raw = buf[start : max(start, end)]
    dtype = header.voxel_dtype
    if len(raw) % dtype.itemsize:
        # `new Int16Array(buf)` throws on a byte length that is not a multiple
        # of the element size, and the web renderer surfaces that as an error.
        raise NiftiError("NIfTI pixel data length is not a multiple of the voxel size")
    return np.frombuffer(raw, dtype=dtype)


def geometry_from_header(header: NiftiHeader) -> VolumeGeometry:
    """image-render.ts:843-860."""
    dims = (
        max(1, header.dims[1] if len(header.dims) > 1 else 1),
        max(1, header.dims[2] if len(header.dims) > 2 else 1),
        max(1, header.dims[3] if len(header.dims) > 3 else 1),
    )
    spacing = (
        positive_or(header.pix_dims[1] if len(header.pix_dims) > 1 else None, 1.0),
        positive_or(header.pix_dims[2] if len(header.pix_dims) > 2 else None, 1.0),
        positive_or(header.pix_dims[3] if len(header.pix_dims) > 3 else None, 1.0),
    )
    return planes_from_affine(dims, spacing, header.affine, header.qform_code > 0 or header.sform_code > 0)


@dataclass
class Volume:
    """A decoded NIfTI volume plus everything derived once per decode."""

    header: NiftiHeader
    #: The array exactly as decoded, including any 4-D time points, because the
    #: display window is measured over ``data.length`` in the JavaScript.
    data: np.ndarray
    #: The first 3-D volume, zero-padded if the file was short, so the reslicer
    #: can index it without bounds checks.
    sample: np.ndarray
    geometry: VolumeGeometry
    window: tuple[float, float]
    path: str

    @property
    def nbytes(self) -> int:
        total = int(self.data.nbytes)
        if not np.shares_memory(self.sample, self.data):
            total += int(self.sample.nbytes)
        return total

    @property
    def slope(self) -> float:
        return _js_or(self.header.scl_slope, 1.0)

    @property
    def inter(self) -> float:
        return _js_or(self.header.scl_inter, 0.0)


_cache: "OrderedDict[str, Volume]" = OrderedDict()
_cache_lock = threading.RLock()


def volume_cache_clear() -> None:
    with _cache_lock:
        _cache.clear()


def decode_volume(path: str | Path) -> Volume:
    """image-render.ts:740-750 - read, inflate, type, then measure the window."""
    p = Path(path)
    with open(p, "rb") as fh:
        buf = fh.read()
    if is_compressed(buf):
        buf = decompress(buf)
    if not is_nifti(buf):
        raise NiftiError("Not a valid NIfTI file")
    header = read_header(buf)
    data = read_image(header, buf)
    window = compute_volume_window(data, _js_or(header.scl_slope, 1.0), _js_or(header.scl_inter, 0.0))
    geometry = geometry_from_header(header)

    needed = geometry.dims[0] * geometry.dims[1] * geometry.dims[2]
    if data.size >= needed:
        sample = data[:needed]
    else:
        sample = np.zeros(needed, dtype=data.dtype)
        if data.size:
            sample[: data.size] = data
    return Volume(header=header, data=data, sample=sample, geometry=geometry, window=window, path=str(p))


def load_volume(path: str | Path, use_cache: bool = True) -> Volume:
    """Cached by path + mtime + size, two entries deep, as the web renderer is."""
    p = Path(path)
    try:
        st = p.stat()
        key = f"{p}::{st.st_mtime_ns / 1_000_000}::{st.st_size}"
    except OSError as exc:
        raise NiftiError(f"NIfTI file could not be read: {exc}") from exc
    if not use_cache:
        return decode_volume(p)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached
    volume = decode_volume(p)
    with _cache_lock:
        _cache[key] = volume
        while len(_cache) > VOLUME_CACHE_MAX:
            _cache.popitem(last=False)
    return volume


def render_nifti(
    path: str | Path,
    frame_index: int,
    plane: str | None = None,
    max_edge: int | None = None,
    use_cache: bool = True,
) -> GrayImage:
    """image-render.ts:401-424.

    ``frame_index`` is the slice number along the requested plane's axis.  With
    no plane the volume's acquired plane is used, which reproduces the
    axial-only behaviour of any un-migrated image reference.
    """
    volume = load_volume(path, use_cache=use_cache)
    geo = volume.geometry
    requested = plane if is_mpr_plane(plane) else geo.acquired_plane
    p = geo.planes[requested]
    if p.slice_count < 1:
        raise NiftiError(
            f"This volume has no {requested.lower()} extent, so that plane cannot be reconstructed"
        )
    return reslice_to_gray(
        volume.sample,
        geo.dims,
        p,
        frame_index,
        volume.slope,
        volume.inter,
        window=volume.window,
        max_edge=max_edge,
    )


def read_nifti_geometry(path: str | Path) -> VolumeGeometry | None:
    """image-render.ts:368-376 - any failure yields None, never a raise."""
    try:
        return load_volume(path).geometry
    except Exception:
        return None


def read_nifti_summary(path: str | Path) -> dict | None:
    """image-render.ts:378-393."""
    geo = read_nifti_geometry(path)
    if geo is None:
        return None
    return {
        "dims": list(geo.dims),
        "sliceCounts": {
            "Axial": geo.planes["Axial"].slice_count,
            "Sagittal": geo.planes["Sagittal"].slice_count,
            "Coronal": geo.planes["Coronal"].slice_count,
            "AP": 0,
            "PA": 0,
            "Lateral": 0,
            "Unknown": 0,
        },
    }


def read_header_only(path: str | Path) -> NiftiHeader:
    """Parse the header without inflating the whole volume.

    Not something the web renderer does - it always decodes - but the bytes are
    the same bytes, so the parsed header is identical.  Used when building the
    index, where inflating seven gigabytes of MRI to read 348-byte headers
    would dominate the build.
    """
    p = Path(path)
    with open(p, "rb") as fh:
        head = fh.read(1 << 16)
    if is_compressed(head):
        obj = zlib.decompressobj(47)
        out = obj.decompress(head, NIFTI2_HEADER_SIZE + 8)
        if len(out) < NIFTI2_HEADER_SIZE + 8:
            with open(p, "rb") as fh:
                out = decompress(fh.read())
        head = out
    return read_header(head)






