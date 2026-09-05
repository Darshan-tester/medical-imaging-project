/**
 * ---------------------------------------------------------------------------
 * CT VIEWER PERFORMANCE INSTRUMENTATION
 * ---------------------------------------------------------------------------
 * Real measurements of the slice pipeline, printed in development only.
 *
 * Two rules shape this module. The first is that nothing here may run in
 * production: the whole thing is behind a single `ENABLED` constant that folds
 * to `false` at build time, so the calls become dead code rather than a
 * conditional in a hot loop. The second is that nothing here may invent a
 * number. Every value is a `performance.now()` delta across the real work, and
 * a cache hit is reported as a cache hit rather than as a fast load — a viewer
 * that lies about its own timings is worse than one with no timings at all.
 *
 * Volume is the other concern. A 443-slice scroll would produce thousands of
 * lines if every slice logged, so per-slice lines are printed for foreground
 * work only and filmstrip tiles are aggregated into one line per burst.
 * ---------------------------------------------------------------------------
 */

import { PRIORITY, sliceNetworkQueue, slicePixelQueue } from "./request-queue";

/**
 * Development only. `process.env.NODE_ENV` is inlined by the bundler, so in a
 * production build this is a literal `false` and every call below collapses to
 * nothing.
 */
const ENABLED = process.env.NODE_ENV === "development";

const TAG = "[CT Performance]";

/** Filmstrip tiles are summarised rather than logged one by one. */
const THUMB_FLUSH_MS = 400;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function ms(value: number): string {
  return `${value.toFixed(0)}ms`;
}

interface FirstImageState {
  /** Set when a study's first foreground slice is requested; cleared when it renders. */
  url: string;
  requestedAt: number;
  fetchedAt?: number;
  decodedAt?: number;
}

let first: FirstImageState | undefined;
let firstDone = false;

let hits = 0;
let misses = 0;

let thumbCount = 0;
let thumbMs = 0;
let thumbTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Resets the first-image window. Called when the viewer mounts a different
 * study or series, so "first image" means the first image of *this* study
 * rather than of the page session.
 */
export function ctPerfNewStudy(label: string): void {
  if (!ENABLED) return;
  first = undefined;
  firstDone = false;
  hits = 0;
  misses = 0;
  console.info(`${TAG} ---- ${label} ----`);
}

/** Study metadata, i.e. the one `index.json` fetch that yields every slice URL. */
export function ctPerfIndex(sliceCounts: { studies: number; ms: number }): void {
  if (!ENABLED) return;
  console.info(`${TAG} Study metadata loaded: ${ms(sliceCounts.ms)} (${sliceCounts.studies} studies)`);
}

/** The ordered slice list handed to the viewer — no DICOM was read to produce it. */
export function ctPerfSliceIndex(count: number, elapsed: number): void {
  if (!ENABLED) return;
  console.info(`${TAG} Slice index ready: ${ms(elapsed)} (${count} slices, precomputed order)`);
}

/** A slice request begins. `priority` decides whether it is worth a line of its own. */
export function ctPerfRequestStart(url: string, priority: number, cached: boolean): void {
  if (!ENABLED) return;
  if (cached) hits++;
  else misses++;

  if (priority > PRIORITY.next) return;
  if (!firstDone && !first) first = { url, requestedAt: now() };
}

/** Bytes have arrived (or came from the byte cache). */
export function ctPerfFetched(url: string, elapsed: number, fromCache: boolean, bytes: number): void {
  if (!ENABLED) return;
  if (first?.url === url) first.fetchedAt = now();
  if (!fromCache && elapsed > 0) {
    console.debug(`${TAG} Fetched ${(bytes / 1024).toFixed(0)}KB in ${ms(elapsed)} · ${shortUrl(url)}`);
  }
}

/** Pixels are decoded and an object URL exists. */
export function ctPerfDecoded(url: string, priority: number, elapsed: number): void {
  if (!ENABLED) return;

  if (priority >= PRIORITY.thumbnail) {
    thumbCount++;
    thumbMs += elapsed;
    if (!thumbTimer) {
      thumbTimer = setTimeout(() => {
        console.info(`${TAG} Thumbnails decoded: ${thumbCount} in ${ms(thumbMs)}`);
        thumbCount = 0;
        thumbMs = 0;
        thumbTimer = undefined;
      }, THUMB_FLUSH_MS);
    }
    return;
  }

  if (first?.url === url) {
    first.decodedAt = now();
    const fetchMs = (first.fetchedAt ?? first.decodedAt) - first.requestedAt;
    console.info(`${TAG} First image request → bytes: ${ms(fetchMs)}`);
    console.info(`${TAG} First image decoded: ${ms(first.decodedAt - first.requestedAt)} (decode ${ms(elapsed)})`);
    return;
  }

  const band = priority === PRIORITY.current ? "current" : priority === PRIORITY.next ? "next" : "preload";
  console.debug(`${TAG} Slice decoded (${band}): ${ms(elapsed)} · ${shortUrl(url)}`);
}

/**
 * The browser has painted the pixels — the only timing that matches what the
 * person in front of the screen experienced.
 */
export function ctPerfRendered(url: string): void {
  if (!ENABLED) return;
  if (first?.url !== url || firstDone) return;
  firstDone = true;
  console.info(`${TAG} First image rendered: ${ms(now() - first.requestedAt)}`);
  first = undefined;
}

/** Where the current slice came from, and what the pipeline is doing behind it. */
export function ctPerfCurrentSlice(index: number, total: number, cached: boolean, elapsed?: number): void {
  if (!ENABLED) return;
  const source = cached ? "cache HIT" : "cache MISS";
  const timing = elapsed === undefined ? "" : ` in ${ms(elapsed)}`;
  const net = sliceNetworkQueue.stats;
  const px = slicePixelQueue.stats;
  console.info(
    `${TAG} Slice ${index + 1}/${total}: ${source}${timing} · ` +
      `cache ${hits} hits / ${misses} misses · ` +
      `net ${net.active} active, ${net.waiting} queued · decode ${px.active} active, ${px.waiting} queued`
  );
}

/** How many slices the preloader is holding around the current one. */
export function ctPerfPreload(added: number[], dropped: number): void {
  if (!ENABLED || (added.length === 0 && dropped === 0)) return;
  const window = added.length > 0 ? `+${added.length} [${added[0]}…${added[added.length - 1]}]` : "+0";
  console.debug(`${TAG} Preload window: ${window}, released ${dropped}`);
}

/** Trims a slice URL down to the part that identifies it. */
function shortUrl(url: string): string {
  const path = url.split("?")[0] ?? url;
  const cut = path.lastIndexOf("/");
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  const q = url.includes("w=") ? " (thumb)" : "";
  return `${name}${q}`;
}

export const ctPerfEnabled = ENABLED;
