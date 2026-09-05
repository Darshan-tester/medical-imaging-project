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
  DEMO_MIN_STACK_SLICES,
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
 * volume for all 512 frames of a plane.
 *
 * Only DICOM instances go in `bytesCache`. A NIfTI archive is useless once it has
 * been inflated into `volumeCache`, and one of them would evict sixty CT slices.
 */

/**
 * Byte budget for decoded volumes.
 *
 * Bounded by bytes and not by entry count, because a study's series list is not a
 * list of volumes: MRI-16B80D is 12 series over 4 volumes, MRI-76AED8 is 15 over
 * 5, and a PET study is 3 over 1. The old limit of two entries meant that walking
 * down that series list evicted a volume the reader was about to come back to,
 * and since NIfTI archives are deliberately absent from `bytesCache` above,
 * coming back paid the entire round trip again. Measured against the committed
 * corpus: 3.4–4.8 MB over the network plus 102–147 ms of synchronous inflate,
 * before the first pixel of the newly selected series.
 *
 * 64 MB holds every volume of every study in the corpus at once — the largest,
 * MRI-76AED8, is 58.0 MB of `Uint16`; a PET volume is 29.9 MB of `Float32` —
 * so flipping between the series of one study now costs one reslice.
 */
const VOLUME_CACHE_MAX_BYTES = 64 * 1024 * 1024;

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
  const plane = dicomGrayPlane(bytes, maxEdge, frame);
  return grayToObjectUrl(plane.gray, plane.width, plane.height);
}

/**
 * One instance as an 8-bit plane, plus the header facts needed to place it in
 * space. This is the whole of the decode; `decodeDicomBytes` is the PNG wrapper
 * around it and `loadDemoCtVolume8` is the stacking one.
 *
 * `forceWindow` exists for the stacking caller. Every slice of a series has to be
 * mapped through the *same* window or the 3-D field is a montage of differently
 * exposed planes — a bright plane every few slices where an instance happened to
 * carry a narrower window. It also skips the min/max scan, which is a second full
 * pass over the image.
 *
 * The geometry fields are read, never guessed: an instance without
 * `PixelSpacing` leaves it undefined and the caller falls back to square voxels
 * rather than to a plausible-sounding millimetre figure.
 */
interface DicomPlane {
  gray: Uint8Array;
  /** Size of `gray`, after any `maxEdge` reduction. */
  width: number;
  height: number;
  /** The acquired grid, before that reduction. */
  rows: number;
  columns: number;
  /** Stored-value window mapped onto 0-255, as `[lo, hi]`. HU for CT — the rescale is applied first. */
  window: [number, number];
  /** `PixelSpacing` (0028,0030), as `[betweenRows, betweenColumns]` in mm. */
  pixelSpacing?: [number, number];
  /** `ImagePositionPatient` (0020,0032) — where this plane sits, for measuring slice separation. */
  position?: [number, number, number];
  /** `SpacingBetweenSlices` (0018,0088), else `SliceThickness` (0018,0050), in mm. */
  nominalGap?: number;
}

