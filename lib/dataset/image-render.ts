import fs from "fs";
import { PNG } from "pngjs";
import * as dicomParser from "dicom-parser";
import * as nifti from "nifti-reader-js";
import { DatasetImageRef, DicomVolumeRef, SliceOrientation } from "./types";
// Shared with the client-side demo decoder so both agree on what a NIfTI
// datatype code means — see the header of `nifti-voxels.ts`.
import { niftiTypedArray, VoxelArray } from "./nifti-voxels";

export interface RenderedImage {
  contentType: string;
  bytes: Buffer;
}

export interface RenderOptions {
  /**
   * The reconstructed stack a `dicom-volume` ref belongs to — i.e.
   * `study.volumes[series.volumeId]`. Required for that kind and ignored for
   * every other kind. Passed in rather than stored on each ref so a 500-slice
   * stack describes itself once per study instead of once per rendered slice.
   */
  volume?: DicomVolumeRef;
  /**
   * Longest output edge in pixels. Used by the thumbnail strip and study
   * cards, which draw into ~44-320 px boxes and were previously fetching the
   * same full-resolution render as the main viewer.
   *
   * Only applies to renders this module encodes itself (DICOM/NIfTI -> PNG).
   * A `raster` source is an already-encoded JPEG/PNG that is streamed through
   * untouched, so it is returned at full size — re-encoding it would need a
   * JPEG decoder and would lose quality for the main viewer's benefit.
   */
  maxEdge?: number;
}

/**
 * Resolves any indexed image reference to bytes the browser can display
 * directly. PNG/JPG pass straight through (no re-encoding, no quality
 * loss). DICOM and NIfTI are decoded and windowed into 8-bit grayscale PNGs
 * server-side — the browser never receives a `.dcm`/`.nii` file, which
 * `<img>` cannot render anyway.
 */
export function renderImage(ref: DatasetImageRef, opts: RenderOptions = {}): RenderedImage {
  const maxEdge = normalizeMaxEdge(opts.maxEdge);
  switch (ref.kind) {
    case "raster":
      // Already-encoded bytes; see RenderOptions.maxEdge for why size is left alone.
      return renderRaster(ref.absPath);
    case "dicom": {
      // The full-resolution path is untouched, so a thumbnail request is a
      // normal render followed by a resample rather than a second decoder.
      const full = renderDicom(ref.absPath);
      return maxEdge ? downscalePng(full, maxEdge) : full;
    }
    case "nifti":
      return renderNifti(ref.absPath, ref.frameIndex ?? 0, ref.orientation, maxEdge);
    case "dicom-volume":
      if (!opts.volume || opts.volume.files.length === 0) {
        throw new Error("This reconstructed series is missing its volume descriptor — re-run `npm run dataset:index`");
      }
      return renderDicomVolume(opts.volume, ref.frameIndex ?? 0, ref.orientation, maxEdge);
  }
}

/** Clamped to a sane thumbnail range so a hostile `?w=` cannot request a 40000 px render. */
function normalizeMaxEdge(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const n = Math.trunc(value);
  if (n < MIN_THUMBNAIL_EDGE || n > MAX_RENDER_EDGE) return undefined;
  return n;
}

const MIN_THUMBNAIL_EDGE = 16;

// ---------------------------------------------------------------------------
// Rendered-output cache
// ---------------------------------------------------------------------------

/*
 * Every slice request re-decoded and re-encoded its image from scratch, on the
 * one synchronous Node path shared by the whole page. A thumbnail strip asking
 * for 41 renders, then asking for the same 41 again on the next slice change,
 * is what made the viewer feel slow — not the size of any single render.
 *
 * Keyed by the caller, which folds in the manifest timestamp, so re-indexing
 * invalidates everything rather than serving renders produced by the previous
 * indexer.
 */
const RENDER_CACHE_MAX_BYTES = envInt("SCANLAB_RENDER_CACHE_MB", 96, 8, 1024) * 1024 * 1024;
const renderCache = new Map<string, RenderedImage>();
let renderCacheBytes = 0;

export function renderImageCached(key: string, ref: DatasetImageRef, opts: RenderOptions = {}): RenderedImage {
  const hit = renderCache.get(key);
  if (hit) {
    renderCache.delete(key);
    renderCache.set(key, hit);
    return hit;
  }

  const rendered = renderImage(ref, opts);

  // Oversized single entries are returned but not retained, so one huge render
  // can't evict an entire strip of thumbnails.
  if (rendered.bytes.byteLength * 4 <= RENDER_CACHE_MAX_BYTES) {
    renderCache.set(key, rendered);
    renderCacheBytes += rendered.bytes.byteLength;
    while (renderCacheBytes > RENDER_CACHE_MAX_BYTES) {
      const oldest = renderCache.keys().next().value;
      if (oldest === undefined) break;
      const evicted = renderCache.get(oldest);
      renderCache.delete(oldest);
      renderCacheBytes -= evicted?.bytes.byteLength ?? 0;
    }
  }

  return rendered;
}

function renderRaster(absPath: string): RenderedImage {
  const bytes = fs.readFileSync(absPath);
  const lower = absPath.toLowerCase();
  const contentType = lower.endsWith(".png") ? "image/png" : lower.endsWith(".gif") ? "image/gif" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { contentType, bytes };
}

// ---------------------------------------------------------------------------
// DICOM
// ---------------------------------------------------------------------------

export interface DicomSummary {
  rows?: number;
  columns?: number;
  sliceCount?: number; // for a multi-frame instance
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  studyInstanceUID?: string;
  accessionNumber?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  pixelSpacing?: [number, number];
  windowCenter?: number;
  windowWidth?: number;
  modality?: string;
  bodyPart?: string;
  orientation?: SliceOrientation;
  patientAgeYears?: number;
  patientSex?: "M" | "F" | "Other";
  seriesDescription?: string;
  studyDate?: string;
  /**
   * Image Position (Patient) (0020,0032) — LPS mm coordinate of the centre of
   * the first transmitted voxel. Used to order a stack along its own slice
   * normal (more reliable than InstanceNumber) and to derive slice spacing.
   */
  imagePositionPatient?: [number, number, number];
  /**
   * Image Orientation (Patient) (0020,0037) — six direction cosines in LPS:
   * the first triplet is the world direction of increasing *column* index,
   * the second of increasing *row* index. Without this a stack cannot be
   * resliced into anatomically correct coronal/sagittal planes.
   */
  imageOrientationPatient?: [number, number, number, number, number, number];
  /** (0018,0050) — nominal slab thickness, a fallback when positions are absent. */
  sliceThickness?: number;
  /** (0018,0088) — centre-to-centre slice distance, preferred over thickness. */
  spacingBetweenSlices?: number;
}

