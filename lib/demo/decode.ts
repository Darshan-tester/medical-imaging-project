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

/** What a decoded slice URL resolves to: an object URL an `<img>` can use directly. */
export interface DecodedImage {
  objectUrl: string;
  width: number;
  height: number;
}

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
 * Two of them, for two different costs.
 *
 * `sliceCache` holds object URLs. They are backed by a Blob the browser keeps
 * alive until the URL is revoked, so an unbounded cache is a leak — hence the
 * LRU with explicit revocation on eviction.
 *
 * `volumeCache` holds decoded voxel arrays, which is the expensive one:
 * inflating a 3–5 MB gzipped NIfTI per slice would mean re-inflating the same
 * volume for all 512 frames of a plane. Two entries mirrors the server's
 * `VOLUME_CACHE_MAX` and covers "scrolling one study, occasionally flipping to
 * its second series".
 *
 * `inflight` is what stops a fast scroll from starting the same decode twenty
 * times over: a fetch that is already running is awaited rather than repeated.
 */
const SLICE_CACHE_MAX = 192;
const VOLUME_CACHE_MAX = 2;

const sliceCache = new Map<string, DecodedImage>();
const volumeCache = new Map<string, DecodedVolume>();
const inflight = new Map<string, Promise<DecodedImage>>();

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

function putSlice(key: string, value: DecodedImage): DecodedImage {
  sliceCache.set(key, value);
  while (sliceCache.size > SLICE_CACHE_MAX) {
    const oldest = sliceCache.keys().next();
    if (oldest.done) break;
    const evicted = sliceCache.get(oldest.value);
    sliceCache.delete(oldest.value);
    if (evicted) URL.revokeObjectURL(evicted.objectUrl);
  }
  return value;
}

/**
 * Decodes one demo slice URL to something an `<img>` can display.
 *
 * Rejects rather than returning a placeholder: the caller decides what a failed
 * slice looks like, and silently substituting anything for medical pixels would
 * be the wrong default.
 */
export function decodeDemoImage(url: string): Promise<DecodedImage> {
  const cached = touch(sliceCache, url);
  if (cached) return Promise.resolve(cached);

  const running = inflight.get(url);
  if (running) return running;

  const req = parseDemoUrl(url);
  if (!req) return Promise.reject(new Error("Not a demo-decoded URL"));

  const task = (req.kind === "dicom" ? decodeDicomSlice(req) : decodeNiftiSlice(req))
    .then((image) => putSlice(url, image))
    .finally(() => inflight.delete(url));

  inflight.set(url, task);
  return task;
}

async function fetchBytes(url: string, range?: { off: number; len: number }): Promise<ArrayBuffer> {
  const res = await fetch(url, {
    headers: range ? { Range: `bytes=${range.off}-${range.off + range.len - 1}` } : undefined,
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
 */
function grayToObjectUrl(
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
 */
async function decodeDicomSlice(req: DemoRequest): Promise<DecodedImage> {
  const bytes = new Uint8Array(await fetchBytes(req.assetUrl));
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

  let raw: Float64Array;
  if (samplesPerPixel >= 3) {
    // RGB/YBR — converted to 8-bit luma for a consistent single-channel viewer.
    const buf = byteArray.subarray(pixelElement.dataOffset, pixelElement.dataOffset + pixelCount);
    raw = new Float64Array(rows * columns);
    for (let i = 0; i < rows * columns; i++) {
      raw[i] = 0.299 * (buf[i * 3] ?? 0) + 0.587 * (buf[i * 3 + 1] ?? 0) + 0.114 * (buf[i * 3 + 2] ?? 0);
    }
    windowCenter = windowCenter ?? 128;
    windowWidth = windowWidth ?? 256;
  } else if (bitsAllocated === 8) {
    const buf = byteArray.subarray(pixelElement.dataOffset, pixelElement.dataOffset + pixelCount);
    raw = new Float64Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) raw[i] = buf[i] * rescaleSlope + rescaleIntercept;
  } else {
    const view =
      pixelRepresentation === 1
        ? new Int16Array(byteArray.buffer, byteArray.byteOffset + pixelElement.dataOffset, pixelCount)
        : new Uint16Array(byteArray.buffer, byteArray.byteOffset + pixelElement.dataOffset, pixelCount);
    raw = new Float64Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) raw[i] = view[i] * rescaleSlope + rescaleIntercept;
  }

  // No window in the file: a full min/max stretch of THIS image's real pixel
  // values — never a fabricated "typical" window for the modality.
  if (windowCenter === undefined || windowWidth === undefined || windowWidth <= 0) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of raw) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    windowCenter = (min + max) / 2;
    windowWidth = Math.max(1, max - min);
  }

  const lo = windowCenter - windowWidth / 2;
  const scale = 255 / windowWidth;
  const invert = photometric === "MONOCHROME1";
  const gray = new Uint8Array(rows * columns);
  for (let i = 0; i < rows * columns; i++) {
    let v = Math.round((raw[i] - lo) * scale);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    gray[i] = invert ? 255 - v : v;
  }

  return grayToObjectUrl(gray, columns, rows, req.maxEdge);
}

// ---------------------------------------------------------------------------
// NIfTI — mirrors `loadVolume` + `resliceToPng`
// ---------------------------------------------------------------------------

async function loadDemoVolume(key: string, volume: DemoVolume, assetUrl: string): Promise<DecodedVolume> {
  const cached = touch(volumeCache, key);
  if (cached) return cached;

  let buf = await fetchBytes(assetUrl, volume.zip);
  // `nifti-reader-js` inflates through pure-JS `fflate`, so this works in the
  // browser exactly as it does in Node.
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

async function decodeNiftiSlice(req: DemoRequest): Promise<DecodedImage> {
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

  const decoded = await loadDemoVolume(key, volume, req.assetUrl);
  const { gray, width, height } = reslice(decoded, geometry, req.frame, req.maxEdge);
  return grayToObjectUrl(gray, width, height);
}


