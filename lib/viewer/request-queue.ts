/**
 * ---------------------------------------------------------------------------
 * PRIORITISED REQUEST QUEUE
 * ---------------------------------------------------------------------------
 * A 443-slice CT series is 443 separate 515 KB DICOM files. Every one of them
 * costs a fetch, a parse and a windowing pass, and the browser will happily
 * start all of the ones it is asked for at once — which is exactly what used to
 * happen: opening a study mounted thirteen filmstrip tiles and one full-size
 * slice, so the image the radiologist is waiting for was one of fourteen
 * simultaneous downloads of equal standing, and its decode sat behind thirteen
 * others on the main thread.
 *
 * This is the scheduler that fixes the ordering problem. It is deliberately
 * small and has no knowledge of DICOM, React or the viewer:
 *
 *   - **Bounded.** At most `limit` tasks run at once, so the network is never
 *     asked for more than it can usefully do in parallel.
 *   - **Prioritised.** Waiting tasks are started lowest-`priority`-number
 *     first, so the visible slice goes before its neighbours, which go before
 *     filmstrip tiles.
 *   - **Deduplicated and reference counted.** Two callers asking for the same
 *     key share one task. The second caller can also *raise* its priority,
 *     which is what happens when a slice that was being quietly preloaded
 *     becomes the slice on screen.
 *   - **Cancellable.** Each task gets an `AbortSignal`. Dropping the last claim
 *     on a task that has not started yet removes it outright; a task that is
 *     already running is left to finish, because bytes half-downloaded are
 *     still worth caching and the alternative is re-fetching them later.
 *   - **Preemptible.** If every slot is busy with background work when an
 *     urgent request arrives, one background task is aborted to make room and
 *     re-queued at its own priority. Its caller never sees the interruption —
 *     the promise stays pending and the task is simply run again later. This is
 *     what stops a jump to "the finding is on slice 182" from waiting behind
 *     preloads for slices nobody is looking at any more.
 *
 * Client-safe: no DOM, no framework, no network of its own.
 * ---------------------------------------------------------------------------
 */

/**
 * Scheduling bands. Lower runs first; callers add a small distance offset
 * within a band, so "two slices ahead" beats "eight slices ahead" without
 * either of them ever beating the slice on screen.
 *
 * The gaps between bands are wide enough that no offset can cross one.
 */
export const PRIORITY = {
  /** The slice being displayed right now. Nothing outranks it. */
  current: 0,
  /** The next slice in the direction of travel — the one a scroll will land on. */
  next: 1,
  /** The rest of the preload window, offset by distance from the current slice. */
  preload: 4,
  /** Filmstrip tiles, offset by distance. Always last: a tile is a convenience, a slice is the study. */
  thumbnail: 32,
} as const;

/** Anything at or beyond this band is background work an urgent request may interrupt. */
const PREEMPTIBLE_FROM = PRIORITY.preload;

/** Only urgent work preempts, and only work below this band counts as urgent. */
const PREEMPTS_UP_TO = PRIORITY.next;

/** Stops a pathological scroll pattern from restarting one task for ever. */
const MAX_ATTEMPTS = 3;

type Task<T> = (signal: AbortSignal) => Promise<T>;

interface Entry {
  key: string;
  priority: number;
  /** FIFO tiebreak inside a priority band, so equal-priority work keeps its request order. */
  seq: number;
  /** How many callers still want this. At zero the entry is droppable. */
  claims: number;
  task: Task<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  controller?: AbortController;
  running: boolean;
  attempts: number;
}

export interface QueueStats {
  active: number;
  waiting: number;
}