/** Parses just the header/metadata (no pixel decode) — cheap enough to run during indexing for every instance. */
export function readDicomSummary(absPath: string): DicomSummary | undefined {
  try {
    const bytes = fs.readFileSync(absPath);
    const dataSet = dicomParser.parseDicom(new Uint8Array(bytes));
    const rows = dataSet.uint16("x00280010");
    const columns = dataSet.uint16("x00280011");
    const orientationRaw = dataSet.string("x00185101"); // View Position, e.g. AP/PA/LATERAL
    const ageStr = dataSet.string("x00101010"); // e.g. "034Y"
    const sexRaw = dataSet.string("x00100040");
    const pixelSpacingStr = dataSet.string("x00280030");
    let pixelSpacing: [number, number] | undefined;
    if (pixelSpacingStr) {
      const [a, b] = pixelSpacingStr.split("\\").map(Number);
      if (!Number.isNaN(a) && !Number.isNaN(b)) pixelSpacing = [a, b];
    }
    const ipp = parseDecimalString(dataSet.string("x00200032"), 3);
    const iop = parseDecimalString(dataSet.string("x00200037"), 6);
    return {
      rows,
      columns,
      seriesInstanceUID: dataSet.string("x0020000e"),
      sopInstanceUID: dataSet.string("x00080018"),
      studyInstanceUID: dataSet.string("x0020000d"),
      accessionNumber: dataSet.string("x00080050"),
      instanceNumber: dataSet.intString("x00200013"),
      sliceLocation: dataSet.floatString("x00201041"),
      pixelSpacing,
      windowCenter: dataSet.floatString("x00281050"),
      windowWidth: dataSet.floatString("x00281051"),
      modality: dataSet.string("x00080060"),
      bodyPart: dataSet.string("x00180015"),
      orientation: normalizeOrientation(orientationRaw),
      patientAgeYears: ageStr ? parseDicomAge(ageStr) : undefined,
      patientSex: sexRaw === "M" || sexRaw === "F" ? sexRaw : sexRaw ? "Other" : undefined,
      seriesDescription: dataSet.string("x0008103e"),
      studyDate: dataSet.string("x00080020"),
      imagePositionPatient: ipp ? [ipp[0]!, ipp[1]!, ipp[2]!] : undefined,
      imageOrientationPatient: iop ? [iop[0]!, iop[1]!, iop[2]!, iop[3]!, iop[4]!, iop[5]!] : undefined,
      sliceThickness: dataSet.floatString("x00180050"),
      spacingBetweenSlices: dataSet.floatString("x00180088"),
    };
  } catch {
    return undefined;
  }
}

function parseDicomAge(raw: string): number | undefined {
  const m = /^(\d{3})([YMWD])$/.exec(raw.trim());
  if (!m) return undefined;
  const value = parseInt(m[1], 10);
  if (m[2] === "Y") return value;
  if (m[2] === "M") return Math.round(value / 12);
  return undefined; // weeks/days too fine-grained to report as an age
}

function normalizeOrientation(v?: string): SliceOrientation | undefined {
  if (!v) return undefined;
  const up = v.toUpperCase();
  if (up.includes("AP")) return "AP";
  if (up.includes("PA")) return "PA";
  if (up.includes("LAT")) return "Lateral";
  return undefined;
}

function renderDicom(absPath: string): RenderedImage {
  const bytes = fs.readFileSync(absPath);
  const dataSet = dicomParser.parseDicom(new Uint8Array(bytes));

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
  if (!rows || !columns || !pixelElement) {
    throw new Error("DICOM file has no usable pixel data");
  }

  const byteArray = dataSet.byteArray as Uint8Array;
  const pixelCount = rows * columns * samplesPerPixel;

  let raw: Float64Array;
  if (samplesPerPixel >= 3) {
    // RGB/YBR — render as-is without windowing, converting straight to 8-bit grayscale luma for a consistent single-channel viewer.
    const bytesPerPixel = 1;
    const buf = byteArray.subarray(pixelElement.dataOffset, pixelElement.dataOffset + pixelCount * bytesPerPixel);
    raw = new Float64Array(rows * columns);
    for (let i = 0; i < rows * columns; i++) {
      const r = buf[i * 3] ?? 0;
      const g = buf[i * 3 + 1] ?? 0;
      const b = buf[i * 3 + 2] ?? 0;
      raw[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    windowCenter = windowCenter ?? 128;
    windowWidth = windowWidth ?? 256;
  } else if (bitsAllocated === 8) {
    const buf = byteArray.subarray(pixelElement.dataOffset, pixelElement.dataOffset + pixelCount);
    raw = new Float64Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) raw[i] = buf[i] * rescaleSlope + rescaleIntercept;
  } else {
    const view = pixelRepresentation === 1
      ? new Int16Array(byteArray.buffer, byteArray.byteOffset + pixelElement.dataOffset, pixelCount)
      : new Uint16Array(byteArray.buffer, byteArray.byteOffset + pixelElement.dataOffset, pixelCount);
    raw = new Float64Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) raw[i] = view[i] * rescaleSlope + rescaleIntercept;
  }

  // No window in the file: fall back to a full min/max stretch of THIS
  // image's real pixel values — never a fabricated/typical window setting.
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

  const png = new PNG({ width: columns, height: rows });
  const lo = windowCenter - windowWidth / 2;
  const scale = 255 / windowWidth;
  const invert = photometric === "MONOCHROME1";
  for (let i = 0; i < rows * columns; i++) {
    let v = Math.round((raw[i] - lo) * scale);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    if (invert) v = 255 - v;
    const o = i * 4;
    png.data[o] = v;
    png.data[o + 1] = v;
    png.data[o + 2] = v;
    png.data[o + 3] = 255;
  }

  return { contentType: "image/png", bytes: PNG.sync.write(png) };
}

// ---------------------------------------------------------------------------
// NIfTI
// ---------------------------------------------------------------------------

/** The three reconstructable anatomical planes. Never includes projection views (AP/PA/Lateral), which are 2D-only concepts. */
export type MprPlane = "Axial" | "Coronal" | "Sagittal";

export const MPR_PLANES: MprPlane[] = ["Axial", "Coronal", "Sagittal"];

/** One array axis of the volume, plus whether it must be walked backwards to display in the conventional direction. */
interface AxisRef {
  axis: 0 | 1 | 2;
  flip: boolean;
}

export interface NiftiPlaneGeometry {
  /** Number of real slices available along this plane's normal. 1 = the volume is flat here; there is nothing to reconstruct. */
  sliceCount: number;
  /** Rendered pixel size, already corrected for anisotropic voxels so on-screen distances are physically proportional. */
  width: number;
  height: number;
  through: AxisRef;
  horizontal: AxisRef;
  vertical: AxisRef;
}

export interface NiftiGeometry {
  dims: [number, number, number];
  /** mm per voxel along each array axis (pixdim). */
  spacing: [number, number, number];
  planes: Record<MprPlane, NiftiPlaneGeometry>;
  /**
   * The plane the data was actually acquired in — the one whose normal has the
   * coarsest voxel spacing (i.e. the slice-select direction). The other two are
   * genuine reconstructions through the same voxels, not rotations of a 2D image.
   */
  acquiredPlane: MprPlane;
  /** False when the file carried no qform/sform, so the axis mapping is the NIfTI default (assumed RAS) rather than measured. */
  hasSpatialTransform: boolean;
}

export interface NiftiSummary {
  dims: [number, number, number]; // nx, ny, nz
  sliceCounts: Record<SliceOrientation, number>;
}

/**
 * Header-only read (no pixel decode beyond what gzip forces): returns the real
 * voxel dimensions, spacing, and — crucially — which array axis corresponds to
 * which anatomical plane, taken from the file's own affine. Everything the MPR
 * path does downstream is derived from this, so no plane is ever guessed.
 */
export function readNiftiGeometry(absPath: string): NiftiGeometry | undefined {
  try {
    const header = loadVolume(absPath)?.header;
    if (!header) return undefined;
    return geometryFromHeader(header);
  } catch {
    return undefined;
  }
}

export function readNiftiSummary(absPath: string): NiftiSummary | undefined {
  const geo = readNiftiGeometry(absPath);
  if (!geo) return undefined;
  return {
    dims: geo.dims,
    sliceCounts: {
      Axial: geo.planes.Axial.sliceCount,
      Sagittal: geo.planes.Sagittal.sliceCount,
      Coronal: geo.planes.Coronal.sliceCount,
      AP: 0,
      PA: 0,
      Lateral: 0,
      Unknown: 0,
    },
  };
}

