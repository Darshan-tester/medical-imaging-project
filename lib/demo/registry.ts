/**
 * ---------------------------------------------------------------------------
 * DEMO VOLUME REGISTRY
 * ---------------------------------------------------------------------------
 * Slice URLs for a committed NIfTI series carry a short key rather than the
 * geometry they need — `?nii=MRI-189F99.flair-axi&f=12`, not dims plus three
 * axis pairs plus a window. This module is where that key is resolved.
 *
 * Why a registry at all: a 512-slice reconstructed plane produces 512 URLs that
 * differ in one number, and the geometry is a property of the volume, not of the
 * slice. Inlining it would repeat ~200 characters per frame — tens of thousands
 * of times for a ten-study MRI list — for information the browser already has,
 * because every one of those URLs came out of the same index it loaded.
 *
 * Registration is idempotent and happens in `lib/demo/load.ts` the moment the
 * index arrives, before any URL derived from it can be fetched.
 *
 * Client-safe: no `fs`, no network, no framework imports.
 * ---------------------------------------------------------------------------
 */

import { DemoStudy, DemoVolume } from "./types";

const volumes = new Map<string, DemoVolume>();

/**
 * The key that goes in a slice URL.
 *
 * Both parts are already URL-safe: study ids are `MRI-189F99`-shaped, and the
 * generator restricts volume keys to `[A-Za-z0-9_-]` (see `volumeKey` in
 * `scripts/demo-index.ts`) precisely so this needs no escaping — an escaped `%`
 * in a query value survives fine, but it is one more thing to get wrong in a
 * string that is built in two places and parsed in a third.
 */
export function volumeRegistryKey(studyId: string, volumeKey: string): string {
  return `${studyId}.${volumeKey}`;
}

/** Registers every volume of one study. Called once per study when the index loads. */
export function registerStudyVolumes(study: DemoStudy): void {
  if (!study.volumes) return;
  for (const [key, volume] of Object.entries(study.volumes)) {
    volumes.set(volumeRegistryKey(study.id, key), volume);
  }
}

/**
 * Resolves a key from a slice URL.
 *
 * Undefined means the URL was built against an index this page never loaded —
 * a stale bookmark, or a study served from one index and a URL from another.
 * The decoder turns that into a failed image rather than a thrown render.
 */
export function lookupVolume(key: string): DemoVolume | undefined {
  return volumes.get(key);
}

/** Test/debug affordance only; nothing in the app clears the registry. */
export function registeredVolumeCount(): number {
  return volumes.size;
}