export class RequestQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly waiting: Entry[] = [];
  private activeCount = 0;
  private seq = 0;

  constructor(
    readonly name: string,
    private readonly limit: number
  ) {}

  get stats(): QueueStats {
    return { active: this.activeCount, waiting: this.waiting.length };
  }

  /** True if this exact key is already cached-in-progress — i.e. asking for it again is free. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Claims a task. Returns the shared promise for `key`, starting it when a slot
   * frees up. Every `run` must be balanced by a `release` once the caller stops
   * caring, or the entry keeps its claim for ever and can never be dropped.
   */
  run<T>(key: string, priority: number, task: Task<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      existing.claims++;
      this.promote(existing, priority);
      return existing.promise as Promise<T>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const entry: Entry = {
      key,
      priority,
      seq: this.seq++,
      claims: 1,
      task: task as Task<unknown>,
      promise,
      resolve,
      reject,
      running: false,
      attempts: 0,
    };

    /*
     * A dropped or failed entry must not surface as an unhandled rejection just
     * because a prefetcher never awaited it. The caller's own reference to
     * `promise` still rejects and is still theirs to handle.
     */
    promise.catch(() => {});

    this.entries.set(key, entry);
    this.waiting.push(entry);
    this.pump(priority);
    return promise as Promise<T>;
  }

  /** Raises an existing task's standing without adding a claim. Used when a preloaded slice becomes visible. */
  raise(key: string, priority: number): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.promote(entry, priority);
      this.pump(priority);
    }
  }

  /**
   * Drops one claim. When the last one goes: a task that has not started is
   * removed and rejected; a task that is already running is left alone, since
   * its result still lands in the caller's cache and re-fetching it later would
   * cost more than letting it finish.
   */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.claims--;
    if (entry.claims > 0 || entry.running) return;

    const at = this.waiting.indexOf(entry);
    if (at >= 0) this.waiting.splice(at, 1);
    this.entries.delete(key);
    entry.reject(new DOMException("Slice request dropped", "AbortError"));
  }

  /** Aborts a running task outright and drops it. For work whose result has become meaningless. */
  cancel(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    const at = this.waiting.indexOf(entry);
    if (at >= 0) this.waiting.splice(at, 1);
    this.entries.delete(key);
    entry.claims = 0;
    entry.controller?.abort();
    entry.reject(new DOMException("Slice request cancelled", "AbortError"));
    if (entry.running) this.activeCount--;
    this.pump();
  }

  private promote(entry: Entry, priority: number): void {
    if (priority < entry.priority) entry.priority = priority;
  }

  /**
   * Starts as much waiting work as the limit allows, most urgent first, and —
   * when `incoming` is urgent and there is nothing free — makes room by
   * interrupting the least urgent background task in flight.
   */
  private pump(incoming?: number): void {
    if (incoming !== undefined && incoming <= PREEMPTS_UP_TO && this.activeCount >= this.limit) {
      this.preempt();
    }

    while (this.activeCount < this.limit && this.waiting.length > 0) {
      let bestAt = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i]!;
        const b = this.waiting[bestAt]!;
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) bestAt = i;
      }
      const entry = this.waiting.splice(bestAt, 1)[0]!;
      this.start(entry);
    }
  }

  /** Interrupts one in-flight background task and puts it back in the queue. */
  private preempt(): void {
    let victim: Entry | undefined;
    for (const entry of this.entries.values()) {
      if (!entry.running || entry.priority < PREEMPTIBLE_FROM) continue;
      if (entry.attempts >= MAX_ATTEMPTS) continue;
      if (!victim || entry.priority > victim.priority || (entry.priority === victim.priority && entry.seq > victim.seq)) {
        victim = entry;
      }
    }
    if (!victim) return;

    victim.running = false;
    this.activeCount--;
    // `preempted` is read by the abort handler in `start` to tell "make room"
    // apart from "nobody wants this any more".
    victim.controller?.abort(PREEMPTED);
    victim.controller = undefined;
    this.waiting.push(victim);
  }

  private start(entry: Entry): void {
    entry.running = true;
    entry.attempts++;
    this.activeCount++;
    const controller = new AbortController();
    entry.controller = controller;

    let task: Promise<unknown>;
    try {
      task = entry.task(controller.signal);
    } catch (err) {
      task = Promise.reject(err);
    }

    void task.then(
      (value) => {
        if (this.settle(entry)) entry.resolve(value);
      },
      (err) => {
        /*
         * A preempted task is not a failure. Its slot was taken by something
         * more urgent; the entry is already back in `waiting` and will run
         * again, so the caller's promise must stay pending.
         */
        if (controller.signal.aborted && controller.signal.reason === PREEMPTED) {
          this.pump();
          return;
        }
        if (this.settle(entry)) entry.reject(err);
      }
    );
  }

  /** Removes a finished entry. False if it was already taken out from under us (cancelled or preempted). */
  private settle(entry: Entry): boolean {
    if (this.entries.get(entry.key) !== entry || !entry.running) {
      this.pump();
      return false;
    }
    entry.running = false;
    this.activeCount--;
    this.entries.delete(entry.key);
    this.pump();
    return true;
  }
}

/** Abort reason marking "your slot was needed", as opposed to "this is no longer wanted". */
const PREEMPTED = Symbol("preempted");

/**
 * How many slice fetches may be in the air at once.
 *
 * Four is the shape the viewer wants: the visible slice, plus two or three
 * neighbours warming up behind it. Higher and a filmstrip full of tiles starts
 * competing with the image on screen for the same bandwidth, which is the
 * problem this exists to solve; lower and preloading cannot keep up with a
 * steady scroll.
 */
export const sliceNetworkQueue = new RequestQueue("net", 4);

/**
 * Decoding is synchronous JavaScript — a DICOM parse, a windowing pass over a
 * quarter of a million pixels, a canvas encode — so two decodes at once are not
 * faster, they are just a longer block of the main thread with React locked out
 * for the duration. One at a time, most urgent first, keeps the UI responsive
 * and gets the visible slice on screen sooner.
 */
export const slicePixelQueue = new RequestQueue("pixels", 1);
