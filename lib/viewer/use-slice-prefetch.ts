/**
 * ---------------------------------------------------------------------------
 * SLICE PRELOADER
 * ---------------------------------------------------------------------------
 * Keeps a small window of slices around the current one warm, so stepping
 * through a series lands on pixels that are already decoded.
 *
 * The window is deliberately small and asymmetric. A CT instance is half a
 * megabyte, so "preload everything" is 224 MB and 443 decodes for a study
 * somebody may look at four slices of; and the slices worth having are the ones
 * in front of where the reader is going. The window therefore leans in the
 * direction of travel and flips when the reader turns around.
 *
 * What this hook does *not* do is fetch. It claims and releases slices from
 * `slice-source`, and the queues underneath decide what actually runs and in what
 * order. That separation is why a jump to slice 182 is fast: the claims for the
 * abandoned window are dropped in the same commit, so the work that had not
 * started yet leaves the queue instead of sitting in front of the slice the
 * reader is now waiting for.
 * ---------------------------------------------------------------------------
 */

"use client";

import { useEffect, useRef } from "react";

import { ctPerfPreload } from "./perf";
import { PRIORITY } from "./request-queue";
import { isDecodableUrl, prefetchSlice, releaseSlice } from "./slice-source";

/**
 * How far behind the current slice to keep warm.
 *
 * Smaller than the forward reach because looking back happens in short
 * corrections — a step or two to re-check something — while looking forward is
 * how a series is read.
 */
export const PRELOAD_BEFORE = 6;

/** How far ahead, in the direction of travel. Roughly a second of steady scrolling. */
export const PRELOAD_AFTER = 14;

/** How far ahead to aggressively buffer during active cine playback. */
export const PRELOAD_CINE_AFTER = 32;
export const PRELOAD_CINE_BEFORE = 8;

interface SlicePrefetchOptions {
  /** Slices in the series. */
  total: number;
  /** The slice on screen, as a position in the ordered series. */
  current: number;
  /**
   * The image URL for a position, or undefined if there is none. Must be stable
   * between renders of the same series — its identity is what tells the hook that
   * the series underneath changed.
   */
  urlAt: (index: number) => string | undefined;
  /** Set false to hold everything (the 3-D view is open, or there is nothing to page through). */
  enabled?: boolean;
  /** True when cine playback is actively running, triggering forward pipeline streaming. */
  playing?: boolean;
}

interface Claim {
  url: string;
  priority: number;
}

/**
 * Scheduling band for a slice `offset` away from the current one, travelling in
 * `direction`.
 */
function bandFor(offset: number, direction: 1 | -1): number {
  if (offset === 0) return PRIORITY.current;
  if (offset === direction) return PRIORITY.next;
  const distance = Math.abs(offset);
  const trailing = Math.sign(offset) !== direction;
  return PRIORITY.preload + distance + (trailing ? PRELOAD_AFTER : 0);
}

export function useSlicePrefetch({ total, current, urlAt, enabled = true, playing = false }: SlicePrefetchOptions): void {
  /** Position → what we are holding for it. The single source of truth for what to release. */
  const held = useRef(new Map<number, Claim>());
  const lastIndex = useRef(current);
  const direction = useRef<1 | -1>(1);

  useEffect(() => {
    const claims = held.current;

    const drop = (positions: Iterable<number>) => {
      let dropped = 0;
      for (const at of positions) {
        const claim = claims.get(at);
        if (!claim) continue;
        claims.delete(at);
        releaseSlice(claim.url);
        dropped++;
      }
      return dropped;
    };

    if (!enabled || total <= 1) {
      const dropped = drop([...claims.keys()]);
      ctPerfPreload([], dropped);
      return;
    }

    if (current > lastIndex.current) direction.current = 1;
    else if (current < lastIndex.current) direction.current = -1;
    lastIndex.current = current;

    const dir = direction.current;
    const isPlaying = Boolean(playing);
    const ahead = isPlaying ? PRELOAD_CINE_AFTER : dir > 0 ? PRELOAD_AFTER : PRELOAD_BEFORE;
    const behind = isPlaying ? PRELOAD_CINE_BEFORE : dir > 0 ? PRELOAD_BEFORE : PRELOAD_AFTER;

    const wanted = new Map<number, Claim>();
    for (let offset = -behind; offset <= ahead; offset++) {
      let at = current + offset;
      if (isPlaying) {
        at = ((at % total) + total) % total;
      } else if (at < 0 || at >= total) {
        continue;
      }
      const url = urlAt(at);
      if (!isDecodableUrl(url)) continue;
      wanted.set(at, { url, priority: bandFor(offset, dir) });
    }

    const stale: number[] = [];
    for (const [at, claim] of claims) {
      const want = wanted.get(at);
      if (!want || want.url !== claim.url) stale.push(at);
    }
    const dropped = drop(stale);

    const added: number[] = [];
    for (const [at, want] of wanted) {
      const claim = claims.get(at);
      if (!claim) {
        claims.set(at, want);
        prefetchSlice(want.url, want.priority);
        added.push(at);
        continue;
      }
      /*
       * Already held, but the window moved and this slice matters more than it
       * did — slice 19 was eight ahead and is now the next one. Claiming again
       * raises its standing in the queue, and dropping the older claim
       * afterwards leaves the count where it started. Claim first, or the last
       * claim would go and take the in-flight work with it.
       */
      if (want.priority < claim.priority) {
        prefetchSlice(want.url, want.priority);
        releaseSlice(want.url);
        claim.priority = want.priority;
      }
    }

    ctPerfPreload(added, dropped);
  }, [current, total, urlAt, enabled]);

  /*
   * Releasing on unmount needs its own effect. Doing it in the cleanup of the
   * reconcile effect above would drop and re-claim the entire window on every
   * single slice change, which is exactly the churn this hook exists to avoid.
   */
  useEffect(() => {
    const claims = held.current;
    return () => {
      for (const claim of claims.values()) releaseSlice(claim.url);
      claims.clear();
    };
  }, []);
}
