/**
 * ---------------------------------------------------------------------------
 * CLIENT-SIDE DEMO DECODER
 * ---------------------------------------------------------------------------
 * The deployed Cloudflare Worker has no filesystem and no `SCANLAB_DATA_ROOT`,
 * so `/api/studies/<id>/images/...` — which reads DICOM and NIfTI off disk and
 * returns a PNG — has nothing to read from. For the studies committed under
 * `public/demo-data` the pixels are static assets instead, and this module is
 * the renderer: it does in the browser what `lib/dataset/image-render.ts` does
 * on the server, for the two container formats those assets are in.
 *
 * It is deliberately a mirror rather than a reimplementation. The DICOM
 * windowing and the NIfTI reslice below follow `renderDicom` and `resliceToPng`
 * step for step, and the two things that would be easy to get subtly different —
 * the datatype mapping and the volume-wide display window — are not recomputed
 * here at all: `niftiTypedArray` is imported from the shared module, and the
 * window is the server's own `computeVolumeWindow` output, measured at index
 * time and carried in `index.json`. So a demo slice and an indexed slice of the
 * same volume come out the same, and no modality preset or invented window
 * setting exists on either path.
 *
 * Browser-only (canvas, fetch), but imported from client components only, so it
 * never lands in a server bundle.
 * ---------------------------------------------------------------------------
 */

import * as dicomParser from "dicom-parser";
import * as nifti from "nifti-reader-js";
import { niftiTypedArray, VoxelArray } from "../dataset/nifti-voxels";
import {
  ctPerfDecoded,
  ctPerfFetched,
  ctPerfRequestStart,
} from "../viewer/perf";
import { PRIORITY, sliceNetworkQueue, slicePixelQueue } from "../viewer/request-queue";
import { DecodedImage, peekSlice, putSlice } from "../viewer/slice-cache";
import { lookupVolume } from "./registry";
import {
  DEMO_DICOM_PARAM,
  DEMO_FRAME_PARAM,
  DEMO_NIFTI_PARAM,
  DEMO_PLANE_PARAM,
  DEMO_WIDTH_PARAM,
  DemoAxis,
  demoPlaneFromCode,
  DemoPlane,
  DemoPlaneGeometry,
  DemoVolume,
} from "./types";

/** Matches `MIN_FULL_EDGE` (SCANLAB_RENDER_MIN_EDGE) so a demo render is the same size as an indexed one. */
const MIN_FULL_EDGE = 512;

export type { DecodedImage };

interface DemoRequest {
  /** The asset URL with the decode markers stripped — what actually gets fetched. */
  assetUrl: string;
  kind: "dicom" | "nifti";
  volumeKey?: string;
  /** Which plane of the volume to reconstruct. Ignored for DICOM. */
  plane: DemoPlane;
  frame: number;
  maxEdge?: number;
}

/**
 * Splits a slice URL into the asset to fetch and the decode instructions.
 *
 * Returns undefined for an ordinary raster URL, which is the signal to leave it
 * to the browser — a committed chest X-ray PNG needs none of this.
 */
export function parseDemoUrl(url: string): DemoRequest | undefined {
  const q = url.indexOf("?");
  if (q < 0) return undefined;

  const params = new URLSearchParams(url.slice(q + 1));
  const path = url.slice(0, q);
  const widthParam = Number(params.get(DEMO_WIDTH_PARAM));
  const maxEdge = Number.isFinite(widthParam) && widthParam > 0 ? widthParam : undefined;

  if (params.get(DEMO_DICOM_PARAM) === "1") {
    return { assetUrl: path, kind: "dicom", plane: "Axial", frame: 0, maxEdge };
  }

  const volumeKey = params.get(DEMO_NIFTI_PARAM);
  if (volumeKey) {
    const frame = Number(params.get(DEMO_FRAME_PARAM) ?? 0);
    return {
      assetUrl: path,
      kind: "nifti",
      volumeKey,
      // An absent or unrecognized code means the volume's own acquired plane is
      // the only sensible reading, and the generator writes Axial for that case.
      plane: demoPlaneFromCode(params.get(DEMO_PLANE_PARAM)) ?? "Axial",
      frame: Number.isFinite(frame) ? Math.max(0, Math.trunc(frame)) : 0,
      maxEdge,
    };
  }

  return undefined;
}