/**
 * `frameIndex` is the slice number along the requested plane's axis, packed
 * into the image ref at index time. `plane` picks which voxel axis to step
 * along; when absent we fall back to the volume's acquired plane, which
 * reproduces the previous axial-only behaviour for any un-migrated ref.
 */
function renderNifti(absPath: string, frameIndex: number, plane?: SliceOrientation, maxEdge?: number): RenderedImage {
  const volume = loadVolume(absPath);
  if (!volume) throw new Error("Not a valid NIfTI file");
  const geo = geometryFromHeader(volume.header);
  const requested = isMprPlane(plane) ? plane : geo.acquiredPlane;
  const p = geo.planes[requested];
  if (p.sliceCount < 1) {
    throw new Error(`This volume has no ${requested.toLowerCase()} extent, so that plane cannot be reconstructed`);
  }

  const { header } = volume;
  return resliceToPng({
    data: volume.data,
    dims: geo.dims,
    plane: p,
    throughIndex: frameIndex,
    slope: header.scl_slope || 1,
    inter: header.scl_inter || 0,
    // Measured once for the whole volume rather than per slice, so scrolling a
    // PET series no longer changes brightness on every frame.
    window: volume.window,
    maxEdge,
  });
}

interface ResliceRequest {
  data: { [i: number]: number; length: number };
  dims: [number, number, number];
  plane: NiftiPlaneGeometry;
  /** Slice number along the plane's through-axis; clamped, never wrapped. */
  throughIndex: number;
  slope: number;
  inter: number;
  /**
   * Fixed grayscale mapping shared by every slice of a volume, so cine playback
   * does not pulse in brightness. Reconstructed CT derives it from the stack's
   * own DICOM window; NIfTI derives it from measured percentiles of the volume
   * (see `computeVolumeWindow`). When absent, the slice falls back to stretching
   * its own measured range — never a fabricated "typical" window for the modality.
   */
  window?: { lo: number; range: number };
  invert?: boolean;
  maxEdge?: number;
}

/**
 * Source coordinates and interpolation weights for one output axis, resolved
 * once per reslice instead of per pixel.
 *
 * `a`/`b` are byte offsets (already multiplied by the array stride) of the two
 * neighbouring source samples, and `w` is the fraction of the way from `a` to
 * `b`. Output pixel centres map to source coordinate `(o + 0.5) * n / out - 0.5`,
 * which makes a 1:1 axis land exactly on `w = 0` — so an unscaled acquired
 * plane still comes out byte-for-byte identical to the nearest-neighbour render
 * it replaces.
 */
interface AxisSamples {
  a: Int32Array;
  b: Int32Array;
  w: Float64Array;
}

function sampleAxis(out: number, n: number, flip: boolean, stride: number): AxisSamples {
  const a = new Int32Array(out);
  const b = new Int32Array(out);
  const w = new Float64Array(out);
  for (let o = 0; o < out; o++) {
    const s = ((o + 0.5) * n) / out - 0.5;
    const i0 = Math.floor(s);
    const frac = s - i0;
    // A flip is a mirror, so it preserves adjacency: mirroring both taps and
    // keeping the weight gives the mirror of the un-flipped interpolation.
    a[o] = resolveIndex(clampInt(i0, 0, n - 1), n, flip) * stride;
    b[o] = resolveIndex(clampInt(i0 + 1, 0, n - 1), n, flip) * stride;
    w[o] = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  }
  return { a, b, w };
}

/**
 * The single reslicing implementation, shared by NIfTI volumes and
 * reconstructed DICOM stacks.
 *
 * Bilinear resample onto a physically square pixel grid. For a 4.07 x 4.07 x 5 mm
 * PET volume this is what makes the coronal view 271 rows tall instead of a
 * squashed 221 — the geometry comes from measured spacing, not a guess.
 *
 * Interpolation is strictly in-plane and adds no information: it replaces the
 * blocky replicated rows a nearest-neighbour upsample produces with a linear
 * ramp between the same two measured samples. That matters most on a
 * reconstructed plane of a thick-slice 2-D acquisition, where the vertical
 * screen axis IS the slice-select axis — a 512 x 512 x 20 MRI at 7.2 mm resliced
 * coronally has 20 real rows stretched over 335, and every intermediate row is
 * interpolated, not measured. Series labels carry the through-plane thickness so
 * that limitation is visible on screen rather than implied.
 *
 * Voxel indexing assumes array axis 0 is fastest-varying, which is true for
 * NIfTI and is how the DICOM stack loader packs its slices.
 */
function resliceToPng(req: ResliceRequest): RenderedImage {
  const { data, dims, plane: p, slope, inter } = req;
  const strides: [number, number, number] = [1, dims[0], dims[0] * dims[1]];

  const throughIndex = clampInt(req.throughIndex, 0, p.sliceCount - 1);
  const nH = dims[p.horizontal.axis];
  const nV = dims[p.vertical.axis];
  const baseOffset = resolveIndex(throughIndex, dims[p.through.axis], p.through.flip) * strides[p.through.axis];

  const [width, height] = outputSize(p.width, p.height, req.maxEdge);
  const cols = sampleAxis(width, nH, p.horizontal.flip, strides[p.horizontal.axis]);
  const rows = sampleAxis(height, nV, p.vertical.flip, strides[p.vertical.axis]);

  const slice = new Float64Array(width * height);
  const needRange = !req.window;
  let min = Infinity;
  let max = -Infinity;
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
      slice[outRow + ox] = value;
      if (needRange) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  const lo = req.window ? req.window.lo : min;
  const range = req.window ? Math.max(1e-6, req.window.range) : Math.max(1e-6, max - min);

  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    let v = Math.round(((slice[i] - lo) / range) * 255);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    if (req.invert) v = 255 - v;
    const o = i * 4;
    png.data[o] = v;
    png.data[o + 1] = v;
    png.data[o + 2] = v;
    png.data[o + 3] = 255;
  }

  return { contentType: "image/png", bytes: PNG.sync.write(png) };
}

/**
 * Output raster size: scaled down to `maxEdge` for thumbnail requests, or up to
 * `MIN_FULL_EDGE` for a full-size request on a small plane. Aspect ratio — which
 * encodes the real physical proportions — is preserved either way.
 */
function outputSize(width: number, height: number, maxEdge?: number): [number, number] {
  if (maxEdge) return fitEdge(width, height, maxEdge);
  const longest = Math.max(width, height);
  if (longest >= MIN_FULL_EDGE) return [width, height];
  const scale = MIN_FULL_EDGE / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Scales a width/height pair down to `maxEdge` while preserving aspect ratio. */
function fitEdge(width: number, height: number, maxEdge?: number): [number, number] {
  const longest = Math.max(width, height);
  if (!maxEdge || longest <= maxEdge) return [width, height];
  const scale = maxEdge / longest;
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function isMprPlane(value?: SliceOrientation): value is MprPlane {
  return value === "Axial" || value === "Coronal" || value === "Sagittal";
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(value)));
}

/** Screen axes are defined in display order; a flipped axis is walked from the far end. */
function resolveIndex(i: number, n: number, flip: boolean): number {
  return flip ? n - 1 - i : i;
}

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// NIfTI volume loading + geometry
// ---------------------------------------------------------------------------

/** Only the header fields this module actually uses, so the two NIfTI header versions can share one code path. */
interface NiftiHeaderFields {
  dims: number[];
  pixDims: number[];
  affine: number[][];
  qform_code: number;
  sform_code: number;
  datatypeCode: number;
  scl_slope: number;
  scl_inter: number;
}

