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
import { PRIORITY, sliceNetworkQueue } from "./request-queue";
import { DecodedImage, peekSlice, putSlice } from "./slice-cache";

export type { DecodedImage };
export { peekSlice };

/** True when this URL can be managed, preloaded, and rendered through the slice pipeline. */
export function isDecodableUrl(url: string | undefined): url is string {
  return typeof url === "string" && url.trim().length > 0;
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

async function fetchAndDecodeApiImage(url: string, priority: number): Promise<DecodedImage> {
  const cached = peekSlice(url);
  if (cached) return cached;

  return sliceNetworkQueue.run(url, priority, async (signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load image`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    let width = 512;
    let height = 512;
    if (typeof createImageBitmap !== "undefined") {
      try {
        const bmp = await createImageBitmap(blob);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } catch {
        // Fallback default medical image dimensions
      }
    }

    const decoded: DecodedImage = { objectUrl, width, height };
    putSlice(url, decoded);
    return decoded;
  });
}

/**
 * Decodes or fetches one slice, scheduled at `priority`.
 *
 * Asking twice for the same URL is free: the queue and cache share one in-flight
 * task between callers and raise its priority to the best anybody asked for.
 */
export function loadSlice(url: string, priority: number = PRIORITY.current): Promise<DecodedImage> {
  const cached = peekSlice(url);
  if (cached) return Promise.resolve(cached);

  if (isDemoDecodeUrl(url)) {
    return demoDecoder().then((mod) => mod.decodeDemoImage(url, { priority }));
  }
  if (isUploadDecodeUrl(url)) {
    return uploadDecoder().then((mod) => mod.decodeUploadImage(url));
  }
  return fetchAndDecodeApiImage(url, priority);
}

/**
 * Warms a slice in background without waiting for it.
 */
export function prefetchSlice(url: string, priority: number): void {
  if (!isDecodableUrl(url)) return;
  void loadSlice(url, priority).catch(() => {});
}

/**
 * Drops one caller's claim on a slice.
 */
export function releaseSlice(url: string): void {
  if (isDemoDecodeUrl(url)) {
    void demoDecoder().then((mod) => mod.releaseDemoImage(url));
    return;
  }
  sliceNetworkQueue.release(url);
}

