/**
 * ---------------------------------------------------------------------------
 * DECODED SLICE CACHE
 * ---------------------------------------------------------------------------
 * One bounded LRU of decoded slices, shared by every decoder in the app.
 *
 * It exists as its own module for two reasons. The first is that both decoders —
 * `lib/demo/decode.ts` for the committed studies and `lib/uploads/decode.ts` for
 * bytes in IndexedDB — had an identical copy of it, and two caches with two
 * eviction policies over the same kind of object is a leak waiting to happen.
 *
 * The second is the one that matters to the viewer. Both decoders pull in
 * `dicom-parser` and `nifti-reader-js`, so they are imported on demand rather
 * than statically, which means asking them "do you already have this slice?"
 * costs a dynamic import and a microtask. That was enough to make stepping back
 * to a slice already in memory flash a spinner for a frame. This module has no
 * dependencies at all, so a component can import it directly and answer that
 * question synchronously, during render — which is what makes going back to the
 * previous slice instant rather than nearly instant.
 *
 * Entries are object URLs backed by a Blob the browser keeps alive until the URL
 * is revoked, so eviction revokes. Nothing else may: a component that revoked on
 * unmount would leave this cache handing out a dead blob to whoever asks next.
 * ---------------------------------------------------------------------------
 */

/** What a decoded slice URL resolves to: an object URL an `<img>` can use directly. */
export interface DecodedImage {
  objectUrl: string;
  width: number;
  height: number;
}

/**
 * How many decoded slices to keep in memory.
 * 256 entries allows seamless back-and-forth scrolling across full studies
 * while keeping memory consumption bounded.
 */
const SLICE_CACHE_MAX = 256;

const cache = new Map<string, DecodedImage>();

/**
 * Checks if a slice is already present in cache.
 */
export function hasSlice(url: string): boolean {
  return cache.has(url);
}

/**
 * The decoded slice for `url`, if it is in memory.
 *
 * Safe to call during render — no network, no decode, no promise. A hit is also
 * an LRU touch, which is correct: asking for a slice is what makes it recent.
 */
export function peekSlice(url: string): DecodedImage | undefined {
  const hit = cache.get(url);
  if (hit === undefined) return undefined;
  cache.delete(url);
  cache.set(url, hit);
  return hit;
}

/** Records a freshly decoded slice, evicting and revoking the least recently used. */
export function putSlice(url: string, image: DecodedImage): DecodedImage {
  if (cache.has(url)) {
    const existing = cache.get(url);
    if (existing && existing.objectUrl !== image.objectUrl) {
      URL.revokeObjectURL(existing.objectUrl);
    }
    cache.delete(url);
  }

  cache.set(url, image);
  while (cache.size > SLICE_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const evicted = cache.get(oldest.value);
    cache.delete(oldest.value);
    if (evicted) URL.revokeObjectURL(evicted.objectUrl);
  }
  return image;
}

/** Returns the current count of cached slices in memory. */
export function getSliceCacheSize(): number {
  return cache.size;
}