/**
 * ---------------------------------------------------------------------------
 * CACHES
 * ---------------------------------------------------------------------------
 * Decoded slices live in the shared LRU in `lib/viewer/slice-cache.ts`. The two
 * here are the intermediate results, for two different costs.
 *
 * `bytesCache` holds the DICOM files themselves, and exists because one slice is
 * asked for at two sizes: the filmstrip wants it at `?w=96` and the viewer wants
 * it full size, and those are different slice-cache keys over the *same* 515 KB
 * download. Without this, visiting a slice fetched it twice.
 *
 * `volumeCache` holds decoded voxel arrays, which is the expensive one:
 * inflating a 3–5 MB gzipped NIfTI per slice would mean re-inflating the same
 * volume for all 512 frames of a plane. Two entries mirrors the server's
 * `VOLUME_CACHE_MAX` and covers "scrolling one study, occasionally flipping to
 * its second series".
 *
 * Only DICOM instances go in `bytesCache`. A NIfTI archive is useless once it has
 * been inflated into `volumeCache`, and one of them would evict sixty CT slices.
 */
const VOLUME_CACHE_MAX = 2;

/**
 * Byte budget for the raw file cache.
 *
 * 32 MB is a little over sixty CT instances at 515 KB — comfortably more than
 * the preload window plus the filmstrip, so a scroll back and forth across the
 * same region re-decodes without re-downloading, while a long one-directional
 * sweep evicts what it has left behind. Bounded by total bytes rather than by
 * entry count, because a CT instance and a NIfTI archive differ by two orders of
 * magnitude in size.
 */
const BYTES_CACHE_MAX = 32 * 1024 * 1024;

const volumeCache = new Map<string, DecodedVolume>();
const bytesCache = new Map<string, ArrayBuffer>();
let bytesCacheSize = 0;

/**
 * One slice's work, while it is in flight.
 *
 * This is the deduplication layer: two callers asking for the same slice URL —
 * which happens constantly, because the filmstrip and the preloader overlap —
 * share one record and one promise. `consumers` counts how many of them still
 * want it, so the last one to let go is the one that cancels; `priority` is the
 * best band anybody has asked for, and raising it is what lets a slice that was
 * queued as a background preload jump ahead when it becomes the slice on screen.
 *
 * Records live only until the decode settles. After that the pixels are in the
 * shared slice cache and there is nothing left to cancel or reprioritise.
 */
interface Inflight {
  promise: Promise<DecodedImage>;
  /** Key this slice's bytes are queued under — shared by its thumbnail and its full-size render. */
  netKey: string;
  priority: number;
  consumers: number;
}

const inflight = new Map<string, Inflight>();

interface DecodedVolume {
  data: VoxelArray;
  dims: [number, number, number];
  slope: number;
  inter: number;
  win: { lo: number; range: number };
}

function touch<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** Options a caller can attach to a slice request. */
export interface DecodeOptions {
  /**
   * Scheduling band, from `PRIORITY`. Defaults to `current`, so a caller that
   * does not care keeps exactly the standing it had when every request was
   * equally urgent.
   */
  priority?: number;
}

/**
 * Decodes one demo slice URL to something an `<img>` can display.
 *
 * Rejects rather than returning a placeholder: the caller decides what a failed
 * slice looks like, and silently substituting anything for medical pixels would
 * be the wrong default.
 *
 * The work is scheduled rather than started, in two stages. `sliceNetworkQueue`
 * bounds how many slices are downloading at once; `slicePixelQueue` then runs the
 * decodes one at a time so a burst of them cannot lock React out of the main
 * thread. Both are ordered by priority, which is how the slice on screen
 * overtakes the thirteen filmstrip tiles that used to be its equals.
 */
