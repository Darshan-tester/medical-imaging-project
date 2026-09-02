/**
 * ---------------------------------------------------------------------------
 * PER-SUBJECT DETERMINISTIC STREAMS
 * ---------------------------------------------------------------------------
 * `lib/mock-data.ts` has its own `mulberry32` seeded once at module scope, so
 * every draw depends on how many draws happened before it. That is fine for a
 * fixed list of 34 demo studies generated in one pass, and wrong for anything
 * derived per study on demand: the value you get for study X would depend on
 * which other studies were built first.
 *
 * That matters here beyond tidiness. Study JSON is precomputed on Windows by
 * `scripts/mirror-export.ts` and served to the browser as those exact bytes
 * from R2. If a generated value shifted with iteration order, the mirrored body
 * and a locally rendered one would disagree, and re-running the export would
 * produce a different mirror from the same manifest.
 *
 * So each subject gets its own stream, seeded from a hash of its id. Same id →
 * same numbers, in any order, in any process, on any platform: `Math.imul` and
 * `>>>` are exactly specified on 32-bit integers, and nothing here touches
 * floating-point beyond the final divide.
 * ---------------------------------------------------------------------------
 */

/** FNV-1a, 32-bit. Cheap, well-mixed, and identical in every JS engine. */
export function hashSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function next(): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededStream {
  /** Next float in [0, 1). */
  float(): number;
  /** Inclusive integer in [min, max]. */
  int(min: number, max: number): number;
  /** Uniform choice. Returns `undefined` only for an empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** True with the given probability. */
  chance(p: number): boolean;
}

/**
 * A stream keyed to one subject. `salt` lets a single id drive two independent
 * sequences (e.g. demographics vs. finding placement) without one consuming
 * draws the other expects.
 */
export function streamFor(id: string, salt = ""): SeededStream {
  const next = mulberry32(hashSeed(`${salt}:${id}`));
  return {
    float: next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
  };
}