interface LoadedVolume {
  header: NiftiHeaderFields;
  data: { [i: number]: number; length: number };
  /**
   * One grayscale mapping for the whole volume, measured from its own voxels.
   * Held here so it is computed once per decode rather than per slice.
   */
  window: { lo: number; range: number };
}

/**
 * Percentile clip used to turn a volume's measured intensity distribution into a
 * display window. Both ends are data-derived — no modality preset is applied
 * anywhere — but clipping does mean the extreme 0.5% saturates, which is the
 * point: a PET volume's hottest voxel (bladder) would otherwise compress all
 * soft tissue into the bottom few grey levels.
 */
const WINDOW_PCT_LO = envInt("SCANLAB_NIFTI_WINDOW_PCT_LO", 5, 0, 200) / 1000;
const WINDOW_PCT_HI = envInt("SCANLAB_NIFTI_WINDOW_PCT_HI", 995, 800, 1000) / 1000;
const WINDOW_BINS = 1024;
const WINDOW_MAX_SAMPLES = 4_000_000;

/**
 * A robust display window for a whole NIfTI volume.
 *
 * NIfTI carries no window/level of its own, and the previous per-slice min/max
 * stretch had two visible costs: brightness pulsed while scrolling, and a slice
 * containing only background noise was stretched to full contrast. Both go away
 * once every slice of a volume shares one mapping.
 *
 * Histogram over a strided subsample — exact percentiles over a 45 M-voxel
 * volume would cost more than the decode itself, and a 4 M-sample estimate moves
 * a 1024-bin boundary at most.
 *
 * Exported because `scripts/demo-index.ts` measures this once per committed demo
 * volume and writes the result into `public/demo-data/index.json`: the browser
 * decoder then applies the identical window without re-running the histogram, so
 * a client-rendered demo slice and a server-rendered indexed slice of the same
 * volume look the same.
 */
export function computeVolumeWindow(
  data: VoxelArray,
  slope: number,
  inter: number
): { lo: number; range: number } {
  const n = data.length;
  if (!n) return { lo: 0, range: 1 };
  const stride = Math.max(1, Math.ceil(n / WINDOW_MAX_SAMPLES));

  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i += stride) {
    const v = (data[i] ?? 0) * slope + inter;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    count++;
  }
  if (!count || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { lo: Number.isFinite(min) ? min : 0, range: 1 };
  }

  const span = max - min;
  const hist = new Int32Array(WINDOW_BINS);
  for (let i = 0; i < n; i += stride) {
    const v = (data[i] ?? 0) * slope + inter;
    if (!Number.isFinite(v)) continue;
    hist[clampInt(Math.floor(((v - min) / span) * WINDOW_BINS), 0, WINDOW_BINS - 1)]++;
  }

  const loTarget = count * WINDOW_PCT_LO;
  const hiTarget = count * WINDOW_PCT_HI;
  let cumulative = 0;
  let loBin = 0;
  let hiBin = WINDOW_BINS - 1;
  let loFound = false;
  for (let b = 0; b < WINDOW_BINS; b++) {
    cumulative += hist[b];
    if (!loFound && cumulative >= loTarget) {
      loBin = b;
      loFound = true;
    }
    if (cumulative >= hiTarget) {
      hiBin = b;
      break;
    }
  }

  const lo = min + (loBin / WINDOW_BINS) * span;
  const hi = min + ((hiBin + 1) / WINDOW_BINS) * span;
  return { lo, range: Math.max(1e-6, hi - lo) };
}

/**
 * Decoding a gzipped volume means inflating the whole file, so a browsing
 * session that walks 200 coronal slices would otherwise inflate the same
 * 35 MB volume 200 times. Two entries is enough to cover "scrolling one
 * study, occasionally flipping to its second series" without holding a
 * meaningful amount of memory.
 */
const VOLUME_CACHE_MAX = 2;
const volumeCache = new Map<string, LoadedVolume>();

function loadVolume(absPath: string): LoadedVolume | undefined {
  let key = absPath;
  try {
    const st = fs.statSync(absPath);
    key = `${absPath}::${st.mtimeMs}::${st.size}`;
  } catch {
    return undefined;
  }

  const cached = volumeCache.get(key);
  if (cached) {
    // Refresh LRU position.
    volumeCache.delete(key);
    volumeCache.set(key, cached);
    return cached;
  }

  let buf: ArrayBuffer = toArrayBuffer(fs.readFileSync(absPath));
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) return undefined;
  const header = nifti.readHeader(buf) as unknown as NiftiHeaderFields | null;
  if (!header) return undefined;
  const data = niftiTypedArray(header.datatypeCode, nifti.readImage(header as never, buf));
  const loaded: LoadedVolume = {
    header,
    data,
    window: computeVolumeWindow(data, header.scl_slope || 1, header.scl_inter || 0),
  };

  volumeCache.set(key, loaded);
  while (volumeCache.size > VOLUME_CACHE_MAX) {
    const oldest = volumeCache.keys().next().value;
    if (oldest === undefined) break;
    volumeCache.delete(oldest);
  }
  return loaded;
}

/**
 * World axes, NIfTI/RAS+ convention: +x = Right, +y = Anterior, +z = Superior.
 * The affine's column j is the world direction travelled by stepping +1 along
 * array axis j, which is what lets us say *which* array axis is the slice
 * direction for each anatomical plane instead of assuming k is axial.
 */
const WORLD_R = 0;
const WORLD_A = 1;
const WORLD_S = 2;

interface AxisAssignment {
  /** worldAxis -> which array axis travels along it. */
  voxelAxisFor: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  /** worldAxis -> +1 if increasing that array index moves in the positive world direction. */
  sign: [number, number, number];
}

/**
 * Greedy strongest-component matching, so an oblique acquisition still yields a
 * true permutation of axes (never two planes mapped to the same array axis).
 */
function assignAxes(affine: number[][]): AxisAssignment {
  const candidates: { world: number; voxel: number; magnitude: number; sign: number }[] = [];
  for (let world = 0; world < 3; world++) {
    for (let voxel = 0; voxel < 3; voxel++) {
      const v = affine?.[world]?.[voxel] ?? 0;
      candidates.push({ world, voxel, magnitude: Math.abs(v), sign: v < 0 ? -1 : 1 });
    }
  }
  candidates.sort((a, b) => b.magnitude - a.magnitude);

  const voxelAxisFor: (0 | 1 | 2 | undefined)[] = [undefined, undefined, undefined];
  const sign: number[] = [1, 1, 1];
  const usedVoxel = new Set<number>();
  for (const c of candidates) {
    if (voxelAxisFor[c.world] !== undefined || usedVoxel.has(c.voxel)) continue;
    voxelAxisFor[c.world] = c.voxel as 0 | 1 | 2;
    sign[c.world] = c.sign;
    usedVoxel.add(c.voxel);
  }
  // Degenerate/all-zero affine: fall back to the NIfTI default of array order i,j,k = R,A,S.
  for (let world = 0; world < 3; world++) {
    if (voxelAxisFor[world] === undefined) {
      const free = [0, 1, 2].find((v) => !usedVoxel.has(v)) ?? world;
      voxelAxisFor[world] = free as 0 | 1 | 2;
      usedVoxel.add(free);
    }
  }

  return {
    voxelAxisFor: voxelAxisFor as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2],
    sign: sign as [number, number, number],
  };
}

/** Largest rendered edge. Keeps a reslice through a big volume bounded without changing its aspect ratio. */
const MAX_RENDER_EDGE = 1024;