export function decodeDemoImage(url: string, opts: DecodeOptions = {}): Promise<DecodedImage> {
  const priority = opts.priority ?? PRIORITY.current;

  const cached = peekSlice(url);
  if (cached) {
    ctPerfRequestStart(url, priority, true);
    return Promise.resolve(cached);
  }

  const req = parseDemoUrl(url);
  if (!req) return Promise.reject(new Error("Not a demo-decoded URL"));

  ctPerfRequestStart(url, priority, false);

  const running = inflight.get(url);
  if (running) {
    running.consumers++;
    if (priority < running.priority) {
      running.priority = priority;
      sliceNetworkQueue.raise(running.netKey, priority);
      slicePixelQueue.raise(url, priority);
    }
    return running.promise;
  }

  const netKey = netKeyFor(req);
  const record: Inflight = { promise: undefined as unknown as Promise<DecodedImage>, netKey, priority, consumers: 1 };

  record.promise = runSlice(url, req, record).finally(() => {
    if (inflight.get(url) === record) inflight.delete(url);
  });

  /*
   * A prefetch that is dropped before it starts rejects with an AbortError, and a
   * caller that never awaited it must not turn that into an unhandled rejection.
   * Anyone holding this promise still receives the rejection themselves.
   */
  record.promise.catch(() => {});

  inflight.set(url, record);
  return record.promise;
}

/**
 * Drops one caller's interest in a slice.
 *
 * The preloader calls this when a slice leaves its window and the filmstrip calls
 * it when a tile scrolls out of view. When the last interested caller lets go of
 * a slice whose work has not started yet, that work is dropped — which is the
 * point: jumping from slice 17 to slice 300 must not leave the queue holding 280
 * slices nobody is looking at any more, ahead of the one they are.
 *
 * Work already in flight is left to finish. Half-downloaded bytes still land in
 * `bytesCache`, and re-fetching them later would cost more than the slot does.
 * A decoded slice is unaffected — it is in the shared slice cache, there is
 * nothing to cancel — so a caller that never releases behaves exactly as it did
 * before.
 */
export function releaseDemoImage(url: string): void {
  const record = inflight.get(url);
  if (!record) return;

  record.consumers--;
  if (record.consumers > 0) return;

  inflight.delete(url);
  sliceNetworkQueue.release(record.netKey);
  slicePixelQueue.release(url);
}

/** Byte-cache and network-queue key: the asset, plus the archive member for a NIfTI frame. */
function netKeyFor(req: DemoRequest): string {
  if (req.kind === "dicom") return req.assetUrl;
  const zip = lookupVolume(req.volumeKey ?? "")?.zip;
  return zip ? `${req.assetUrl}#${zip.off}+${zip.len}` : req.assetUrl;
}

function perfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Fetch, then decode, each in its own queue.
 *
 * The split is the important part. Decoding inside the network queue's slot would
 * hold a connection open across a 20 ms main-thread block, and fetching inside the
 * pixel queue's single slot would serialise the downloads to one at a time —
 * either way the preloader stops being able to keep ahead of a scroll.
 */
async function runSlice(url: string, req: DemoRequest, record: Inflight): Promise<DecodedImage> {
  const bytes = await loadSliceBytes(url, req, record);

  /*
   * The last consumer let go while the bytes were on the wire. The download was
   * still worth finishing — it is cached now — but decoding it is not.
   */
  if (inflight.get(url) !== record) {
    throw new DOMException("Slice no longer needed", "AbortError");
  }

  return slicePixelQueue.run(url, record.priority, async () => {
    const started = perfNow();
    const image =
      req.kind === "dicom"
        ? await decodeDicomBytes(new Uint8Array(bytes!), req.maxEdge)
        : await decodeNiftiSlice(req, bytes);
    ctPerfDecoded(url, record.priority, perfNow() - started);
    return putSlice(url, image);
  });
}

/**
 * The bytes this slice needs, or undefined when it needs none.
 *
 * Undefined is the NIfTI case where the volume is already inflated in
 * `volumeCache`: reconstructing another plane of a study already on screen costs
 * a reslice and no network at all.
 *
 * The queue key is the asset rather than the slice URL, so the `?w=96` filmstrip
 * tile and the full-size viewer image of one instance share a single 515 KB
 * download instead of racing each other for it.
 */
async function loadSliceBytes(url: string, req: DemoRequest, record: Inflight): Promise<ArrayBuffer | undefined> {
  if (req.kind === "nifti" && volumeCache.has(req.volumeKey ?? "")) return undefined;

  const cached = touch(bytesCache, record.netKey);
  if (cached) {
    ctPerfFetched(url, 0, true, cached.byteLength);
    return cached;
  }

  const range = req.kind === "nifti" ? lookupVolume(req.volumeKey ?? "")?.zip : undefined;
  const started = perfNow();
  const buffer = await sliceNetworkQueue.run(record.netKey, record.priority, (signal) =>
    fetchBytes(req.assetUrl, range, signal)
  );
  ctPerfFetched(url, perfNow() - started, false, buffer.byteLength);

  // NIfTI archives are deliberately not cached: once inflated into `volumeCache`
  // the compressed bytes are dead weight, and one of them evicts sixty CT slices.
  if (req.kind === "dicom") putBytes(record.netKey, buffer);
  return buffer;
}

