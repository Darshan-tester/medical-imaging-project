"""Index row to pixels: the desktop's replacement for the image API route.

On the web a frame arrives over HTTP - the route looks the series up, turns the
stored reference into an absolute path, calls ``renderImageCached``, and streams
what comes back.  All three steps still happen here, in that order, but in this
process: §19 rules out the loopback server that would otherwise sit between the
viewer and the decoder.

Two things differ from the web route, both deliberately:

* **The path.**  The index records every pixel source relative to ``dataset/``,
  so each one goes through ``app_paths.resolve_data``, which joins it under the
  delivered dataset folder and refuses anything that tries to leave (§20).  That
  indirection is why no developer-specific path exists anywhere in the delivery.
* **The failure.**  Nothing here raises for a bad frame.  Every outcome is a
  ``FrameLoad`` carrying either pixels or one of ``core.messages``' sentences,
  because a viewer that throws on slice 812 of 1,834 is a viewer that vanishes
  from the CEO's desk (§26).  The full reason goes to the log; the user gets one
  line and a working application.

The frame cache is ``render_image_cached``'s, not a second one of this module's:
one budget for the whole application (§16).  What this module owns is the *key*,
and the key folds in the index build id - rebuild the index and every key
changes, so cached pixels from a previous build can never be shown for a file
the new indexer resolved differently.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from . import messages as msg
from .db import ImageRow, Index, SeriesRow, StudyDetail, VolumeRow
from .imaging.dicom import DicomError
from .imaging.nifti import NiftiError
from .imaging.render import (
    DICOM,
    DICOM_VOLUME,
    NIFTI,
    RASTER,
    ImageRef,
    RenderedFrame,
    RenderError,
    render_cache_get,
    render_image,
    render_image_cached,
)
from .imaging.stack import DicomVolumeRef, StackError
from .log import log

try:  # in the packaged application
    from app_paths import DATA_ROOT, resolve_data
except ImportError:  # when core/ is imported from a checkout
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app_paths import DATA_ROOT, resolve_data

#: The kinds ``render_image`` can dispatch.  Checked before rendering so an
#: unknown one becomes a sentence rather than ``RenderError("Unsupported image
#: kind: ''")`` shown to a doctor.
KINDS = (RASTER, DICOM, NIFTI, DICOM_VOLUME)


@dataclass(frozen=True)
class FrameLoad:
    """What came back from asking for one frame: pixels, or the reason there are
    none.

    ``ok`` is the only thing a caller has to test.  On failure ``title`` is one of
    the fixed strings from §26 and ``detail`` is the sentence underneath it, so a
    widget can render any failure without knowing what went wrong.  ``elapsed_ms``
    is measured on every load, cache hits included, which is where the decode
    figures in the performance notes come from rather than from an estimate.
    """

    frame: RenderedFrame | None = None
    title: str = ""
    detail: str = ""
    #: The index row this came from, so the viewer can label the frame it is
    #: showing even when the render failed.
    image: ImageRow | None = None
    key: str = ""
    elapsed_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return self.frame is not None

    @property
    def message(self) -> str:
        """Title and detail as one line, for a status bar or a log."""
        return f"{self.title} {self.detail}".strip()


def _failed(title: str, detail: str, image: ImageRow | None, started: float) -> FrameLoad:
    return FrameLoad(
        title=title, detail=detail, image=image,
        elapsed_ms=(time.perf_counter() - started) * 1000.0,
    )


def build_id(index: Index) -> str:
    """A short digest of which index build this is.

    Every cache key starts with it.  The four fields are the ones that change
    when the pixels behind an id could change: the schema, the builder, the
    manifest it was built from, and when.  A rebuild from an identical manifest
    still moves ``built_at``, so the cache is dropped then too - cheap, and it
    means "rebuild the index" is always advice that actually takes effect.
    """
    meta = index.meta()
    seed = "|".join(str(meta.get(k, "")) for k in (
        "schema_version", "builder_version", "manifest_sha256", "built_at"))
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


def _blamed(exc: OSError, image: ImageRow) -> str:
    """Which file the OS actually objected to, named the way the index names it.

    For a reconstructed series the failing file is usually not ``image.path`` -
    that is the run's representative instance, while the read that failed could be
    any of the 558 slices - so the OS's own ``filename`` is preferred when it has
    one.  It is reported relative to ``dataset/`` because a log or a dialog the
    user forwards should identify the file in the delivery without also carrying
    the folder layout of their machine.
    """
    named = getattr(exc, "filename", None)
    if not named:
        return image.path
    try:
        return Path(str(named)).resolve().relative_to(DATA_ROOT).as_posix()
    except (ValueError, OSError):
        return str(named)


def _absent_slices(volume: DicomVolumeRef, cap: int = 4096) -> list[str]:
    """Which of a volume's slice files are not on disk, named relative to
    ``dataset/``.

    The stack loader cannot tell a missing instance from an unreadable one: it
    rejects any slice it cannot decode and reports one generic reason, which is
    the web renderer's behaviour and stays that way so the pixels keep matching.
    That reason - inconsistent instances, or an unsupported transfer syntax -
    sends someone after the wrong problem when the truth is that the files were
    never copied.  So on the failure path only, and never during a successful
    render, the files are checked and the missing ones named.

    ``cap`` bounds the work at a number no real series reaches; the largest
    volume in this dataset is 558 slices.
    """
    root = DATA_ROOT
    absent: list[str] = []
    for path in volume.files[:cap]:
        p = Path(path)
        try:
            if p.exists():
                continue
        except OSError:
            pass
        try:
            absent.append(p.resolve().relative_to(root).as_posix())
        except (ValueError, OSError):
            absent.append(path)
    return absent



class Loader:
    """Frames for the open study, callable from any thread.

    The viewer, the prefetch workers and the thumbnail strip all come through one
    instance.  It holds the index, the build id and the detail of the study
    currently open - one study, because that is how many the viewer shows, and
    re-reading the row per frame would spend most of a frame's budget on data
    that has not changed.

    The volume descriptors are memoised beside it for a sharper reason: a
    reconstructed CT series names 558 slice files, every one of which has to be
    joined under ``dataset/`` and containment-checked, and doing that per frame
    would cost more than the decode it precedes.  Single paths are memoised for
    the same reason - a compact run is one file shared by all of its frames, so
    the alternative is resolving the same string 1,834 times.  All three memos
    are dropped by ``forget()``.
    """

    def __init__(self, index: Index) -> None:
        self._index = index
        self._lock = threading.RLock()
        self._detail: StudyDetail | None = None
        self._volumes: dict[str, DicomVolumeRef] = {}
        #: Relative path -> resolved absolute path, or None for one
        #: ``resolve_data`` refused.  Rejections are remembered too: the answer
        #: is a pure function of the path and the dataset root, and a damaged
        #: index can name a rejected path in a run of 1,834 frames.
        self._paths: dict[str, str | None] = {}
        #: Read once.  If the index cannot answer this, the application has a
        #: setup problem to report at startup, not one to re-check per frame.
        self.build_id = build_id(index)

    @property
    def index(self) -> Index:
        return self._index

    def forget(self) -> None:
        """Drop the memoised study, its volume refs and its resolved paths.

        Called when the viewer closes a study and when the index is replaced.
        The frame cache is not touched: its keys carry the build id, so entries
        for a superseded index can never match and will age out on their own.
        """
        with self._lock:
            self._detail = None
            self._volumes.clear()
            self._paths.clear()

    def detail(self, study_id: str) -> StudyDetail | None:
        """The open study, read from the index at most once per study."""
        with self._lock:
            if self._detail is not None and self._detail.study.id == study_id:
                return self._detail
        # Queried outside the lock: it is a read of its own, and holding this
        # lock across it would stall every prefetch worker behind it.
        found = self._index.study(study_id)
        if found is None:
            log.warning("study not in index: %s", study_id)
            return None
        with self._lock:
            self._detail = found
            # Dropped to bound memory, not for correctness: a resolved path
            # depends only on the string and the dataset root, neither of which
            # a study switch changes.
            self._volumes.clear()
            self._paths.clear()
        return found

    # ------------------------------------------------------------- references
    def resolve(self, relative: str) -> str:
        """``app_paths.resolve_data`` with its answer remembered.

        Worth remembering because the containment check has to resolve the
        candidate for real - a recorded ``..`` or a symlink is the thing being
        guarded against - and ``Path.resolve()`` is a syscall per component,
        which on a network share or a virtual filesystem measured ~27 ms.

        Raises ``ValueError`` exactly as ``resolve_data`` does, including for a
        path already known to have been refused.
        """
        with self._lock:
            hit = self._paths.get(relative, "")
        if hit is None:
            raise ValueError(f"data path escapes the dataset folder: {relative}")
        if hit != "":
            return hit
        try:
            resolved = str(resolve_data(relative))
        except ValueError:
            with self._lock:
                self._paths[relative] = None
            raise
        with self._lock:
            self._paths[relative] = resolved
        return resolved

    def image_ref(self, image: ImageRow) -> ImageRef:
        """An index row as a render reference, its path joined under ``dataset/``.

        Built field by field rather than through ``ImageRef.from_image``, which
        takes raw manifest JSON: the index has already normalised these values, so
        re-wrapping them in a dict to parse them back out would be the only place
        in the desktop build where a manifest shape is invented rather than read.

        Raises ``ValueError`` if the recorded path is not inside the dataset
        folder; callers turn that into ``IMAGE_PATH_REJECTED``.
        """
        return ImageRef(
            kind=image.kind,
            abs_path=self.resolve(image.path),
            index=image.index,
            id=image.id or "",
            frame_index=image.frame_index,
            orientation=image.orientation,
            width=image.width,
            height=image.height,
        )

    def volume_ref(self, volume: VolumeRow) -> DicomVolumeRef:
        """A volume descriptor with every slice path resolved, memoised.

        Slice order is the index's order, which is the order the indexer measured
        along the volume normal.  It is passed through untouched: a reslice built
        from a re-sorted stack is a picture of nothing.

        Memoised per study *and* volume id rather than by volume id alone.  Ids
        are content-derived, so the shorter key would be safe in practice, but
        ``load_frame`` accepts a study detail from its caller and this way a
        caller that switches studies without going through ``detail()`` still
        cannot be served another study's paths.
        """
        cache_key = f"{volume.study_id}/{volume.volume_id}"
        with self._lock:
            hit = self._volumes.get(cache_key)
        if hit is not None:
            return hit
        iop = tuple(float(v) for v in volume.iop[:6])
        if len(iop) < 6:
            # Mirrors DicomVolumeRef.from_manifest: an absent orientation is the
            # identity, not zeros, which would make every direction degenerate.
            iop = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0) if not iop else iop + (0.0,) * (6 - len(iop))
        ref = DicomVolumeRef(
            files=tuple(self.resolve(f) for f in volume.files),
            rows=volume.rows,
            columns=volume.columns,
            pixel_spacing=(volume.spacing_row, volume.spacing_col),
            iop=iop,  # type: ignore[arg-type]
            slice_delta=volume.slice_delta,
            spacing_from_positions=volume.spacing_from_positions,
        )
        with self._lock:
            self._volumes[cache_key] = ref
        return ref

    def cache_key(self, series: SeriesRow, image: ImageRow, max_edge: int | None) -> str:
        """The frame cache key, which is where staleness is designed out.

        The build id comes first, so a rebuilt index shares no keys with the one
        before it.  The plane is in the key because a volume frame at index 40 is
        a different picture in each of the three planes, and ``max_edge`` because a
        128-pixel thumbnail must never be served as the full frame.
        """
        return "|".join((
            self.build_id,
            image.id or f"{series.id}-{image.index}",
            str(image.frame_index if image.frame_index is not None else image.index),
            image.orientation or "-",
            str(int(max_edge) if max_edge else 0),
        ))

    # ------------------------------------------------------------------ frames
    def peek(
        self,
        series: SeriesRow,
        index: int,
        max_edge: int | None = None,
    ) -> FrameLoad | None:
        """The frame if it is already in the cache, or None - never a decode.

        Everything this needs is in the index row: the key is a string join, and
        ``series.frame`` reads memory.  So a caller on the UI thread can ask "can
        I paint this right now?" for the cost of a dict lookup, and only fall back
        to a worker when the answer is no.

        Deliberately not implemented as ``load_frame`` with a flag.  A flag would
        mean the fast path and the decode path share a signature, and the one
        thing that must never happen on the UI thread is a decode reached by
        passing the wrong argument.
        """
        image = series.frame(index)
        if image is None or image.kind not in KINDS:
            return None
        started = time.perf_counter()
        key = self.cache_key(series, image, max_edge)
        frame = render_cache_get(key)
        if frame is None:
            return None
        return FrameLoad(frame=frame, image=image, key=key,
                         elapsed_ms=(time.perf_counter() - started) * 1000.0)

    def load_frame(
        self,
        detail: StudyDetail,
        series: SeriesRow,
        index: int,
        max_edge: int | None = None,
        use_cache: bool = True,
    ) -> FrameLoad:
        """Frame ``index`` of ``series``, or a ``FrameLoad`` saying why not.

        The failure branches are in the order the failures can happen, and each
        one is answered before the render rather than after it, so the exception
        handlers below stay for genuinely unexpected things.  ``use_cache=False``
        exists for a one-off read - an export, a measurement - that should not
        push a scrolled series out of the cache.

        The cache is consulted before any path is resolved.  That ordering is the
        difference between a hit costing microseconds and a hit costing more than
        20 ms: everything between here and ``render_image_cached`` exists only to
        build arguments the cache does not need, and the key is computable from
        the index row alone.
        """
        started = time.perf_counter()
        image = series.frame(index)
        if image is None:
            return _failed(msg.IMAGE_UNAVAILABLE, msg.IMAGE_NO_FRAME, None, started)
        if image.kind not in KINDS:
            log.error("series %s frame %d: unknown kind %r", series.id, index, image.kind)
            return _failed(msg.IMAGE_UNAVAILABLE, msg.IMAGE_DECODE_FAILED, image, started)

        key = self.cache_key(series, image, max_edge)
        if use_cache:
            hit = render_cache_get(key)
            if hit is not None:
                return FrameLoad(frame=hit, image=image, key=key,
                                 elapsed_ms=(time.perf_counter() - started) * 1000.0)

        volume: DicomVolumeRef | None = None
        try:
            if image.kind == DICOM_VOLUME:
                row = detail.volume_for(series)
                if row is None or row.count == 0:
                    log.error("series %s names volume %r, which the index does not hold",
                              series.id, series.volume_id)
                    return _failed(msg.IMAGE_UNAVAILABLE, msg.SERIES_NO_VOLUME, image, started)
                volume = self.volume_ref(row)
            ref = self.image_ref(image)
        except ValueError as exc:
            # resolve_data refused a recorded path: the index was built against a
            # different folder than the one delivered.  Worth naming (§20, §30).
            log.error("rejected path in series %s frame %d: %s", series.id, index, exc)
            return _failed(msg.IMAGE_UNAVAILABLE,
                           msg.IMAGE_PATH_REJECTED.format(path=image.path), image, started)

        try:
            if use_cache:
                frame = render_image_cached(key, ref, volume, max_edge)
            else:
                frame = render_image(ref, volume, max_edge)
        except FileNotFoundError as exc:
            log.error("missing file for series %s frame %d: %s",
                      series.id, index, _blamed(exc, image))
            return _failed(msg.IMAGE_UNAVAILABLE,
                           msg.IMAGE_FILE_MISSING.format(path=_blamed(exc, image)),
                           image, started)
        except (DicomError, NiftiError, StackError, RenderError) as exc:
            # These readers write their messages for the UI to show, so the
            # message is passed through rather than replaced with a generic one -
            # except for a volume, where the generic reason can be checked and
            # improved on.
            if volume is not None:
                absent = _absent_slices(volume)
                if absent:
                    log.error("series %s: %d of %d slice files missing, first %s",
                              series.id, len(absent), volume.count, absent[:3])
                    return _failed(msg.IMAGE_UNAVAILABLE, msg.VOLUME_SLICES_MISSING.format(
                        missing=len(absent), total=volume.count,
                        first=", ".join(absent[:3]),
                    ), image, started)
            log.warning("series %s frame %d: %s", series.id, index, exc)
            return _failed(msg.IMAGE_UNAVAILABLE, str(exc) or msg.IMAGE_DECODE_FAILED,
                           image, started)
        except OSError as exc:
            log.error("unreadable file for series %s frame %d: %s (%s)",
                      series.id, index, _blamed(exc, image), exc.strerror or exc)
            return _failed(msg.IMAGE_UNAVAILABLE, msg.IMAGE_FILE_UNREADABLE.format(
                path=_blamed(exc, image), reason=exc.strerror or type(exc).__name__,
            ), image, started)
        except Exception:  # noqa: BLE001 - §26: never crash on one bad frame
            # A shape no reader anticipated.  The traceback goes to the log in
            # full; the viewer shows the same sentence as any other bad slice and
            # the rest of the study stays usable.
            log.exception("render failed: series %s frame %d (%s)",
                          series.id, index, image.path)
            return _failed(msg.IMAGE_UNAVAILABLE, msg.IMAGE_DECODE_FAILED, image, started)

        return FrameLoad(frame=frame, image=image, key=key,
                         elapsed_ms=(time.perf_counter() - started) * 1000.0)

    def load(
        self,
        study_id: str,
        series_id: str,
        index: int,
        max_edge: int | None = None,
        use_cache: bool = True,
    ) -> FrameLoad:
        """The same thing by id, for callers that do not hold the study detail -
        the prefetch workers, and any deep link into a slice."""
        started = time.perf_counter()
        detail = self.detail(study_id)
        if detail is None:
            return _failed(msg.STUDY_UNAVAILABLE, msg.STUDY_NOT_FOUND, None, started)
        series = detail.series_by_id(series_id)
        if series is None:
            log.warning("study %s has no series %s", study_id, series_id)
            return _failed(msg.IMAGE_UNAVAILABLE, msg.IMAGE_NO_FRAME, None, started)
        return self.load_frame(detail, series, index, max_edge, use_cache)