/**
 * Smallest edge a full-size reslice is allowed to come out at.
 *
 * A 200 x 271 px PET plane is a correct physical rendering, but the viewer
 * displays it around 700 px wide, so the browser upscales it ~3.5x with its own
 * smoothing and the result looks soft. Resampling on the server instead keeps
 * one interpolation step in one place. Only raises small planes; anything
 * already this size is untouched, which makes it a no-op for 512-wide CT and MR.
 */
const MIN_FULL_EDGE = envInt("SCANLAB_RENDER_MIN_EDGE", 512, 64, MAX_RENDER_EDGE);

/**
 * Display convention (fixed, and the same for every modality so left/right can
 * never silently swap between studies):
 *   Axial    - screen x -> patient Left, screen y -> Posterior  (anterior at top, patient right on the viewer's left)
 *   Coronal  - screen x -> patient Left, screen y -> Inferior   (superior at top, patient right on the viewer's left)
 *   Sagittal - screen x -> Posterior,    screen y -> Inferior   (superior at top, anterior on the viewer's left)
 */
const PLANE_SCREEN_AXES: Record<MprPlane, { through: number; horizontal: number; vertical: number }> = {
  Axial: { through: WORLD_S, horizontal: WORLD_R, vertical: WORLD_A },
  Coronal: { through: WORLD_A, horizontal: WORLD_R, vertical: WORLD_S },
  Sagittal: { through: WORLD_R, horizontal: WORLD_A, vertical: WORLD_S },
};

function geometryFromHeader(header: NiftiHeaderFields): NiftiGeometry {
  const dims: [number, number, number] = [
    Math.max(1, header.dims?.[1] ?? 1),
    Math.max(1, header.dims?.[2] ?? 1),
    Math.max(1, header.dims?.[3] ?? 1),
  ];
  const spacing: [number, number, number] = [
    positiveOr(header.pixDims?.[1], 1),
    positiveOr(header.pixDims?.[2], 1),
    positiveOr(header.pixDims?.[3], 1),
  ];
  return planesFromAffine(
    dims,
    spacing,
    header.affine ?? [],
    (header.qform_code ?? 0) > 0 || (header.sform_code ?? 0) > 0
  );
}

/**
 * The shared geometry core: given array dimensions, mm spacing, and a RAS
 * affine whose column *j* is the world direction of +1 step along array axis
 * *j*, work out for each anatomical plane which array axis to step through and
 * which two to draw on screen.
 *
 * Shared deliberately. NIfTI (MRI/PET) gets its affine from qform/sform;
 * reconstructed DICOM stacks (CT) get theirs from ImageOrientationPatient.
 * Both then land in exactly the same axis-assignment and display-convention
 * code, so a coronal CT and a coronal MR cannot disagree about which side of
 * the image is the patient's left.
 */
