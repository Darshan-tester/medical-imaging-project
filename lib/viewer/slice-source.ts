/**
 * ---------------------------------------------------------------------------
 * SLICE SOURCE
 * ---------------------------------------------------------------------------
 * One entry point for "give me the pixels behind this URL", whichever decoder
 * owns them.
 *
 * A viewer image URL is one of three things: a marker for a committed demo asset
 * (`?dcm=1`, `?nii=…`), a marker for bytes in this browser's IndexedDB (an
 * uploaded study), or a plain image the browser can load by itself. The first two
 * need a decoder, and both decoders pull in heavy parsers — `dicom-parser`,
 * `nifti-reader-js` — so they are imported on demand rather than statically.
 *
 * That dynamic import is the reason this module exists. It used to be spelled out
 * at each call site, which meant every new caller (the preloader, the filmstrip,
 * the viewer) repeated the marker test and the import, and each of them held its
 * own module promise. Here there is one of each, so a `releaseSlice` can never be
 * ordered before the `loadSlice` it belongs to: both go through the same cached
 * import, and promise callbacks run in the order they were attached.
 *
 * No React, and no decoding of its own.
 * ---------------------------------------------------------------------------
 */

import { isDemoDecodeUrl } from "../demo/types";
import { isUploadDecodeUrl } from "../uploads/types";
import { PRIORITY } from "./request-queue";
import { DecodedImage, peekSlice } from "./slice-cache";

export type { DecodedImage };
export { peekSlice };

/** True when this URL needs a decoder — i.e. an `<img src>` alone will not show it. */
export function isDecodableUrl(url: string | undefined): url is string {
  return url !== undefined && (isDemoDecodeUrl(url) || isUploadDecodeUrl(url));
}

type DemoDecoder = typeof import("../demo/decode");
type UploadDecoder = typeof import("../uploads/decode");

let demoModule: Promise<DemoDecoder> | undefined;
let uploadModule: Promise<UploadDecoder> | undefined;

function demoDecoder(): Promise<DemoDecoder> {
  demoModule ??= import("../demo/decode");
  return demoModule;
}

function uploadDecoder(): Promise<UploadDecoder> {
  uploadModule ??= import("../uploads/decode");
  return uploadModule;
}

/**
 * Decodes one slice, scheduled at `priority`.
 *
 * Asking twice for the same URL is free: the demo decoder shares one in-flight
 * decode between callers and raises its priority to the best anybody asked for,
 * which is how a slice being preloaded in the background overtakes the queue the
 * moment it becomes the slice on screen.
 *
 * Every call should be balanced by `releaseSlice` when the caller stops caring.
 * Not doing so is not a leak — the pixels are cached and bounded either way — but
 * it does leave background work in the queue that nobody is waiting for.
 */
export function loadSlice(url: string, priority: number = PRIORITY.current): Promise<DecodedImage> {
  if (isDemoDecodeUrl(url)) {
    return demoDecoder().then((mod) => mod.decodeDemoImage(url, { priority }));
  }
  if (isUploadDecodeUrl(url)) {
    // Uploaded bytes come from IndexedDB, so there is no network to schedule and
    // nothing to preempt; the decode still goes through the shared pixel queue
    // inside that module's own dedupe.
    return uploadDecoder().then((mod) => mod.decodeUploadImage(url));
  }
  return Promise.reject(new Error("Not a decodable image URL"));
}

/**
 * Warms a slice without waiting for it.
 *
 * Failures are swallowed on purpose: a preload that was dropped because the user
 * scrolled somewhere else rejects with an `AbortError`, and that is the system
 * working. The caller that actually displays a slice gets its own promise and its
 * own error.
 */
export function prefetchSlice(url: string, priority: number): void {
  if (!isDecodableUrl(url)) return;
  void loadSlice(url, priority).catch(() => {});
}

/**
 * Drops one caller's claim on a slice.
 *
 * Only the demo decoder schedules work worth cancelling. For uploads this is a
 * no-op, since the decode has no network stage to abandon.
 */
export function releaseSlice(url: string): void {
  if (!isDemoDecodeUrl(url)) return;
  void demoDecoder().then((mod) => mod.releaseDemoImage(url));
}