function dicomGrayPlane(
  bytes: Uint8Array,
  maxEdge?: number,
  frame = 0,
  forceWindow?: [number, number]
): DicomPlane {
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
  if (forceWindow) {
    windowCenter = (forceWindow[0] + forceWindow[1]) / 2;
    windowWidth = Math.max(1e-6, forceWindow[1] - forceWindow[0]);
  } else if (windowCenter === undefined || windowWidth === undefined || windowWidth <= 0) {
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

  const rowSpacing = dataSet.floatString("x00280030", 0);
  const colSpacing = dataSet.floatString("x00280030", 1);
  const px = dataSet.floatString("x00200032", 0);
  const py = dataSet.floatString("x00200032", 1);
  const pz = dataSet.floatString("x00200032", 2);

  return {
    gray,
    width,
    height,
    rows,
    columns,
    window: [lo, lo + windowWidth],
    pixelSpacing:
      rowSpacing !== undefined && colSpacing !== undefined && rowSpacing > 0 && colSpacing > 0
        ? [rowSpacing, colSpacing]
        : undefined,
    position:
      px !== undefined && py !== undefined && pz !== undefined ? [px, py, pz] : undefined,
    nominalGap: dataSet.floatString("x00180088") ?? dataSet.floatString("x00180050"),
  };
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
  evictVolumes();
  return decoded;
}

/**
 * Drops least-recently-used volumes until the cache is inside its byte budget.
 *
 * `touch` re-inserts on every read, so `Map` insertion order is least-recently-used
 * first. The newest entry is never evicted: a volume larger than the whole budget
 * is still usable, it just stands alone rather than being dropped the instant it
 * arrives and re-inflated on the next slice.
 */
function evictVolumes(): void {
  let total = 0;
  for (const v of volumeCache.values()) total += v.data.byteLength;

  for (const key of [...volumeCache.keys()]) {
    if (total <= VOLUME_CACHE_MAX_BYTES || volumeCache.size <= 1) return;
    const victim = volumeCache.get(key);
    if (!victim) continue;
    volumeCache.delete(key);
    total -= victim.data.byteLength;
  }
}

// ---------------------------------------------------------------------------
// 8-bit scalar fields, for the 3-D view
// ---------------------------------------------------------------------------

/** Exactly what `Volume3DViewer` needs to build its 3-D texture, with no server route involved. */
export interface DemoVolume8 {
  data: Uint8Array;
  dims: [number, number, number];
  /** Relative voxel size per axis. Only the ratios matter — the mesh normalises them. */
  spacing: [number, number, number];
  /** The stored-intensity window that was mapped onto 0–255, as `[lo, hi]`. */
  window: [number, number];
}

/**
 * The most recent 8-bit field, and only that one.
 *
 * The three planes of a volume are three *series*, so switching plane while the
 * 3-D view is open re-runs the loader — for a field that would come out
 * byte-identical, because a 3-D volume has no plane. One entry turns that into a
 * lookup, and also covers toggling 2-D → 3-D → 2-D → 3-D. Deliberately not an LRU:
 * this is derived data on top of the voxels, and holding several copies of it
 * would eat the volume budget twice over.
 */
let lastVolume8: { key: string; value: DemoVolume8 } | undefined;

/**
 * Builds the 3-D scalar field for one committed NIfTI series, in the browser.
 *
 * `/api/studies/<id>/volume/<seriesId>` reads a DICOM stack off disk, which the
 * deployed Worker has none of — that is why the 3-D toggle was hidden for demo
 * studies. This is the demo equivalent and it needs no route at all, because the
 * volume is already the thing the 2-D planes are cut from: same inflate, same
 * cache entry, same window. Opening the 3-D view on a series the reader has been
 * scrolling costs no network and no second decode.
 *
 * Every voxel is a stored value put through the volume's own slope/intercept and
 * its index-time display window. Nothing is smoothed, sharpened, interpolated or
 * filled in; the 8-bit quantisation is the only loss, and it is the same one the
 * server route applies. Unlike the server route there is no decimation, so the
 * field is the full acquired grid.
 */
export async function loadDemoVolume8(url: string): Promise<DemoVolume8> {
  const req = parseDemoUrl(url);
  if (!req || req.kind !== "nifti" || !req.volumeKey) {
    throw new Error("This series is not reconstructed from a volume");
  }

  const volume = lookupVolume(req.volumeKey);
  if (!volume) throw new Error("This series' volume is not in the index this page loaded");

  const key = req.volumeKey;
  if (lastVolume8?.key === key) return lastVolume8.value;

  let decoded = touch(volumeCache, key);
  if (!decoded) {
    const bytes = await sliceNetworkQueue.run(netKeyFor(req), PRIORITY.current, (signal) =>
      fetchBytes(req.assetUrl, volume.zip, signal)
    );
    // Through the pixel queue so a ~130 ms inflate cannot land in the middle of a
    // slice decode; `demoVolume` re-checks the cache, so a slice that inflated the
    // same volume while this was queued is reused rather than repeated.
    decoded = await slicePixelQueue.run(`volume3d:${key}`, PRIORITY.current, () =>
      Promise.resolve(demoVolume(key, volume, bytes))
    );
  }

  const [nx, ny, nz] = decoded.dims;
  const { data, slope, inter, win } = decoded;
  const range = Math.max(1e-6, win.range);
  const axes = volumeAxes(volume, decoded.dims);
  const out = new Uint8Array(nx * ny * nz);

  for (let z = 0; z < nz; z++) {
    const sz = axes.flip[2] ? nz - 1 - z : z;
    for (let y = 0; y < ny; y++) {
      const sy = axes.flip[1] ? ny - 1 - y : y;
      const src = (sz * ny + sy) * nx;
      const dst = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        const value = (data[src + (axes.flip[0] ? nx - 1 - x : x)] ?? 0) * slope + inter;
        let v = Math.round(((value - win.lo) / range) * 255);
        if (v < 0) v = 0;
        if (v > 255) v = 255;
        out[dst + x] = v;
      }
    }
  }

  const value: DemoVolume8 = {
    data: out,
    dims: [nx, ny, nz],
    spacing: axes.spacing,
    window: [win.lo, win.lo + win.range],
  };
  lastVolume8 = { key, value };
  return value;
}