function planesFromAffine(
  dims: [number, number, number],
  spacing: [number, number, number],
  affine: number[][],
  hasSpatialTransform: boolean
): NiftiGeometry {
  const { voxelAxisFor, sign } = assignAxes(affine);

  const planes = {} as Record<MprPlane, NiftiPlaneGeometry>;
  for (const plane of MPR_PLANES) {
    const map = PLANE_SCREEN_AXES[plane];
    // Every screen axis is defined as travelling in the negative world
    // direction (Left = -R, Posterior = -A, Inferior = -S), so an array axis
    // that increases along the positive world direction must be walked backwards.
    // The through-axis is deliberately NOT flipped: slice 0 stays array index 0,
    // so axial slice numbering is byte-for-byte what it was before MPR existed.
    const through: AxisRef = { axis: voxelAxisFor[map.through], flip: false };
    const horizontal: AxisRef = { axis: voxelAxisFor[map.horizontal], flip: sign[map.horizontal] > 0 };
    const vertical: AxisRef = { axis: voxelAxisFor[map.vertical], flip: sign[map.vertical] > 0 };

    const nH = dims[horizontal.axis];
    const nV = dims[vertical.axis];
    const pixel = Math.min(spacing[horizontal.axis], spacing[vertical.axis]);
    let width = Math.max(1, Math.round((nH * spacing[horizontal.axis]) / pixel));
    let height = Math.max(1, Math.round((nV * spacing[vertical.axis]) / pixel));
    const longest = Math.max(width, height);
    if (longest > MAX_RENDER_EDGE) {
      const scale = MAX_RENDER_EDGE / longest;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }

    planes[plane] = { sliceCount: dims[through.axis], width, height, through, horizontal, vertical };
  }

  // Coarsest through-plane spacing = the slice-select direction = the plane the
  // scanner actually acquired. Reported so the UI can say which planes are
  // reconstructions rather than implying all three were acquired.
  let acquiredPlane: MprPlane = "Axial";
  let coarsest = -Infinity;
  for (const plane of MPR_PLANES) {
    const s = spacing[planes[plane].through.axis];
    if (s > coarsest) {
      coarsest = s;
      acquiredPlane = plane;
    }
  }

  return { dims, spacing, planes, acquiredPlane, hasSpatialTransform };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** DICOM DS/IS multi-valued strings are backslash-separated. Returns undefined unless every requested component parses. */
function parseDecimalString(raw: string | undefined, count: number): number[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split("\\").map((s) => Number(s.trim()));
  if (parts.length < count) return undefined;
  const out = parts.slice(0, count);
  if (out.some((n) => !Number.isFinite(n))) return undefined;
  return out;
}

// ---------------------------------------------------------------------------
// Reconstructed DICOM volumes (CT MPR)
// ---------------------------------------------------------------------------

/*
 * A CT series arrives as hundreds of single-slice DICOM instances. Each one
 * renders fine on its own — that is the existing `kind: "dicom"` path, which is
 * left exactly as it was — but a coronal or sagittal view exists only across
 * the stack. This section reconstructs that stack into a real 3-D array and
 * reslices it through the shared geometry core.
 *
 * Nothing here rotates a 2-D axial image. The axis mapping comes from
 * ImageOrientationPatient (0020,0037) and the slice direction from the spacing
 * of ImagePositionPatient (0020,0032) along the slice normal. If a series
 * carries neither, no MPR series is emitted for it at all rather than a
 * plausible-looking fake.
 */

/** One stack member, as far as geometry is concerned. */
export interface DicomStackEntry {
  absPath: string;
  summary: DicomSummary;
}

/**
 * Sorts a stack into true spatial order.
 *
 * InstanceNumber is what the previous axial-only path sorted by, and it is
 * usually right, but it is a display hint rather than a geometric fact — some
 * series number instances per-acquisition, or not at all. Projecting
 * ImagePositionPatient onto the slice normal gives the physical order, which is
 * the only ordering that makes a reslice anatomically correct. The old
 * comparators stay as fallbacks for series with no positions.
 */
export function orderDicomStack(entries: DicomStackEntry[]): DicomStackEntry[] {
  const normal = sliceNormalFor(entries);
  if (!normal) return entries;
  const positioned = entries.every((e) => e.summary.imagePositionPatient);
  if (!positioned) return entries;
  return [...entries].sort((a, b) => {
    const pa = dot(a.summary.imagePositionPatient!, normal);
    const pb = dot(b.summary.imagePositionPatient!, normal);
    if (pa !== pb) return pa - pb;
    return (a.summary.instanceNumber ?? 0) - (b.summary.instanceNumber ?? 0);
  });
}

function sliceNormalFor(entries: DicomStackEntry[]): [number, number, number] | undefined {
  const iop = entries.find((e) => e.summary.imageOrientationPatient)?.summary.imageOrientationPatient;
  if (!iop) return undefined;
  return cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

/** DICOM patient coordinates are LPS; the shared geometry core is RAS+. */
function lpsToRas(v: readonly number[]): [number, number, number] {
  return [-(v[0] ?? 0), -(v[1] ?? 0), v[2] ?? 0];
}

function envInt(name: string, fallback: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * A 512 x 512 x 558 CT stack held as Float32 is 585 MB, which is not something
 * to keep in a dev server's memory to draw a 700 px viewport. In-plane
 * decimation is applied while loading and the *spacing* is scaled by the same
 * factor, so the reconstruction stays physically proportional — a 2 mm-wide
 * decimated voxel is described as 2 mm wide.
 *
 * Through-plane resolution is never decimated: that axis is the whole point of
 * an MPR and is already the coarsest one.
 */
const VOLUME_MAX_EDGE = envInt("SCANLAB_VOLUME_MAX_EDGE", 256, 64, 1024);
const VOLUME_MAX_MB = envInt("SCANLAB_VOLUME_MAX_MB", 384, 32, 4096);

export interface DicomStackGeometry extends NiftiGeometry {
  /** Number of instances in the stack. */
  count: number;
  /** In-plane decimation factor applied when loading (1 = full resolution). */
  step: number;
  /** Undecimated per-instance dimensions, for reporting. */
  sourceRows: number;
  sourceColumns: number;
  /** Signed mm step along the slice normal between consecutive instances. */
  sliceDelta: number;
  /** True when the spacing came from measured positions rather than SliceThickness. */
  spacingFromPositions: boolean;
}

/**
 * Derives the volume geometry of an ordered DICOM stack from its headers alone.
 *
 * Returns undefined — deliberately, rather than assuming a plane — when the
 * series cannot support a reconstruction: fewer than `MIN_STACK_SLICES`
 * instances, inconsistent in-plane dimensions, or no
 * ImageOrientationPatient to establish which way the rows and columns point.
 */
export function describeDicomStack(entries: DicomStackEntry[]): DicomVolumeRef | undefined {
  if (entries.length < MIN_STACK_SLICES) return undefined;

  const first = entries[0]?.summary;
  const rows = first?.rows ?? 0;
  const columns = first?.columns ?? 0;
  if (!rows || !columns) return undefined;
  // A stack whose instances disagree on size is not one geometric volume.
  if (entries.some((e) => e.summary.rows !== rows || e.summary.columns !== columns)) return undefined;

  const iop = entries.find((e) => e.summary.imageOrientationPatient)?.summary.imageOrientationPatient;
  if (!iop) return undefined;
  // A series whose instances point in different directions (multi-orientation
  // acquisitions, some localisers) is several volumes sharing a SeriesInstanceUID.
  // Reslicing it as one would blend unrelated geometry, so it is left alone.
  const consistent = entries.every((e) => {
    const other = e.summary.imageOrientationPatient;
    if (!other) return true;
    return other.every((v, i) => Math.abs(v - iop[i]) <= IOP_TOLERANCE);
  });
  if (!consistent) return undefined;

  const normalLps = cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
  const { delta, fromPositions } = sliceDeltaFor(entries, normalLps);
  if (!Number.isFinite(delta) || delta === 0) return undefined;

  return {
    files: entries.map((e) => e.absPath),
    rows,
    columns,
    // PixelSpacing is [between rows, between columns] = [dj, di].
    pixelSpacing: [positiveOr(first?.pixelSpacing?.[0], 1), positiveOr(first?.pixelSpacing?.[1], 1)],
    iop: [iop[0], iop[1], iop[2], iop[3], iop[4], iop[5]],
    sliceDelta: delta,
    spacingFromPositions: fromPositions,
  };
}

/**
 * The render-time half: turns the compact volume descriptor persisted in the
 * manifest into the same plane geometry NIfTI volumes go through.
 *
 * Pure and header-free by design. The alternative — re-reading 500 DICOM
 * headers on every slice request just to rediscover the orientation the indexer
 * already measured — would double the I/O of every CT reslice.
 */
export function dicomVolumeGeometry(ref: DicomVolumeRef): DicomStackGeometry | undefined {
  const count = ref.files.length;
  if (count < MIN_STACK_SLICES || !ref.rows || !ref.columns) return undefined;

  const iop = ref.iop;
  const colDir = lpsToRas([iop[0], iop[1], iop[2]]); // +1 col => +1 along array axis i
  const rowDir = lpsToRas([iop[3], iop[4], iop[5]]); // +1 row => +1 along array axis j
  const normalRas = lpsToRas(cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]));

  const rowSpacing = positiveOr(ref.pixelSpacing[0], 1);
  const colSpacing = positiveOr(ref.pixelSpacing[1], 1);
  const delta = ref.sliceDelta;
  if (!Number.isFinite(delta) || delta === 0) return undefined;

  const step = decimationFor(ref.rows, ref.columns, count);
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil(ref.columns / step)),
    Math.max(1, Math.ceil(ref.rows / step)),
    count,
  ];
  const spacing: [number, number, number] = [colSpacing * step, rowSpacing * step, Math.abs(delta)];

  // Column j of the affine is the world direction of +1 step along array axis j.
  const affine = [0, 1, 2].map((world) => [
    colDir[world] * spacing[0],
    rowDir[world] * spacing[1],
    normalRas[world] * delta,
  ]);

  const base = planesFromAffine(dims, spacing, affine, true);
  return {
    ...base,
    count,
    step,
    sourceRows: ref.rows,
    sourceColumns: ref.columns,
    sliceDelta: delta,
    spacingFromPositions: ref.spacingFromPositions,
  };
}

/** Below this a "volume" is a localiser or a scout pair, and a reslice would be a single line of pixels. */
export const MIN_STACK_SLICES = 8;

/**
 * How far two instances' direction cosines may differ and still count as the
 * same plane. ImageOrientationPatient is DS-encoded (a decimal *string*), so a
 * scanner writing "0.99999999" on one instance and "1" on the next is the same
 * geometry with different rounding. 1e-3 rad-equivalent absorbs that while
 * still rejecting a genuinely re-angled acquisition, which must not be blended
 * into one volume.
 */
const IOP_TOLERANCE = 1e-3;

/**
 * Signed centre-to-centre step along the slice normal.
 *
 * Measured from the actual end-to-end distance rather than the first gap, so a
 * single duplicated or missing instance does not set the spacing for the whole
 * volume. The sign is kept: a stack ordered against its own normal produces a
 * negative step, which the affine needs in order to map the k axis to the right
 * anatomical direction.
 */
function sliceDeltaFor(
  entries: DicomStackEntry[],
  normalLps: readonly number[]
): { delta: number; fromPositions: boolean } {
  const firstPos = entries[0]?.summary.imagePositionPatient;
  const lastPos = entries[entries.length - 1]?.summary.imagePositionPatient;
  if (firstPos && lastPos && entries.length > 1) {
    const span = dot(lastPos, normalLps) - dot(firstPos, normalLps);
    if (Number.isFinite(span) && span !== 0) {
      return { delta: span / (entries.length - 1), fromPositions: true };
    }
  }
  const nominal =
    positiveOr(entries[0]?.summary.spacingBetweenSlices, 0) || positiveOr(entries[0]?.summary.sliceThickness, 0);
  /*
   * No fallback to 1 mm. A stack with neither positions nor a nominal thickness
   * gives us no way to know how far apart its slices really are, and a guessed
   * spacing produces a reslice that looks plausible while being anatomically
   * wrong — exactly the fabricated-plane failure we must not ship. Returning 0
   * makes `describeDicomStack` bail, so the study keeps its real axial series
   * and the reason is recorded as an adapter issue instead.
   */
  return { delta: nominal, fromPositions: false };
}

