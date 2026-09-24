"""Pure-Python DICOM reading.

This is a deliberate, line-by-line port of the DICOM half of
``lib/dataset/image-render.ts`` (``renderDicom``, ``readDicomSummary``,
``decodeInstanceInto``).  The web renderer must not be touched, so parity is
maintained here instead: the same tags, the same defaults, the same three
stored-to-real branches, and the same windowing arithmetic - including the
places where the arithmetic is quirky.

Only native (uncompressed) transfer syntaxes are decodable, which is what the
indexed corpus contains.  ``pydicom`` is not required; if it happens to be
importable it is still not used, so the packaged application has one code path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .gray import GrayImage, js_round, to_uint8

IMPLICIT_VR_LE = "1.2.840.10008.1.2"
EXPLICIT_VR_LE = "1.2.840.10008.1.2.1"
#: image-render.ts:1215 - anything else is treated as unreadable rather than
#: decoded as noise.
READABLE_TRANSFER_SYNTAXES = frozenset({IMPLICIT_VR_LE, EXPLICIT_VR_LE})


def tag(group: int, element: int) -> int:
    return (group << 16) | element


T_TRANSFER_SYNTAX = tag(0x0002, 0x0010)
T_SOP_INSTANCE_UID = tag(0x0008, 0x0018)
T_STUDY_DATE = tag(0x0008, 0x0020)
T_MODALITY = tag(0x0008, 0x0060)
T_ACCESSION = tag(0x0008, 0x0050)
T_SERIES_DESCRIPTION = tag(0x0008, 0x103E)
T_PATIENT_AGE = tag(0x0010, 0x1010)
T_PATIENT_SEX = tag(0x0010, 0x0040)
T_BODY_PART = tag(0x0018, 0x0015)
T_SLICE_THICKNESS = tag(0x0018, 0x0050)
T_SPACING_BETWEEN_SLICES = tag(0x0018, 0x0088)
T_VIEW_POSITION = tag(0x0018, 0x5101)
T_STUDY_INSTANCE_UID = tag(0x0020, 0x000D)
T_SERIES_INSTANCE_UID = tag(0x0020, 0x000E)
T_INSTANCE_NUMBER = tag(0x0020, 0x0013)
T_IMAGE_POSITION = tag(0x0020, 0x0032)
T_IMAGE_ORIENTATION = tag(0x0020, 0x0037)
T_SLICE_LOCATION = tag(0x0020, 0x1041)
T_SAMPLES_PER_PIXEL = tag(0x0028, 0x0002)
T_PHOTOMETRIC = tag(0x0028, 0x0004)
T_ROWS = tag(0x0028, 0x0010)
T_COLUMNS = tag(0x0028, 0x0011)
T_PIXEL_SPACING = tag(0x0028, 0x0030)
T_BITS_ALLOCATED = tag(0x0028, 0x0100)
T_PIXEL_REPRESENTATION = tag(0x0028, 0x0103)
T_WINDOW_CENTER = tag(0x0028, 0x1050)
T_WINDOW_WIDTH = tag(0x0028, 0x1051)
T_RESCALE_INTERCEPT = tag(0x0028, 0x1052)
T_RESCALE_SLOPE = tag(0x0028, 0x1053)
T_PIXEL_DATA = tag(0x7FE0, 0x0010)

_ITEM = tag(0xFFFE, 0xE000)
_ITEM_DELIM = tag(0xFFFE, 0xE00D)
_SEQ_DELIM = tag(0xFFFE, 0xE0DD)

_LONG_VRS = frozenset({"OB", "OW", "OF", "OD", "OL", "SQ", "UT", "UN", "UC", "UR"})
_VR_PATTERN = re.compile(rb"^[A-Z][A-Z]$")
_UNDEFINED = 0xFFFFFFFF

_JS_FLOAT = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_JS_INT = re.compile(r"^[+-]?\d+")


class DicomError(Exception):
    """Raised only for genuinely unusable files; callers surface it as text."""


def _js_parse_float(text: str | None) -> float | None:
    """JavaScript ``parseFloat`` - leading numeric prefix, else undefined."""
    if text is None:
        return None
    m = _JS_FLOAT.match(text.strip())
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _js_parse_int(text: str | None) -> int | None:
    if text is None:
        return None
    m = _JS_INT.match(text.strip())
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def _js_number(text: str) -> float:
    """JavaScript ``Number(x)``: blank is 0, anything unparseable is NaN."""
    stripped = text.strip()
    if stripped == "":
        return 0.0
    try:
        return float(stripped)
    except ValueError:
        return float("nan")


@dataclass(frozen=True)
class Element:
    __slots__ = ("vr", "offset", "length")
    vr: str
    offset: int
    length: int


class DataSet:
    """Parsed top-level elements plus the original buffer.

    Mirrors the accessors of ``dicom-parser``'s dataSet, including the detail
    that a multi-valued ``WindowCenter`` such as ``"40\\400"`` yields only the
    first component (dicomParser.js:1561-1575).
    """

    __slots__ = ("buf", "elements", "transfer_syntax", "path")

    def __init__(self, buf: bytes, elements: dict[int, Element], transfer_syntax: str | None, path: str = ""):
        self.buf = buf
        self.elements = elements
        self.transfer_syntax = transfer_syntax
        self.path = path

    def has(self, key: int) -> bool:
        return key in self.elements

    def raw(self, key: int) -> bytes | None:
        el = self.elements.get(key)
        if el is None or el.length <= 0:
            return None
        return self.buf[el.offset : el.offset + el.length]

    def uint16(self, key: int) -> int | None:
        raw = self.raw(key)
        if raw is None or len(raw) < 2:
            return None
        return int.from_bytes(raw[:2], "little", signed=False)

    def string(self, key: int, index: int | None = None) -> str | None:
        raw = self.raw(key)
        if raw is None:
            return None
        text = raw.decode("latin-1").rstrip("\x00")
        if index is None:
            return text.strip()
        parts = text.split("\\")
        if index >= len(parts):
            return None
        return parts[index].strip()

    def float_string(self, key: int, index: int = 0) -> float | None:
        return _js_parse_float(self.string(key, index))

    def int_string(self, key: int, index: int = 0) -> int | None:
        return _js_parse_int(self.string(key, index))


def _u16(buf: bytes, at: int) -> int:
    return int.from_bytes(buf[at : at + 2], "little", signed=False)


def _u32(buf: bytes, at: int) -> int:
    return int.from_bytes(buf[at : at + 4], "little", signed=False)


def _looks_explicit(buf: bytes, at: int) -> bool:
    return len(buf) >= at + 6 and bool(_VR_PATTERN.match(buf[at + 4 : at + 6]))


def _read_header(buf: bytes, at: int, explicit: bool) -> tuple[int, str, int, int]:
    """Return ``(tag, vr, length, data_offset)`` for one element."""
    key = tag(_u16(buf, at), _u16(buf, at + 2))
    if key in (_ITEM, _ITEM_DELIM, _SEQ_DELIM):
        return key, "", _u32(buf, at + 4), at + 8
    if explicit:
        vr = buf[at + 4 : at + 6].decode("ascii", "replace")
        if vr in _LONG_VRS:
            return key, vr, _u32(buf, at + 8), at + 12
        return key, vr, _u16(buf, at + 6), at + 8
    return key, "", _u32(buf, at + 4), at + 8


def _skip_undefined(buf: bytes, at: int, explicit: bool, expect: int) -> int:
    """Walk past an undefined-length sequence or item, honouring nesting.

    An undefined-length sequence ends at (FFFE,E0DD); an undefined-length item
    ends at (FFFE,E00D).  Both can nest, so the expected delimiters are kept on
    a stack rather than counted.
    """
    stack = [expect]
    while at + 8 <= len(buf) and stack:
        key, vr, length, data = _read_header(buf, at, explicit)
        if key in (_ITEM_DELIM, _SEQ_DELIM):
            at = data + (length if length != _UNDEFINED else 0)
            if key == stack[-1]:
                stack.pop()
            continue
        if length == _UNDEFINED:
            stack.append(_ITEM_DELIM if key == _ITEM else _SEQ_DELIM)
            at = data
            continue
        at = data + length
    return at


def parse(buf: bytes, path: str = "", stop_after_pixel_data: bool = True) -> DataSet:
    """Parse the top-level elements of a DICOM instance.

    Files in this corpus include Perle CT instances with no ``.dcm`` extension
    and, in some collections, no 128-byte preamble - so the magic word is
    probed first and the VR encoding is sniffed if the meta group is absent.
    """
    transfer_syntax: str | None = None
    at = 0
    if len(buf) > 132 and buf[128:132] == b"DICM":
        at = 132
        while at + 8 <= len(buf) and _u16(buf, at) == 0x0002:
            key, vr, length, data = _read_header(buf, at, True)
            if length == _UNDEFINED:
                at = _skip_undefined(buf, data, True, _SEQ_DELIM)
                continue
            if key == T_TRANSFER_SYNTAX:
                transfer_syntax = buf[data : data + length].decode("latin-1").rstrip("\x00 ").strip()
            at = data + length
    elif buf[:4] == b"DICM":
        at = 4

    explicit = transfer_syntax != IMPLICIT_VR_LE if transfer_syntax else _looks_explicit(buf, at)
    elements: dict[int, Element] = {}
    total = len(buf)
    while at + 8 <= total:
        key, vr, length, data = _read_header(buf, at, explicit)
        if key == T_PIXEL_DATA:
            elements[key] = Element(vr, data, length if length != _UNDEFINED else total - data)
            if stop_after_pixel_data:
                break
            at = data + (length if length != _UNDEFINED else total - data)
            continue
        if length == _UNDEFINED:
            elements.setdefault(key, Element(vr or "SQ", data, 0))
            at = _skip_undefined(buf, data, explicit, _ITEM_DELIM if key == _ITEM else _SEQ_DELIM)
            continue
        if vr == "SQ":
            elements.setdefault(key, Element(vr, data, length))
            at = data + length
            continue
        if key not in elements:
            elements[key] = Element(vr, data, length)
        at = data + length
    if not elements:
        raise DicomError("not a DICOM file")
    return DataSet(buf, elements, transfer_syntax, path)


def read_file(path: str | Path, stop_after_pixel_data: bool = True) -> DataSet:
    p = Path(path)
    with open(p, "rb") as fh:
        buf = fh.read()
    return parse(buf, str(p), stop_after_pixel_data)


def read_header_only(path: str | Path, window: int = 65536) -> DataSet:
    """Parse just enough of the file for the metadata accessors.

    Used at index/verification time.  A short read is legal here because every
    tag ``read_dicom_summary`` needs precedes (7FE0,0010).
    """
    p = Path(path)
    with open(p, "rb") as fh:
        buf = fh.read(window)
    return parse(buf, str(p), True)


def render_dicom(source: str | Path | DataSet) -> GrayImage:
    """image-render.ts:235-314.  Single instance, no transfer-syntax check.

    The absence of that check is faithful: the web path renders a compressed
    instance as noise rather than refusing it.  The stack decoder (stack.py)
    does check, and rejects.
    """
    ds = source if isinstance(source, DataSet) else read_file(source)
    rows = ds.uint16(T_ROWS) or 0
    columns = ds.uint16(T_COLUMNS) or 0
    bits_allocated = ds.uint16(T_BITS_ALLOCATED)
    bits_allocated = 16 if bits_allocated is None else bits_allocated
    pixel_representation = ds.uint16(T_PIXEL_REPRESENTATION)
    pixel_representation = 0 if pixel_representation is None else pixel_representation
    samples_per_pixel = ds.uint16(T_SAMPLES_PER_PIXEL)
    samples_per_pixel = 1 if samples_per_pixel is None else samples_per_pixel
    photometric = ds.string(T_PHOTOMETRIC) or "MONOCHROME2"
    slope = ds.float_string(T_RESCALE_SLOPE)
    slope = 1.0 if slope is None else slope
    inter = ds.float_string(T_RESCALE_INTERCEPT)
    inter = 0.0 if inter is None else inter
    window_center = ds.float_string(T_WINDOW_CENTER)
    window_width = ds.float_string(T_WINDOW_WIDTH)

    pixel = ds.elements.get(T_PIXEL_DATA)
    if not rows or not columns or pixel is None:
        raise DicomError("DICOM file has no usable pixel data")

    pixel_count = rows * columns * samples_per_pixel
    buf = ds.buf
    if samples_per_pixel >= 3:
        # RGB/YBR: 1 byte per sample regardless of BitsAllocated, interleaved,
        # no rescale, BT.601 luma - exactly as the web renderer assumes.
        need = pixel_count
        chunk = np.frombuffer(buf, dtype=np.uint8, count=min(need, len(buf) - pixel.offset), offset=pixel.offset)
        if chunk.size < rows * columns * 3:
            raise DicomError("DICOM colour pixel data is truncated")
        rgb = chunk[: rows * columns * 3].astype(np.float64).reshape(rows * columns, 3)
        raw = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
        if window_center is None:
            window_center = 128.0
        if window_width is None:
            window_width = 256.0
    elif bits_allocated == 8:
        chunk = np.frombuffer(buf, dtype=np.uint8, count=min(pixel_count, len(buf) - pixel.offset), offset=pixel.offset)
        if chunk.size < pixel_count:
            raise DicomError("DICOM pixel data is truncated")
        raw = chunk.astype(np.float64) * slope + inter
    else:
        dtype = np.dtype("<i2") if pixel_representation == 1 else np.dtype("<u2")
        avail = (len(buf) - pixel.offset) // 2
        chunk = np.frombuffer(buf, dtype=dtype, count=min(pixel_count, avail), offset=pixel.offset)
        if chunk.size < pixel_count:
            raise DicomError("DICOM pixel data is truncated")
        raw = chunk.astype(np.float64) * slope + inter

    return _window_to_gray(raw, rows, columns, window_center, window_width, photometric)


def _window_to_gray(
    raw: np.ndarray,
    rows: int,
    columns: int,
    window_center: float | None,
    window_width: float | None,
    photometric: str,
) -> GrayImage:
    """image-render.ts:284-313, including the quirks worth reproducing.

    * The fallback is this image's own min/max over the post-rescale values -
      never a modality preset.
    * A present-but-unparseable WindowWidth stays NaN (``NaN <= 0`` is false in
      JavaScript, so the fallback does not fire) and the frame comes out black.
    * Clamping happens *before* MONOCHROME1 inversion.
    """
    need_fallback = window_center is None or window_width is None
    if not need_fallback:
        width_value = float(window_width)
        if width_value != width_value:
            need_fallback = False  # NaN: JS "NaN <= 0" is false, so the frame goes black.
        elif not (width_value > 0):
            need_fallback = True
    if need_fallback:
        finite = raw[np.isfinite(raw)]
        if finite.size:
            lo_v = float(finite.min())
            hi_v = float(finite.max())
        else:
            lo_v, hi_v = 0.0, 0.0
        window_center = (lo_v + hi_v) / 2.0
        window_width = max(1.0, hi_v - lo_v)
    lo = float(window_center) - float(window_width) / 2.0
    scale = 255.0 / float(window_width)
    values = js_round((raw[: rows * columns] - lo) * scale)
    values = np.clip(values, 0.0, 255.0)
    if photometric == "MONOCHROME1":
        values = 255.0 - values
    return GrayImage(to_uint8(values).reshape(rows, columns))


def parse_decimal_string(raw: str | None, count: int) -> list[float] | None:
    """image-render.ts:930-937 - all or nothing, ``Number()`` semantics."""
    if not raw:
        return None
    parts = [_js_number(p) for p in raw.split("\\")]
    if len(parts) < count:
        return None
    out = parts[:count]
    if any(v != v or v in (float("inf"), float("-inf")) for v in out):
        return None
    return out


def orientation_from_view_position(value: str | None) -> str | None:
    """image-render.ts:226-233 - substring match, AP checked before PA."""
    if not value:
        return None
    upper = value.upper()
    if "AP" in upper:
        return "AP"
    if "PA" in upper:
        return "PA"
    if "LAT" in upper:
        return "Lateral"
    return None


_AGE = re.compile(r"^(\d{3})([YMWD])$")


def patient_age_years(value: str | None) -> int | None:
    """image-render.ts:217-224 - weeks and days are dropped, months rounded."""
    if not value:
        return None
    m = _AGE.match(value.strip())
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2)
    if unit == "Y":
        return n
    if unit == "M":
        return int(np.floor(n / 12 + 0.5))
    return None


@dataclass
class DicomSummary:
    """The header-only view used for ordering, grouping and verification."""

    rows: int | None = None
    columns: int | None = None
    orientation: str | None = None
    patient_age: int | None = None
    patient_sex: str | None = None
    pixel_spacing: list[float] | None = None
    image_position_patient: list[float] | None = None
    image_orientation_patient: list[float] | None = None
    series_instance_uid: str | None = None
    sop_instance_uid: str | None = None
    study_instance_uid: str | None = None
    accession_number: str | None = None
    instance_number: int | None = None
    slice_location: float | None = None
    window_center: float | None = None
    window_width: float | None = None
    modality: str | None = None
    body_part: str | None = None
    series_description: str | None = None
    study_date: str | None = None
    slice_thickness: float | None = None
    spacing_between_slices: float | None = None
    transfer_syntax: str | None = None
    bits_allocated: int | None = None
    samples_per_pixel: int | None = None
    photometric: str | None = None


def read_dicom_summary(path: str | Path, buf: bytes | None = None) -> DicomSummary | None:
    """image-render.ts:171-215 - any parse failure yields None for the whole file."""
    try:
        ds = parse(buf, str(path), True) if buf is not None else read_header_only(path)
        spacing_raw = ds.string(T_PIXEL_SPACING)
        pixel_spacing: list[float] | None = None
        if spacing_raw:
            parts = [_js_number(p) for p in spacing_raw.split("\\")][:2]
            kept = [v for v in parts if v == v]
            if len(kept) == 2:
                pixel_spacing = kept
        return DicomSummary(
            rows=ds.uint16(T_ROWS),
            columns=ds.uint16(T_COLUMNS),
            orientation=orientation_from_view_position(ds.string(T_VIEW_POSITION)),
            patient_age=patient_age_years(ds.string(T_PATIENT_AGE)),
            patient_sex=ds.string(T_PATIENT_SEX),
            pixel_spacing=pixel_spacing,
            image_position_patient=parse_decimal_string(ds.string(T_IMAGE_POSITION), 3),
            image_orientation_patient=parse_decimal_string(ds.string(T_IMAGE_ORIENTATION), 6),
            series_instance_uid=ds.string(T_SERIES_INSTANCE_UID),
            sop_instance_uid=ds.string(T_SOP_INSTANCE_UID),
            study_instance_uid=ds.string(T_STUDY_INSTANCE_UID),
            accession_number=ds.string(T_ACCESSION),
            instance_number=ds.int_string(T_INSTANCE_NUMBER),
            slice_location=ds.float_string(T_SLICE_LOCATION),
            window_center=ds.float_string(T_WINDOW_CENTER),
            window_width=ds.float_string(T_WINDOW_WIDTH),
            modality=ds.string(T_MODALITY),
            body_part=ds.string(T_BODY_PART),
            series_description=ds.string(T_SERIES_DESCRIPTION),
            study_date=ds.string(T_STUDY_DATE),
            slice_thickness=ds.float_string(T_SLICE_THICKNESS),
            spacing_between_slices=ds.float_string(T_SPACING_BETWEEN_SLICES),
            transfer_syntax=ds.transfer_syntax,
            bits_allocated=ds.uint16(T_BITS_ALLOCATED),
            samples_per_pixel=ds.uint16(T_SAMPLES_PER_PIXEL),
            photometric=ds.string(T_PHOTOMETRIC),
        )
    except Exception:
        return None