/**
 * Per-axis voxel size and display direction, read off the plane geometries the
 * indexer already derived from the volume's affine.
 *
 * A plane's output height is its vertical axis's physical extent expressed in
 * in-plane pixels — which is precisely why the coronal cut of a 512×512×22 axial
 * volume is 338 rows tall and not 22. So `ht / dims[v]` is that axis's size in
 * those same units, and `w / dims[h]` likewise. Between the three planes every
 * axis appears as a horizontal or a vertical at least once, and an axis that
 * somehow does not falls back to 1.
 *
 * The flips are the ones the 2-D reslice uses, so the two views walk each axis in
 * the same direction and a structure does not appear mirrored when the reader
 * switches to 3-D. This is display consistency, not a claim about which side of
 * the render is the patient's left — that needs the affine, which is not in the
 * index.
 */
function volumeAxes(
  volume: DemoVolume,
  dims: [number, number, number]
): { spacing: [number, number, number]; flip: [boolean, boolean, boolean] } {
  const spacing: [number, number, number] = [1, 1, 1];
  const flip: [boolean, boolean, boolean] = [false, false, false];

  const note = (axis: DemoAxis | undefined, extent: number) => {
    if (!axis) return;
    const a = axisOf(axis);
    if (dims[a] > 0 && extent > 0) spacing[a] = extent / dims[a];
    flip[a] = flipOf(axis);
  };

  for (const plane of Object.values(volume.planes ?? {})) {
    if (!plane) continue;
    note(plane.h, plane.w);
    note(plane.v, plane.ht);
  }

  return { spacing, flip };
}

// ---------------------------------------------------------------------------
// DICOM stack → 8-bit scalar field, for the 3-D view
// ---------------------------------------------------------------------------

/**
 * Download budget for building a CT field in the browser.
 *
 * This is the whole difference between the two 3-D routes. A NIfTI series is one
 * container the reader has already downloaded, so its 3-D view is nearly free. A
 * CT series is one uncompressed file per slice, and HTTP cannot ask for part of a
 * slice, so the only quantity there is to trade is how many of them get read.
 * Measured on the committed corpus: 515 KB per 512×512 chest instance × 443 and
 * 558 instances = 223 and 281 MB; 650–658 KB per 647–655×512 head instance × 153
 * and 189 = 97 and 121 MB. Reading a quarter of a gigabyte to look at a rendering
 * is not a trade anybody would make, so an evenly spaced run is read instead.
 *
 * What 32 MB actually buys, measured by building all four (`ct-vol3d-check`):
 *
 *   CT-27CEA6  chest  443 inst  →  63 of 443 · 3.9 mm  (31.7 MB)
 *   CT-C48B2F  chest  558 inst  →  63 of 558 · 4.9 mm  (31.7 MB)
 *   CT-3097B2  head   189 inst  →  49 of 189 · 3.3 mm  (31.5 MB)
 *   CT-9339BE  head   153 inst  →  50 of 153 · 3.1 mm  (31.7 MB)
 *
 * 3–5 mm is coarser than these acquisitions, which step 0.55–1.0 mm, and is in the
 * range a scanner would itself reconstruct for a routine read. The count is
 * derived from the first instance's actual size rather than assumed, because the
 * two geometries in the corpus differ by 28%.
 */
const CT_VOLUME_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * Ceiling on the sample count, whatever the budget divides out to. The floor is
 * `DEMO_MIN_STACK_SLICES`.
 *
 * Both chest series hit this rather than the budget — 64 minus the first slice is
 * the 63 above — which is deliberate: past this the render gains detail the
 * sliders cannot show, and the field itself is already 15.8 MB.
 */
const CT_VOLUME_MAX_SAMPLES = 64;

/**
 * In-plane cap. Measured: a no-op for a 512×512 chest instance, and a 655×512 head
 * instance comes out 400×512 with its 0.347 mm pixels rescaled to 0.444 mm, so the
 * proportions hold. Keeps the largest field in the corpus at 15.8 MB.
 */
const CT_VOLUME_MAX_EDGE = 512;