/** Smallest in-plane decimation that satisfies both the edge cap and the memory budget. */
function decimationFor(rows: number, columns: number, count: number): number {
  let step = Math.max(1, Math.ceil(Math.max(rows, columns) / VOLUME_MAX_EDGE));
  const budget = VOLUME_MAX_MB * 1024 * 1024;
  while (Math.ceil(columns / step) * Math.ceil(rows / step) * count * 4 > budget && step < 32) {
    step += 1;
  }
  return step;
}

interface LoadedDicomStack {
  geometry: DicomStackGeometry;
  /** Rescaled values (HU for CT) in i-fastest order, matching `geometry.dims`. */
  data: Float32Array;
  /** One window for the whole stack, so cine playback does not pulse in brightness. */
  window: { lo: number; range: number };
  invert: boolean;
}

/**
 * Reconstructing a stack means reading and parsing every instance in the
 * series — a few hundred megabytes of I/O for a chest CT. One entry is enough:
 * a radiologist scrolls one series at a time, and holding two 384 MB volumes to
 * make series-switching faster is the wrong trade in a dev-scale process.
 */
const STACK_CACHE_MAX = 1;
const stackCache = new Map<string, LoadedDicomStack>();

/** Only uncompressed little-endian pixel data can be read straight out of the byte array. */
const READABLE_TRANSFER_SYNTAXES = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"]);

function stackKey(ref: DicomVolumeRef, step: number): string {
  const first = ref.files[0] ?? "";
  const last = ref.files[ref.files.length - 1] ?? "";
  return `${ref.files.length}::${step}::${first}::${last}`;
}

function loadDicomStack(ref: DicomVolumeRef): LoadedDicomStack | undefined {
  const geometry = dicomVolumeGeometry(ref);
  if (!geometry) return undefined;

  const key = stackKey(ref, geometry.step);
  const cached = stackCache.get(key);
  if (cached) {
    stackCache.delete(key);
    stackCache.set(key, cached);
    return cached;
  }

  const built = buildDicomStack(ref, geometry);
  if (!built) return undefined;

  stackCache.set(key, built);
  while (stackCache.size > STACK_CACHE_MAX) {
    const oldest = stackCache.keys().next().value;
    if (oldest === undefined) break;
    stackCache.delete(oldest);
  }
  return built;
}