function putBytes(key: string, value: ArrayBuffer): void {
  if (value.byteLength > BYTES_CACHE_MAX) return;

  const existing = bytesCache.get(key);
  if (existing) bytesCacheSize -= existing.byteLength;
  bytesCache.set(key, value);
  bytesCacheSize += value.byteLength;

  while (bytesCacheSize > BYTES_CACHE_MAX) {
    const oldest = bytesCache.keys().next();
    if (oldest.done) break;
    const evicted = bytesCache.get(oldest.value);
    bytesCache.delete(oldest.value);
    bytesCacheSize -= evicted?.byteLength ?? 0;
  }
}

async function fetchBytes(
  url: string,
  range?: { off: number; len: number },
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: range ? { Range: `bytes=${range.off}-${range.off + range.len - 1}` } : undefined,
    signal,
  });
  if (!res.ok) throw new Error(`Failed to load ${url} (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();

  /*
   * A 200 to a ranged request means the server ignored `Range` and sent the
   * whole archive. Slicing locally is correct either way, and costs nothing when
   * the range was honoured (a 206 arrives already trimmed).
   */
  if (range && buf.byteLength > range.len) {
    return buf.slice(range.off, range.off + range.len);
  }
  return buf;
}


/**
 * Nearest-neighbour downscale to `maxEdge`, mirroring the server's own
 * post-render resize step.
 *
 * The DICOM path is the one that needs it: a `?w=96` filmstrip tile would
 * otherwise decode and hold a full 512×512 blob, thirteen tiles at a time. The
 * NIfTI path has already applied the cap while resampling in `outputSize`, so
 * this is a no-op there rather than a second resize.
 */
function downscaleGray(
  gray: Uint8Array,
  width: number,
  height: number,
  maxEdge?: number
): { gray: Uint8Array; width: number; height: number } {
  const [w, h] = fitEdge(width, height, maxEdge);
  if (w === width && h === height) return { gray, width, height };

  const out = new Uint8Array(w * h);
  for (let oy = 0; oy < h; oy++) {
    const sy = Math.min(height - 1, Math.floor((oy * height) / h));
    for (let ox = 0; ox < w; ox++) {
      const sx = Math.min(width - 1, Math.floor((ox * width) / w));
      out[oy * w + ox] = gray[sy * width + sx];
    }
  }
  return { gray: out, width: w, height: h };
}

/**
 * Turns a grayscale byte plane into an object URL via canvas.
 *
 * PNG on the server, whatever `toBlob` gives us here — the pixels are what
 * matter, and both paths hand an `<img>` a lossless single-channel image.
 *
 * Exported because `lib/uploads/decode.ts` renders uploaded pixels the same way.
 * An uploaded slice and a demo slice going through one encoder is the point:
 * two of these would drift.
 */
export function grayToObjectUrl(
  grayIn: Uint8Array,
  widthIn: number,
  heightIn: number,
  maxEdge?: number
): Promise<DecodedImage> {
  const { gray, width, height } = downscaleGray(grayIn, widthIn, heightIn, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas 2D context unavailable"));

  const rgba = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = gray[i];
    const o = i * 4;
    rgba.data[o] = v;
    rgba.data[o + 1] = v;
    rgba.data[o + 2] = v;
    rgba.data[o + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode decoded slice"));
        return;
      }
      resolve({ objectUrl: URL.createObjectURL(blob), width, height });
    }, "image/png");
  });
}

/** Scales a width/height pair down to `maxEdge` while preserving aspect ratio — mirrors `fitEdge`. */
function fitEdge(width: number, height: number, maxEdge?: number): [number, number] {
  const longest = Math.max(width, height);
  if (!maxEdge || longest <= maxEdge) return [width, height];
  const scale = maxEdge / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Mirrors `outputSize`: upscale small planes to a usable edge, or honour an explicit cap. */
function outputSize(width: number, height: number, maxEdge?: number): [number, number] {
  if (maxEdge) return fitEdge(width, height, maxEdge);
  const longest = Math.max(width, height);
  if (longest >= MIN_FULL_EDGE) return [width, height];
  const scale = MIN_FULL_EDGE / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

// ---------------------------------------------------------------------------
// DICOM — mirrors `renderDicom`
// ---------------------------------------------------------------------------

/**
 * Decodes one uncompressed DICOM instance.
 *
 * The committed CT studies were measured to be Transfer Syntax
 * 1.2.840.10008.1.2.1 (Explicit VR little-endian, no encapsulation) with
 * BitsAllocated 16, which is why reading the pixel element as a typed array
 * works without a JPEG/JPEG2000 codec in the browser. A compressed instance
 * would land in `catch` as an unreadable slice rather than silently rendering
 * garbage.
 *
 * When `maxEdge` asks for a smaller image than the instance holds, the windowing
 * pass writes straight into the reduced plane instead of filling a full-size one
 * and shrinking it afterwards. For a 96 px filmstrip tile that is 1/28th of the
 * work — 2,304 windowed pixels instead of 262,144 — and it is the difference
 * between a decode that blocks the main thread for 13 ms and one that takes 1.4.
 *
 * The pixels are unchanged by that shortcut. Nearest-neighbour sampling picks
 * whole source pixels and the window map is applied per pixel, so choosing first
 * and mapping second gives the same bytes as mapping first and choosing second;
 * checked against the previous implementation over real CT instances at maxEdge
 * 96, 128, 256 and full size, with zero differing pixels. The display window
 * itself is still measured over the whole full-resolution image, so a tile and
 * its full-size slice cannot come out at different brightnesses.
 *
 * Exported for `lib/uploads/decode.ts`, which has the same bytes from IndexedDB
 * rather than from a fetch. `frame` is for a multi-frame instance — a cine loop
 * or an enhanced object, which an upload can be and a demo asset never is.
 */
export async function decodeDicomBytes(bytes: Uint8Array, maxEdge?: number, frame = 0): Promise<DecodedImage> {
  const dataSet = dicomParser.parseDicom(bytes);

  const rows = dataSet.uint16("x00280010") ?? 0;
  const columns = dataSet.uint16("x00280011") ?? 0;
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const pixelRepresentation = dataSet.uint16("x00280103") ?? 0; // 0 = unsigned, 1 = signed
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const photometric = dataSet.string("x00280004") ?? "MONOCHROME2";
  const rescaleSlope = dataSet.floatString("x00281053") ?? 1;
  const rescaleIntercept = dataSet.floatString("x00281052") ?? 0;
  let windowCenter = dataSet.floatString("x00281050");
  let windowWidth = dataSet.floatString("x00281051");

  const pixelElement = dataSet.elements.x7fe00010;
  if (!rows || !columns || !pixelElement) throw new Error("DICOM file has no usable pixel data");

  const byteArray = dataSet.byteArray as Uint8Array;
  const pixelCount = rows * columns * samplesPerPixel;

  /*
   * Frames sit back to back in the pixel element, so the nth one starts n frame
   * lengths in. The index is clamped to what the element actually holds: a frame
   * past the end would otherwise read whatever bytes follow it.
   */
  const bytesPerSample = samplesPerPixel >= 3 ? 1 : bitsAllocated === 8 ? 1 : 2;
  const frameBytes = pixelCount * bytesPerSample;
  const available = Math.max(1, Math.floor((pixelElement.length || frameBytes) / frameBytes));
  const offset = pixelElement.dataOffset + Math.min(Math.max(0, Math.trunc(frame)), available - 1) * frameBytes;

  /**
   * Reads source pixel `i` in modality units. One indirection per pixel, chosen
   * once per image, in place of a 2 MB `Float64Array` copy of the whole plane.
   */
  let valueAt: (i: number) => number;
  if (samplesPerPixel >= 3) {
    // RGB/YBR — converted to 8-bit luma for a consistent single-channel viewer.
    const buf = byteArray.subarray(offset, offset + pixelCount);
    valueAt = (i) => 0.299 * (buf[i * 3] ?? 0) + 0.587 * (buf[i * 3 + 1] ?? 0) + 0.114 * (buf[i * 3 + 2] ?? 0);
    windowCenter = windowCenter ?? 128;
    windowWidth = windowWidth ?? 256;
  } else if (bitsAllocated === 8) {
    const buf = byteArray.subarray(offset, offset + pixelCount);
    valueAt = (i) => buf[i] * rescaleSlope + rescaleIntercept;
  } else {
    const view =
      pixelRepresentation === 1
        ? new Int16Array(byteArray.buffer, byteArray.byteOffset + offset, pixelCount)
        : new Uint16Array(byteArray.buffer, byteArray.byteOffset + offset, pixelCount);
    valueAt = (i) => view[i] * rescaleSlope + rescaleIntercept;
  }

  // No window in the file: a full min/max stretch of THIS image's real pixel
  // values — never a fabricated "typical" window for the modality. Measured over
  // every pixel, not over the reduced plane, so the window is a property of the
  // image rather than of the size it happens to be requested at.
  if (windowCenter === undefined || windowWidth === undefined || windowWidth <= 0) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < rows * columns; i++) {
      const v = valueAt(i);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    windowCenter = (min + max) / 2;
    windowWidth = Math.max(1, max - min);
  }

  const lo = windowCenter - windowWidth / 2;
  const scale = 255 / windowWidth;
  const invert = photometric === "MONOCHROME1";

  // Output size up front, so the window pass fills the plane that is actually
  // wanted. `fitEdge` is the same mapping `downscaleGray` uses, and the row/column
  // arithmetic below is its nearest-neighbour rule.
  const [width, height] = fitEdge(columns, rows, maxEdge);
  const gray = new Uint8Array(width * height);

  for (let oy = 0; oy < height; oy++) {
    const sourceRow = (height === rows ? oy : Math.min(rows - 1, Math.floor((oy * rows) / height))) * columns;
    const outRow = oy * width;
    for (let ox = 0; ox < width; ox++) {
      const sx = width === columns ? ox : Math.min(columns - 1, Math.floor((ox * columns) / width));
      let v = Math.round((valueAt(sourceRow + sx) - lo) * scale);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      gray[outRow + ox] = invert ? 255 - v : v;
    }
  }

  return grayToObjectUrl(gray, width, height);
}

// ---------------------------------------------------------------------------
// NIfTI — mirrors `loadVolume` + `resliceToPng`
// ---------------------------------------------------------------------------

/**
 * Inflates one NIfTI archive into voxels, or returns the copy already in cache.
 *
 * `bytes` is undefined exactly when the volume is cached, because the caller
 * skipped the download in that case — reconstructing a second plane of a series
 * already on screen is pure arithmetic.
 */
function demoVolume(key: string, volume: DemoVolume, bytes: ArrayBuffer | undefined): DecodedVolume {
  const cached = touch(volumeCache, key);
  if (cached) return cached;
  if (!bytes) throw new Error("Volume bytes are unavailable");

  // `nifti-reader-js` inflates through pure-JS `fflate`, so this works in the
  // browser exactly as it does in Node.
  let buf = bytes;
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) throw new Error("Not a valid NIfTI file");

  const header = nifti.readHeader(buf) as unknown as { datatypeCode: number } | null;
  if (!header) throw new Error("NIfTI header could not be read");

  const decoded: DecodedVolume = {
    // Shared with the server renderer, so both agree on the element type.
    data: niftiTypedArray(volume.datatype ?? header.datatypeCode, nifti.readImage(header as never, buf)),
    dims: volume.dims,
    slope: volume.slope || 1,
    inter: volume.inter || 0,
    // Measured server-side over the whole volume at index time. Recomputing it
    // here would mean a percentile histogram over every voxel in the browser,
    // and any disagreement would show up as a brightness jump between a demo
    // slice and the same slice rendered by the API route.
    win: volume.win,
  };

  volumeCache.set(key, decoded);
  while (volumeCache.size > VOLUME_CACHE_MAX) {
    const oldest = volumeCache.keys().next();
    if (oldest.done) break;
    volumeCache.delete(oldest.value);
  }
  return decoded;
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(value)));
}

/** Screen axes are defined in display order; a flipped axis is walked from the far end. */
function resolveIndex(i: number, n: number, flip: boolean): number {
  return flip ? n - 1 - i : i;
}

interface AxisSamples {
  a: Int32Array;
  b: Int32Array;
  w: Float64Array;
}

/**
 * Source offsets and interpolation weights for one output axis — mirrors
 * `sampleAxis`. Output centres map to `(o + 0.5) * n / out - 0.5`, so a 1:1 axis
 * lands on `w = 0` and an unscaled acquired plane comes out identical to a
 * nearest-neighbour read.
 */
function sampleAxis(out: number, n: number, flip: boolean, stride: number): AxisSamples {
  const a = new Int32Array(out);
  const b = new Int32Array(out);
  const w = new Float64Array(out);
  for (let o = 0; o < out; o++) {
    const s = ((o + 0.5) * n) / out - 0.5;
    const i0 = Math.floor(s);
    const frac = s - i0;
    a[o] = resolveIndex(clampInt(i0, 0, n - 1), n, flip) * stride;
    b[o] = resolveIndex(clampInt(i0 + 1, 0, n - 1), n, flip) * stride;
    w[o] = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  }
  return { a, b, w };
}

function axisOf(ref: DemoAxis): 0 | 1 | 2 {
  return ref[0];
}

function flipOf(ref: DemoAxis): boolean {
  return ref[1];
}

/**
 * Bilinear reslice of one plane at one through-index — the browser half of
 * `resliceToPng`.
 *
 * The three screen axes come from `index.json`, where they were derived from the
 * volume's own affine by the server's `readNiftiGeometry`. That is the reason
 * this function contains no matrix maths: the orientation question was answered
 * once, at index time, by the same code that answers it for indexed studies.
 *
 * Interpolation is strictly in-plane and adds no information — it replaces
 * blocky replicated rows with a linear ramp between the same two measured
 * samples. On a reconstructed plane of a thick-slice acquisition most rows are
 * interpolated rather than measured, which is why the series label carries the
 * through-plane thickness.
 */
function reslice(volume: DecodedVolume, p: DemoPlaneGeometry, throughIndex: number, maxEdge?: number) {
  const { data, dims, slope, inter, win } = volume;
  const strides: [number, number, number] = [1, dims[0], dims[0] * dims[1]];

  const through = axisOf(p.t);
  const horizontal = axisOf(p.h);
  const vertical = axisOf(p.v);

  const index = clampInt(throughIndex, 0, p.n - 1);
  const baseOffset = resolveIndex(index, dims[through], flipOf(p.t)) * strides[through];

  const [width, height] = outputSize(p.w, p.ht, maxEdge);
  const cols = sampleAxis(width, dims[horizontal], flipOf(p.h), strides[horizontal]);
  const rows = sampleAxis(height, dims[vertical], flipOf(p.v), strides[vertical]);

  const lo = win.lo;
  const range = Math.max(1e-6, win.range);
  const gray = new Uint8Array(width * height);

  for (let oy = 0; oy < height; oy++) {
    const rowA = baseOffset + rows.a[oy];
    const rowB = baseOffset + rows.b[oy];
    const wy = rows.w[oy];
    const outRow = oy * width;
    for (let ox = 0; ox < width; ox++) {
      const ca = cols.a[ox];
      const cb = cols.b[ox];
      const wx = cols.w[ox];
      const aa = data[rowA + ca] ?? 0;
      const ab = data[rowA + cb] ?? 0;
      const ba = data[rowB + ca] ?? 0;
      const bb = data[rowB + cb] ?? 0;
      const top = aa + (ab - aa) * wx;
      const bot = ba + (bb - ba) * wx;
      const value = (top + (bot - top) * wy) * slope + inter;

      let v = Math.round(((value - lo) / range) * 255);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      gray[outRow + ox] = v;
    }
  }

  return { gray, width, height };
}

async function decodeNiftiSlice(req: DemoRequest, bytes: ArrayBuffer | undefined): Promise<DecodedImage> {
  const key = req.volumeKey ?? "";
  const volume = lookupVolume(key);
  if (!volume) {
    // The URL was built against an index this page never loaded — a stale
    // bookmark, or a URL and an index from different builds.
    throw new Error("Unknown demo volume");
  }

  const geometry = volume.planes[req.plane];
  if (!geometry || geometry.n < 1) {
    throw new Error(`This volume has no ${req.plane.toLowerCase()} extent, so that plane cannot be reconstructed`);
  }

  const decoded = demoVolume(key, volume, bytes);
  const { gray, width, height } = reslice(decoded, geometry, req.frame, req.maxEdge);
  return grayToObjectUrl(gray, width, height);
}