/** A CT field, plus what a caller needs to describe it honestly on screen. */
export interface DemoCtVolume8 extends DemoVolume8 {
  /** How many slices were read, out of how many the series has. */
  sampled: { count: number; of: number };
  /**
   * Separation between the sampled planes in mm, when the instances carried
   * `ImagePositionPatient` or a thickness. Undefined means the headers did not say
   * and the render fell back to cubic voxels.
   */
  intervalMm?: number;
  /** Bytes downloaded to build it. Zero when every slice was already in `bytesCache`. */
  bytes: number;
}

let lastCtVolume8: { key: string; value: DemoCtVolume8 } | undefined;

export interface CtVolumeOptions {
  /** Reported after each slice lands, for a progress readout. */
  onProgress?: (done: number, total: number) => void;
  /** Set when the reader has left the 3-D view; stops the run early. */
  signal?: AbortSignal;
}

/**
 * How many slices of the run are on the wire at once.
 *
 * Matched to `sliceNetworkQueue`'s own limit: fewer and the queue's parallelism
 * goes unused, so a 60-slice build costs 60 round trips end to end; more and the
 * extra requests only sit in the queue while their `ArrayBuffer`s wait to be
 * decoded, which is 500 KB of live memory each for nothing.
 */
const CT_VOLUME_INFLIGHT = 4;

/**
 * Builds a 3-D scalar field by stacking a run of one CT series' instances.
 *
 * Honest about what it is: an evenly spaced subset of the series at its acquired
 * in-plane resolution, not the whole acquisition, and `sampled` / `intervalMm`
 * carry that fact to the UI so the render is never presented as something it is
 * not. Every voxel is a stored value through the instance's own rescale
 * slope/intercept and one window shared across the stack — no smoothing, no
 * interpolation between slices, nothing filled in. The first and last slice of the
 * series are always included, so the sampled block spans the same anatomy the 2-D
 * scroll does rather than a cropped middle.
 *
 * Scheduling is the existing one. Fetches go through `sliceNetworkQueue` under the
 * same key the 2-D viewer uses, so a slice already on the wire or in `bytesCache`
 * is shared rather than downloaded twice, and decodes go through
 * `slicePixelQueue`, so 60-odd windowing passes cannot merge into one long
 * main-thread block. Both run in the preload band: preemptible, so flipping back
 * to 2-D mid-build still gets the slice on screen first.
 *
 * These downloads deliberately do *not* enter `bytesCache` — 32 MB of them would
 * evict the entire 32 MB slice cache the 2-D viewer depends on.
 */
export async function loadDemoCtVolume8(
  urlAt: (index: number) => string | undefined,
  sliceCount: number,
  cacheKey: string,
  opts: CtVolumeOptions = {}
): Promise<DemoCtVolume8> {
  if (lastCtVolume8?.key === cacheKey) return lastCtVolume8.value;
  if (sliceCount < 2) throw new Error("A 3-D view needs a series of more than one slice");

  const first = await ctSlice(urlAt(0), CT_VOLUME_MAX_EDGE);
  stopIfAborted(opts.signal);

  /*
   * The sample count from the measured instance size, then the indices: the two
   * ends pinned and the rest spread evenly between them. `Math.round` rather than
   * a fixed stride so the interval stays even when the count does not divide the
   * series length.
   */
  const perSlice = Math.max(1, first.size);
  const count = Math.min(
    sliceCount,
    CT_VOLUME_MAX_SAMPLES,
    Math.max(DEMO_MIN_STACK_SLICES, Math.floor(CT_VOLUME_BUDGET_BYTES / perSlice))
  );
  const indexOf = (i: number) => Math.round((i * (sliceCount - 1)) / (count - 1));

  const { width, height } = first.plane;
  const out = new Uint8Array(width * height * count);
  out.set(first.plane.gray, 0);
  let bytes = first.downloaded;
  let done = 1;
  opts.onProgress?.(done, count);

  /*
   * A sliding window of requests rather than one at a time, so the four network
   * slots stay busy, and rather than all of them at once, so at most four 500 KB
   * buffers are alive. Each is given a no-op rejection handler as it starts: when
   * one slice fails or the reader leaves mid-build, the ones already in the air
   * must not surface as unhandled rejections. The real handling is at the `await`.
   */
  const pending: Array<Promise<CtSlice> | undefined> = [];
  const begin = (i: number) => {
    if (i >= count || pending[i]) return;
    const p = ctSlice(urlAt(indexOf(i)), CT_VOLUME_MAX_EDGE, first.plane.window);
    p.catch(() => {});
    pending[i] = p;
  };
  for (let i = 1; i <= CT_VOLUME_INFLIGHT; i++) begin(i);

  let last = first.plane;
  for (let i = 1; i < count; i++) {
    const slice = await pending[i]!;
    stopIfAborted(opts.signal);
    begin(i + CT_VOLUME_INFLIGHT);

    // Same window for every plane — see `dicomGrayPlane`. A plane that came back
    // at a different size cannot be stacked, so it is a hard error rather than a
    // silently misaligned slab.
    if (slice.plane.width !== width || slice.plane.height !== height) {
      throw new Error("This series' slices are not all the same size, so they cannot be stacked");
    }
    out.set(slice.plane.gray, i * width * height);
    bytes += slice.downloaded;
    last = slice.plane;
    opts.onProgress?.(++done, count);
  }

  const intervalMm = ctInterval(first.plane, last, count, sliceCount);
  const inPlane = ctPixelSpacing(first.plane);
  /* Columns run along the output's x, rows along its y; `PixelSpacing` is
     (between rows, between columns), so it is read in the other order. Scaled by
     the in-plane reduction, because a 512→400 column reduction makes each
     remaining column 1.28 acquired columns wide. */
  const sx = (inPlane?.[1] ?? 1) * (first.plane.columns / width);
  const sy = (inPlane?.[0] ?? 1) * (first.plane.rows / height);
  const value: DemoCtVolume8 = {
    data: out,
    dims: [width, height, count],
    /* When nothing in the headers gives a separation, the field is left cubic in
       its own grid rather than given a plausible-looking thickness: the render
       comes out visibly squashed or stretched, which is the correct signal, and
       only the ratios matter to it anyway. */
    spacing: [sx, sy, intervalMm ?? sy],
    window: first.plane.window,
    sampled: { count, of: sliceCount },
    intervalMm,
    bytes,
  };
  lastCtVolume8 = { key: cacheKey, value };
  return value;
}