function buildDicomStack(ref: DicomVolumeRef, geometry: DicomStackGeometry): LoadedDicomStack | undefined {
  const [nx, ny, nz] = geometry.dims;
  const sliceVoxels = nx * ny;
  const data = new Float32Array(sliceVoxels * nz);

  let min = Infinity;
  let max = -Infinity;
  let invert = false;
  let storedWindow: { center: number; width: number } | undefined;

  for (let k = 0; k < nz; k++) {
    const absPath = ref.files[k];
    if (!absPath) return undefined;
    const slice = decodeInstanceInto(absPath, geometry, data, k * sliceVoxels);
    if (!slice) return undefined;
    if (slice.min < min) min = slice.min;
    if (slice.max > max) max = slice.max;
    if (k === 0) {
      invert = slice.invert;
      storedWindow = slice.window;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }

  // Prefer the window the scanner stored; otherwise stretch the volume's own
  // measured range. Either way it is one window for the whole stack, and
  // neither is a hardcoded "lung"/"bone" preset invented here.
  const window =
    storedWindow && storedWindow.width > 0
      ? { lo: storedWindow.center - storedWindow.width / 2, range: storedWindow.width }
      : { lo: min, range: Math.max(1e-6, max - min) };

  return { geometry, data, window, invert };
}

interface DecodedSlice {
  min: number;
  max: number;
  invert: boolean;
  window?: { center: number; width: number };
}

/**
 * Decodes one instance's pixels straight into the volume buffer, decimated
 * in-plane by `geometry.step`.
 *
 * A separate decoder from `renderDicom` on purpose. `renderDicom` is the
 * live single-slice CT path and is left byte-for-byte as it was; sharing code
 * would have meant reshaping it to write into a caller-supplied buffer, which
 * is exactly the kind of change that silently breaks the view that already
 * works. The pixel interpretation below mirrors it (bits allocated, pixel
 * representation, rescale slope/intercept, photometric inversion) and reads
 * through a DataView so an odd `dataOffset` cannot throw the way a typed-array
 * view over an unaligned offset would.
 */
function decodeInstanceInto(
  absPath: string,
  geometry: DicomStackGeometry,
  target: Float32Array,
  offset: number
): DecodedSlice | undefined {
  let dataSet: ReturnType<typeof dicomParser.parseDicom>;
  try {
    dataSet = dicomParser.parseDicom(new Uint8Array(fs.readFileSync(absPath)));
  } catch {
    return undefined;
  }

  const transferSyntax = dataSet.string("x00020010");
  if (transferSyntax && !READABLE_TRANSFER_SYNTAXES.has(transferSyntax)) return undefined;

  const rows = dataSet.uint16("x00280010") ?? 0;
  const columns = dataSet.uint16("x00280011") ?? 0;
  if (rows !== geometry.sourceRows || columns !== geometry.sourceColumns) return undefined;

  const element = dataSet.elements.x7fe00010;
  const declaredLength = (element as { length?: number } | undefined)?.length ?? 0;
  if (!element || declaredLength <= 0) return undefined;

  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const signed = (dataSet.uint16("x00280103") ?? 0) === 1;
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  if (samplesPerPixel !== 1) return undefined; // colour CT does not exist; treat as unreadable rather than guessing a luma
  const slope = dataSet.floatString("x00281053") ?? 1;
  const inter = dataSet.floatString("x00281052") ?? 0;
  const bytesPerSample = bitsAllocated === 8 ? 1 : 2;

  const byteArray = dataSet.byteArray as Uint8Array;
  const available = Math.min(declaredLength, byteArray.byteLength - element.dataOffset);
  if (available < rows * columns * bytesPerSample) return undefined;
  const view = new DataView(byteArray.buffer, byteArray.byteOffset + element.dataOffset, available);

  const [nx, ny] = geometry.dims;
  const step = geometry.step;
  let min = Infinity;
  let max = -Infinity;

  for (let jj = 0; jj < ny; jj++) {
    const j = Math.min(jj * step, rows - 1);
    const rowStart = j * columns;
    for (let ii = 0; ii < nx; ii++) {
      const i = Math.min(ii * step, columns - 1);
      const at = (rowStart + i) * bytesPerSample;
      const stored =
        bytesPerSample === 1
          ? signed
            ? view.getInt8(at)
            : view.getUint8(at)
          : signed
            ? view.getInt16(at, true)
            : view.getUint16(at, true);
      const value = stored * slope + inter;
      target[offset + jj * nx + ii] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const center = dataSet.floatString("x00281050");
  const width = dataSet.floatString("x00281051");
  return {
    min,
    max,
    invert: (dataSet.string("x00280004") ?? "MONOCHROME2") === "MONOCHROME1",
    window: center !== undefined && width !== undefined && width > 0 ? { center, width } : undefined,
  };
}

/**
 * Reslices a reconstructed DICOM stack. `frameIndex` counts slices along the
 * requested plane's axis, exactly as it does for NIfTI — the two volumetric
 * sources share `resliceToPng`, so a coronal CT and a coronal MR are produced by
 * the same code with the same left/right convention.
 */
function renderDicomVolume(
  ref: DicomVolumeRef,
  frameIndex: number,
  plane?: SliceOrientation,
  maxEdge?: number
): RenderedImage {
  const stack = loadDicomStack(ref);
  if (!stack) {
    throw new Error(
      "This series could not be reconstructed into a volume — its instances are inconsistent, or their pixel data is in a compressed transfer syntax this renderer cannot read"
    );
  }

  const requested = isMprPlane(plane) ? plane : stack.geometry.acquiredPlane;
  const p = stack.geometry.planes[requested];
  if (p.sliceCount < 1) {
    throw new Error(`This volume has no ${requested.toLowerCase()} extent, so that plane cannot be reconstructed`);
  }

  return resliceToPng({
    data: stack.data,
    dims: stack.geometry.dims,
    plane: p,
    throughIndex: frameIndex,
    // Rescale slope/intercept were applied per instance while the volume was
    // built, so the stored values are already HU.
    slope: 1,
    inter: 0,
    window: stack.window,
    invert: stack.invert,
    maxEdge,
  });
}

// ---------------------------------------------------------------------------
// 3-D volume export (interactive CT render)
// ---------------------------------------------------------------------------

/**
 * A whole reconstructed stack as one 8-bit scalar field, ready to upload to the
 * GPU as a 3-D texture.
 *
 * `dims` is x-fastest (i, j, k) to match `bytes`, and `spacingMm` gives the real
 * physical size of one voxel along each of those axes — the viewer needs it to
 * scale the render box, otherwise a 5 mm-spaced chest CT comes out stretched
 * roughly 8x along the body axis.
 */
export interface ExportedVolume {
  bytes: Uint8Array;
  dims: [number, number, number];
  spacingMm: [number, number, number];
  /** The HU window that was mapped onto 0-255, so the client can label its own controls honestly. */
  windowLo: number;
  windowHi: number;
}

/** Hard cap on the 3-D texture edge. 128³ is 2 MB over the wire; 256³ is 16 MB and stalls a mid-range GPU. */
const VOLUME3D_MAX_EDGE = envInt("SCANLAB_VOLUME3D_MAX_EDGE", 128, 32, 256);

/**
 * Windows the loaded stack into 8 bits and decimates it to a GPU-friendly size.
 *
 * Quantizing to 8 bits is a display decision, not a data one: the diagnostic 2-D
 * planes still read the full-precision values. This exists only so the 3-D view
 * can exist at all — a 512x512x500 float volume is 500 MB and cannot be sent to
 * a browser.
 */
export function exportDicomVolume(ref: DicomVolumeRef, maxEdge: number = 256): ExportedVolume | undefined {
  const stack = loadDicomStack(ref);
  if (!stack) return undefined;

  const targetEdge = Math.max(32, Math.min(256, maxEdge));
  const [nx, ny, nz] = stack.geometry.dims;
  const step = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / targetEdge));
  const ox = Math.max(1, Math.ceil(nx / step));
  const oy = Math.max(1, Math.ceil(ny / step));
  const oz = Math.max(1, Math.ceil(nz / step));

  const { lo, range } = stack.window;
  const scale = range > 0 ? 255 / range : 0;
  const bytes = new Uint8Array(ox * oy * oz);

  let at = 0;
  for (let k = 0; k < oz; k++) {
    const sk = Math.min(k * step, nz - 1);
    for (let j = 0; j < oy; j++) {
      const sj = Math.min(j * step, ny - 1);
      const rowBase = sk * nx * ny + sj * nx;
      for (let i = 0; i < ox; i++) {
        const si = Math.min(i * step, nx - 1);
        const v = (stack.data[rowBase + si] ?? lo) - lo;
        let out = v * scale;
        if (out < 0) out = 0;
        else if (out > 255) out = 255;
        bytes[at++] = stack.invert ? 255 - out : out;
      }
    }
  }

  const [sx, sy, sz] = stack.geometry.spacing;
  return {
    bytes,
    dims: [ox, oy, oz],
    spacingMm: [sx * step, sy * step, sz * step],
    windowLo: lo,
    windowHi: lo + range,
  };
}

/**
 * Windows the loaded NIfTI volume into 8 bits and decimates it to a GPU-friendly size
 * with exact physical millimeter voxel spacing.
 */
export function exportNiftiVolume(absPath: string, maxEdge: number = 256): ExportedVolume | undefined {
  const loaded = loadVolume(absPath);
  if (!loaded) return undefined;

  const { header, data, window } = loaded;
  const nx = Math.max(1, header.dims?.[1] ?? 1);
  const ny = Math.max(1, header.dims?.[2] ?? 1);
  const nz = Math.max(1, header.dims?.[3] ?? 1);

  const sx = positiveOr(header.pixDims?.[1], 1);
  const sy = positiveOr(header.pixDims?.[2], 1);
  const sz = positiveOr(header.pixDims?.[3], 1);

  const targetEdge = Math.max(32, Math.min(256, maxEdge));
  const step = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / targetEdge));
  const ox = Math.max(1, Math.ceil(nx / step));
  const oy = Math.max(1, Math.ceil(ny / step));
  const oz = Math.max(1, Math.ceil(nz / step));

  const { lo, range } = window;
  const scale = range > 0 ? 255 / range : 0;
  const bytes = new Uint8Array(ox * oy * oz);

  const slope = header.scl_slope || 1;
  const inter = header.scl_inter || 0;

  let at = 0;
  for (let k = 0; k < oz; k++) {
    const sk = Math.min(k * step, nz - 1);
    for (let j = 0; j < oy; j++) {
      const sj = Math.min(j * step, ny - 1);
      const rowBase = sk * nx * ny + sj * nx;
      for (let i = 0; i < ox; i++) {
        const si = Math.min(i * step, nx - 1);
        const raw = data[rowBase + si] ?? 0;
        const val = raw * slope + inter;
        const v = val - lo;
        let out = v * scale;
        if (out < 0) out = 0;
        else if (out > 255) out = 255;
        bytes[at++] = Math.round(out);
      }
    }
  }

  return {
    bytes,
    dims: [ox, oy, oz],
    spacingMm: [sx * step, sy * step, sz * step],
    windowLo: lo,
    windowHi: lo + range,
  };
}


// ---------------------------------------------------------------------------
// Thumbnail downscaling
// ---------------------------------------------------------------------------

/**
 * Resamples an already-encoded PNG down to `maxEdge`.
 *
 * Only used for the single-slice DICOM path, where rendering small directly
 * would mean modifying the working full-resolution renderer. Volumetric renders
 * take `maxEdge` into the reslice itself and never reach this. Non-PNG input
 * (a source JPEG) is returned untouched.
 */
function downscalePng(image: RenderedImage, maxEdge: number): RenderedImage {
  if (image.contentType !== "image/png") return image;

  let png: PNG;
  try {
    png = PNG.sync.read(image.bytes);
  } catch {
    return image;
  }

  const [width, height] = fitEdge(png.width, png.height, maxEdge);
  if (width === png.width && height === png.height) return image;

  const out = new PNG({ width, height });
  for (let oy = 0; oy < height; oy++) {
    const sy = Math.min(png.height - 1, Math.floor((oy * png.height) / height));
    for (let ox = 0; ox < width; ox++) {
      const sx = Math.min(png.width - 1, Math.floor((ox * png.width) / width));
      const from = (sy * png.width + sx) * 4;
      const to = (oy * width + ox) * 4;
      out.data[to] = png.data[from] ?? 0;
      out.data[to + 1] = png.data[from + 1] ?? 0;
      out.data[to + 2] = png.data[from + 2] ?? 0;
      out.data[to + 3] = png.data[from + 3] ?? 255;
    }
  }

  return { contentType: "image/png", bytes: PNG.sync.write(out) };
}
