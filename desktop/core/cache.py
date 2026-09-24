"""What gets decoded next, and in what order.

This is the desktop's port of ``lib/viewer/request-queue.ts`` and
``use-slice-prefetch.ts``.  It owns *scheduling* and nothing else: the frames it
produces land in ``render_image_cached``'s LRU, which is the application's one
RAM frame cache (§16).  A second cache here would double the memory for the same
pixels, so there isn't one - the word "cache" in this module's name is about the
cache being *filled*, not a new one being kept.

The problem it solves is the same one the web had.  A 443-slice series is 443
separate decodes, and asking for a window of them at once means the slice the
reader is waiting for is one of a dozen equal requests.  So:

* **Bounded.**  A fixed number of workers, so a scroll cannot start thirty
  decodes.
* **Prioritised.**  Lowest band first.  The visible slice outranks its
  neighbours, which outrank the filmstrip.
* **Deduplicated.**  Two asks for one frame are one decode, and the second can
  *raise* the first's standing - which is what happens when a slice that was
  being quietly preloaded becomes the slice on screen.
* **Droppable.**  A jump to slice 182 removes the queued work for the window it
  left behind, so it does not wait behind decodes nobody is looking at any more.
* **Serialised per volume.**  The first frame of a cold MRI, PET or MPR series
  builds a volume the next thirteen frames will reuse, and the build is only
  cached once it finishes - so exactly one of them is allowed to start until it
  has.  See ``_gate_key``.

Three things the web version does are deliberately *not* carried across:

* **Preemption.**  The browser aborts an in-flight fetch with an
  ``AbortSignal``; a numpy decode part-way through a 33 MB gunzip cannot be
  abandoned.  A reserved slot replaces it: background work may occupy at most
  ``workers - 1`` slots, so a request for the visible slice always has somewhere
  to run rather than waiting for a preload to finish.
* **Reference counting.**  The web needs it because the filmstrip and the viewer
  claim the same URL independently.  Here the plan *is* the truth - one
  ``focus()`` per slice change says exactly what should be warm - and the
  filmstrip's frames carry a different ``max_edge``, so they are different keys
  and cannot collide.
* **Its own retention policy.**  §17's "retain N-1 to N-3" is the frame LRU's
  job: those frames were just decoded, so they are already resident, and the
  trailing half of the plan touches their keys, which is what keeps them from
  ageing out while the reader is still near them.

No Qt.  The callbacks fire on worker threads, and the UI layer is expected to
hand them to the main thread itself - that is one line with a Qt signal, and it
keeps this module testable without a QApplication.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Callable

from . import messages as msg
from .db import SeriesRow, StudyDetail
from .imaging.gray import env_int
from .imaging.render import DICOM_VOLUME, NIFTI
from .loader import KINDS, FrameLoad, Loader
from .log import log

# ---------------------------------------------------------------- priority bands
# request-queue.ts:47-56, unchanged.  Lower runs first; callers add a small
# distance offset inside a band, and the gaps are wide enough that no offset can
# cross one.

#: The slice being displayed right now.  Nothing outranks it.
BAND_CURRENT = 0
#: The next slice in the direction of travel - the one a scroll will land on.
BAND_NEXT = 1
#: The rest of the preload window, offset by distance from the current slice.
BAND_PRELOAD = 4
#: Filmstrip tiles, offset by distance.  Always last: a tile is a convenience, a
#: slice is the study.
BAND_THUMBNAIL = 32

#: At or above this band, work is background and may not fill the last slot.
BACKGROUND_FROM = BAND_PRELOAD

# ------------------------------------------------------------------ the window
# use-slice-prefetch.ts:38-41.  §17 asks for N+1..N+5 ahead and N-1..N-3 behind;
# the web app's window is wider on both sides and is kept as it is, because §1
# says preserve the existing logic and a superset of the requirement satisfies
# it.  Asymmetric because looking back happens in short corrections while
# looking forward is how a series is read.
PRELOAD_BEFORE = env_int("SCANLAB_PRELOAD_BEFORE", 5, 0, 64)
PRELOAD_AFTER = env_int("SCANLAB_PRELOAD_AFTER", 8, 1, 64)

#: Decode workers.  One fewer than the cores, so the UI thread keeps one, and at
#: least two so the reserved slot below is not the only slot.  Capped low on
#: purpose: a cold ``dicom-volume`` frame already spreads its slice reads across
#: up to eight threads of its own (``stack.STACK_WORKERS``), and stacking four of
#: those on top of each other buys nothing.
WORKERS = env_int(
    "SCANLAB_PREFETCH_WORKERS", max(2, min(4, (os.cpu_count() or 4) - 1)), 1, 16)


def band_for(offset: int, direction: int) -> int:
    """use-slice-prefetch.ts:75-81.

    The next slice in the direction of travel sits alone in its own band directly
    behind the visible slice.  Everything else is ordered by distance, with the
    trailing half pushed behind the leading half at equal distance - a slice
    ahead is worth more than its mirror image behind.  ``PRELOAD_AFTER`` as the
    penalty keeps the whole window inside the preload band, so no preload can
    outrank a visible slice or fall behind a filmstrip tile.
    """
    if offset == 0:
        return BAND_CURRENT
    if offset == direction:
        return BAND_NEXT
    distance = abs(offset)
    trailing = (1 if offset > 0 else -1) != direction
    return BAND_PRELOAD + distance + (PRELOAD_AFTER if trailing else 0)


def _gate_key(series: SeriesRow, path: str) -> str | None:
    """Which volume this frame's decode will build, or None if it builds nothing.

    ``stack`` keeps one built volume and ``nifti`` keeps two, and both are stored
    only *after* the build finishes - so three workers starting on a cold volume
    each build the whole thing, three times the seconds and three times the
    memory, and two of the results are thrown away.  At most one frame per key is
    therefore allowed to *run*: the first builds the volume, and the ones after it
    are not started until it has, at which point they find it cached.

    Held by not-starting rather than by waiting.  A worker parked on a lock is a
    worker that cannot decode the series the reader just switched to, and a 558
    slice volume takes 24 seconds to build - long enough that a whole pool of
    workers queued behind one build would make the switch look like a hang.
    Different volumes are unrelated keys and decode in parallel as normal.
    """
    if series.kind == DICOM_VOLUME:
        return f"v:{series.study_id}/{series.volume_id or ''}"
    if series.kind == NIFTI:
        return f"n:{path}"
    return None


@dataclass
class _Task:
    key: str
    band: int
    detail: StudyDetail
    series: SeriesRow
    index: int
    max_edge: int | None
    gate: str | None
    #: Whoever wants to be told when this lands.  More than one because a
    #: filmstrip tile and a focus can name the same frame.  Emptied rather than
    #: flagged when the plan moves on: the decode still finishes and still fills
    #: the cache - part-decoded pixels are worth keeping - but nobody is told
    #: about a frame they are no longer looking at.
    callbacks: list[Callable[[FrameLoad], None]] = field(default_factory=list)
    running: bool = False


@dataclass(frozen=True)
class PlanStats:
    """What one ``focus()`` did, for the performance notes and the tests."""

    warm: int = 0
    queued: int = 0
    #: Already planned, and left in place with its standing updated.
    kept: int = 0
    dropped: int = 0
    #: Set when the visible frame was already in the cache, so the caller can
    #: paint before this returns.
    current: FrameLoad | None = None


class Prefetcher:
    """The decode pool and the plan of what should be warm.

    One instance per window.  ``focus()`` is called on every slice change and
    replaces the plan wholesale; ``strip()`` does the same for the filmstrip's
    visible range.  Nothing else schedules anything, which is what makes "what
    should be decoded right now" a question with one answer.

    Safe to call from the UI thread: every method here does dictionary work and
    a condition-variable notify.  The only file access is inside the workers.
    """

    def __init__(self, loader: Loader, workers: int = WORKERS,
                 before: int = PRELOAD_BEFORE, after: int = PRELOAD_AFTER) -> None:
        self._loader = loader
        self._workers = max(1, int(workers))
        self._before = max(0, int(before))
        self._after = max(1, int(after))

        self._lock = threading.Condition(threading.Lock())
        #: key -> task, insertion-ordered so an equal band keeps request order.
        self._tasks: "OrderedDict[str, _Task]" = OrderedDict()
        self._active = 0
        self._active_background = 0
        self._threads: list[threading.Thread] = []
        self._stopping = False

        #: The gates of the frames running right now - at most one per volume, so
        #: a cold volume is built once.  A set rather than a lock per volume:
        #: nothing waits on these, a worker simply picks up something else.
        self._running_gates: set[str] = set()
        #: Gates whose volume has been built at least once since the plan last
        #: changed series, and which therefore no longer need serialising: the
        #: build is what was being protected, and a reslice out of a volume that
        #: is already in memory parallelises like any other decode.  Emptied on a
        #: series switch, which is the conservative direction - it costs one
        #: serialised frame, where being wrong the other way costs a rebuild.
        self._built: set[str] = set()

        #: Where the reader is, so the direction of travel can be inferred.
        self._at: tuple[str, int] | None = None
        self._direction = 1

        self.decoded = 0
        self.failed = 0

    # -------------------------------------------------------------- lifecycle
    def start(self) -> None:
        """Bring the workers up.  Idempotent."""
        with self._lock:
            if self._threads or self._stopping:
                return
            for n in range(self._workers):
                self._threads.append(threading.Thread(
                    target=self._run, name=f"decode-{n}", daemon=True))
            starting = list(self._threads)
        for thread in starting:
            thread.start()
        log.info("prefetch: %d decode workers, window -%d..+%d",
                 self._workers, self._before, self._after)

    def stop(self, wait: float | None = 5.0) -> None:
        """Drop the plan and let the workers finish.

        A decode already under way is not interrupted - it cannot be - so this
        waits briefly for it.  Its callbacks are dropped first, though: a window
        being torn down should not be handed a frame half way through closing.
        ``daemon=True`` means a worker still busy at exit does not hold the
        process open either way.
        """
        with self._lock:
            self._stopping = True
            self._drop(lambda task: True)
            self._tasks.clear()
            self._lock.notify_all()
            threads = list(self._threads)
            self._threads.clear()
        if wait:
            deadline = time.monotonic() + wait
            for thread in threads:
                thread.join(max(0.0, deadline - time.monotonic()))

    def clear(self) -> None:
        """Forget everything not yet started - a study close, or a 3-D view
        taking over the window."""
        with self._lock:
            dropped = self._drop(lambda task: True)
            self._built.clear()
        if dropped:
            log.debug("prefetch: dropped %d queued frames", dropped)

    def stats(self) -> dict:
        with self._lock:
            return {
                "workers": self._workers,
                "active": self._active,
                "waiting": sum(0 if t.running else 1 for t in self._tasks.values()),
                "decoded": self.decoded,
                "failed": self.failed,
                "direction": self._direction,
            }

    # ------------------------------------------------------------- scheduling
    def focus(
        self,
        detail: StudyDetail,
        series: SeriesRow,
        index: int,
        max_edge: int | None = None,
        on_frame: Callable[[FrameLoad], None] | None = None,
    ) -> PlanStats:
        """Say where the reader is; replace the plan around it.

        Returns immediately.  ``PlanStats.current`` is the visible frame when it
        was already cached, so a scroll onto a warm slice paints without a worker
        ever being involved; when it was not, ``on_frame`` is called from a worker
        with the result - unless the reader has moved on by then, in which case it
        is not called at all and the UI is spared having to recognise a frame it
        no longer wants.
        """
        direction = self._advance(series, index)
        ahead = self._after if direction > 0 else self._before
        behind = self._before if direction > 0 else self._after

        wanted: dict[str, tuple[int, int]] = {}   # key -> (band, index)
        current_key = ""
        for at in range(index - behind, index + ahead + 1):
            if at < 0 or at >= series.frame_count:
                continue
            key = self._key(series, at, max_edge)
            if key is None:
                continue
            band = band_for(at - index, direction)
            wanted[key] = (band, at)
            if at == index:
                current_key = key

        # Peeked before anything is queued.  A hit here is ~20 us and it moves
        # the entry to the end of the LRU, which is how §17's "retain N-1..N-3"
        # is met: the trailing half of the window is usually already resident and
        # asking for it is what stops it ageing out.
        warm = 0
        current: FrameLoad | None = None
        for key in list(wanted):
            band, at = wanted[key]
            hit = self._loader.peek(series, at, max_edge)
            if hit is None:
                continue
            warm += 1
            del wanted[key]
            if key == current_key:
                current = hit

        with self._lock:
            if self._stopping:
                # Nothing would ever run it, and a caller waiting for a callback
                # that cannot arrive is worse than one told there is no plan.
                return PlanStats(warm=warm, current=current)
            keep = set(wanted)
            dropped = self._drop(
                lambda task: task.band < BAND_THUMBNAIL and task.key not in keep)
            queued = kept = 0
            for key, (band, at) in sorted(wanted.items(), key=lambda kv: kv[1][0]):
                callback = on_frame if key == current_key else None
                if self._submit(detail, series, at, max_edge, key, band, callback):
                    queued += 1
                else:
                    kept += 1
            if queued or kept:
                self._lock.notify_all()

        return PlanStats(warm=warm, queued=queued, kept=kept,
                         dropped=dropped, current=current)

    def strip(
        self,
        detail: StudyDetail,
        series: SeriesRow,
        indices: list[int] | tuple[int, ...],
        max_edge: int,
        on_frame: Callable[[FrameLoad], None] | None = None,
    ) -> PlanStats:
        """The filmstrip's visible range, in the band behind everything else.

        Separate from ``focus()`` because a virtualized strip scrolls
        independently of the slice on screen, and because its frames are a
        different size - a different cache key - so the two plans can never
        contend for the same entry.

        ``on_frame`` fires on the calling thread for a tile that was already warm
        and on a worker for one that had to be decoded.  Both are safe to turn
        into a Qt signal emit, which is what the UI layer does with it.
        """
        wanted: dict[str, int] = {}
        warm = 0
        for at in indices:
            if at < 0 or at >= series.frame_count:
                continue
            key = self._key(series, at, max_edge)
            if key is None:
                continue
            hit = self._loader.peek(series, at, max_edge)
            if hit is not None:
                warm += 1
                if on_frame is not None:
                    on_frame(hit)
                continue
            wanted[key] = at

        with self._lock:
            if self._stopping:
                return PlanStats(warm=warm)
            keep = set(wanted)
            dropped = self._drop(
                lambda task: task.band >= BAND_THUMBNAIL and task.key not in keep)
            queued = kept = 0
            for position, (key, at) in enumerate(wanted.items()):
                band = BAND_THUMBNAIL + position
                if self._submit(detail, series, at, max_edge, key, band, on_frame):
                    queued += 1
                else:
                    kept += 1
            if queued or kept:
                self._lock.notify_all()

        return PlanStats(warm=warm, queued=queued, kept=kept, dropped=dropped)

    # ---------------------------------------------------------------- internals
    def _key(self, series: SeriesRow, index: int, max_edge: int | None) -> str | None:
        """The frame cache key for one planned frame, or None if there is no such
        frame or nothing that can decode it.

        Index rows only - no path is joined and no file is touched, which is what
        lets a whole plan be costed on the UI thread.
        """
        image = series.frame(index)
        if image is None or image.kind not in KINDS:
            return None
        return self._loader.cache_key(series, image, max_edge)

    def _advance(self, series: SeriesRow, index: int) -> int:
        """Record where the reader is and return the direction of travel.

        A new series resets to forward and abandons the plan outright: none of the
        old window's frames are worth having, and on a volumetric series they are
        actively harmful - the built volume behind them is what the new series is
        about to want the memory for.
        """
        with self._lock:
            at = self._at
            if at is None or at[0] != series.id:
                self._direction = 1
                self._drop(lambda task: True)
                self._built.clear()
            elif index > at[1]:
                self._direction = 1
            elif index < at[1]:
                self._direction = -1
            self._at = (series.id, index)
            return self._direction

    def _drop(self, predicate: Callable[[_Task], bool]) -> int:
        """Remove matching work that has not started; silence what has.  Caller
        holds the lock."""
        dropped = 0
        for key in [k for k, t in self._tasks.items() if predicate(t)]:
            task = self._tasks[key]
            if task.running:
                task.callbacks.clear()
                continue
            del self._tasks[key]
            dropped += 1
        return dropped

    def _submit(
        self,
        detail: StudyDetail,
        series: SeriesRow,
        index: int,
        max_edge: int | None,
        key: str,
        band: int,
        callback: Callable[[FrameLoad], None] | None,
    ) -> bool:
        """Queue one frame, or restate the standing of the one already queued.
        Caller holds the lock.  True when it is new work.

        The band is *assigned*, not lowered.  Raising it only would leave the
        slice the reader has just scrolled off still sitting at band 0 - equal to
        the slice they are now looking at, and ahead of it on insertion order - so
        after a few steps the queue would be led by frames nobody is looking at.
        The plan is rebuilt whole on every ``focus()``, so the newest plan's band
        is by definition the right one.

        A task already running is left alone: it is running, so its priority no
        longer decides anything, and changing it would unbalance the
        reserved-slot accounting, which is keyed off the band it started with.
        """
        existing = self._tasks.get(key)
        if existing is not None:
            if callback is not None and callback not in existing.callbacks:
                existing.callbacks.append(callback)
            if not existing.running:
                existing.band = band
            return False
        image = series.frame(index)
        self._tasks[key] = _Task(
            key=key, band=band, detail=detail, series=series, index=index,
            max_edge=max_edge, gate=_gate_key(series, image.path if image else ""),
            callbacks=[callback] if callback is not None else [],
        )
        return True

    def _next(self) -> _Task | None:
        """The most urgent startable task.  Caller holds the lock.

        Two things make a task unstartable rather than merely lower-priority:

        *Background work is refused the last slot.*  That is this port's answer to
        the web queue's preemption: a numpy decode cannot be aborted to make room,
        so room is kept instead, and a request for the visible slice never waits
        for a preload to finish.

        *A volume already being built takes no second worker.*  See ``_gate_key``.
        The task stays queued and is picked up once the build is done, when it
        costs a reslice instead of a build.
        """
        room_for_background = max(1, self._workers - 1)
        best: _Task | None = None
        for task in self._tasks.values():
            if task.running:
                continue
            if task.band >= BACKGROUND_FROM and \
                    self._active_background >= room_for_background:
                continue
            if task.gate is not None and task.gate in self._running_gates \
                    and task.gate not in self._built:
                continue
            if best is None or task.band < best.band:
                best = task
        return best

    def _run(self) -> None:
        while True:
            with self._lock:
                task = None
                while task is None:
                    if self._stopping:
                        return
                    task = self._next()
                    if task is None:
                        # Timed rather than indefinite: a worker parked because
                        # the last slot was reserved, or because the volume it
                        # wants is being built, has to look again when that
                        # clears, and the notify that clears it may have been
                        # consumed by another worker.
                        self._lock.wait(0.25)
                task.running = True
                background = task.band >= BACKGROUND_FROM
                self._active += 1
                if background:
                    self._active_background += 1
                if task.gate is not None:
                    self._running_gates.add(task.gate)

            load = self._decode(task)

            with self._lock:
                self._tasks.pop(task.key, None)
                self._active -= 1
                if background:
                    self._active_background -= 1
                if task.gate is not None:
                    self._running_gates.discard(task.gate)
                if load.ok:
                    self.decoded += 1
                    if task.gate is not None:
                        self._built.add(task.gate)
                else:
                    self.failed += 1
                # Read under the lock because ``_drop`` empties this list from
                # the UI thread the moment the plan moves on, and a frame nobody
                # is looking at any more must not be delivered.
                callbacks = list(task.callbacks)
                self._lock.notify_all()

            for callback in callbacks:
                try:
                    callback(load)
                except Exception:  # noqa: BLE001 - a bad listener is not a bad frame
                    log.exception("prefetch: listener raised for %s", task.key)

    def _decode(self, task: _Task) -> FrameLoad:
        """Run one task.  Always answers, even if something got past
        ``load_frame`` - which by contract cannot happen, but a worker that dies
        takes a pool slot with it for the life of the process, and a caller left
        without its callback waits for a frame that will never arrive.  So the
        unexpected becomes §26's sentence like every other failure."""
        started = time.perf_counter()
        try:
            return self._loader.load_frame(
                task.detail, task.series, task.index, task.max_edge)
        except Exception:  # noqa: BLE001
            log.exception("prefetch: decode raised for series %s frame %d",
                          task.series.id, task.index)
            return FrameLoad(
                title=msg.IMAGE_UNAVAILABLE, detail=msg.IMAGE_DECODE_FAILED,
                image=task.series.frame(task.index), key=task.key,
                elapsed_ms=(time.perf_counter() - started) * 1000.0)