/** One instance, fetched and windowed, with what it cost. */
interface CtSlice {
  plane: DicomPlane;
  /** The instance's size, cached or not — what the sample count is budgeted against. */
  size: number;
  /** What it cost the network. Zero when the 2-D viewer had already downloaded it. */
  downloaded: number;
}

async function ctSlice(
  url: string | undefined,
  maxEdge: number,
  sharedWindow?: [number, number]
): Promise<CtSlice> {
  if (!url) throw new Error("This series is missing a slice the 3-D view needs");
  const req = parseDemoUrl(url);
  if (!req || req.kind !== "dicom") throw new Error("This series is not a committed DICOM stack");

  const netKey = netKeyFor(req);
  const cached = touch(bytesCache, netKey);
  const buffer =
    cached ??
    (await sliceNetworkQueue.run(netKey, PRIORITY.preload, (signal) =>
      fetchBytes(req.assetUrl, undefined, signal)
    ));

  const plane = await slicePixelQueue.run(`volume3d:${netKey}`, PRIORITY.preload, () =>
    Promise.resolve(dicomGrayPlane(new Uint8Array(buffer), maxEdge, 0, sharedWindow))
  );
  return { plane, size: buffer.byteLength, downloaded: cached ? 0 : buffer.byteLength };
}

/** Abort is not a failure to report — it is the reader having moved on. */
function stopIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The 3-D build is no longer needed", "AbortError");
}

/**
 * Separation between two sampled planes, in mm.
 *
 * Straight-line distance between the two `ImagePositionPatient` vectors divided by
 * the number of gaps between them, which is correct for any slice orientation
 * without needing the direction cosines. Falls back to the nominal slice gap times
 * the sampling stride, and to undefined when the instance carried neither — at
 * which point the caller uses cubic voxels rather than invent a thickness.
 */
function ctInterval(
  first: DicomPlane,
  last: DicomPlane,
  count: number,
  sliceCount: number
): number | undefined {
  if (count < 2) return undefined;

  const a = first.position;
  const b = last.position;
  if (a && b) {
    const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (span > 0) return span / (count - 1);
  }

  if (first.nominalGap && first.nominalGap > 0) {
    return (first.nominalGap * (sliceCount - 1)) / (count - 1);
  }
  return undefined;
}

/** `PixelSpacing`, or undefined — never a substituted default, so the caller can say it is guessing. */
function ctPixelSpacing(plane: DicomPlane): [number, number] | undefined {
  const s = plane.pixelSpacing;
  return s && s[0] > 0 && s[1] > 0 ? s : undefined;
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


