import fs from "fs";
import { PNG } from "pngjs";
import * as dicomParser from "dicom-parser";
import * as nifti from "nifti-reader-js";
import { DatasetImageRef, SliceOrientation } from "./types";

export interface RenderedImage {
  contentType: string;
  bytes: Buffer;
}

/**
 * Resolves any indexed image reference to bytes the browser can display
 * directly. PNG/JPG pass straight through (no re-encoding, no quality
 * loss). DICOM and NIfTI are decoded and windowed into 8-bit grayscale PNGs
 * server-side — the browser never receives a `.dcm`/`.nii` file, which
 * `<img>` cannot render anyway.
 */
export function renderImage(ref: DatasetImageRef): RenderedImage {
  switch (ref.kind) {
    case "raster":
      return renderRaster(ref.absPath);
    case "dicom":
      return renderDicom(ref.absPath);
    case "nifti":
      return renderNifti(ref.absPath, ref.frameIndex ?? 0);
  }
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

export interface NiftiSummary {
  dims: [number, number, number]; // nx, ny, nz
  sliceCounts: Record<SliceOrientation, number>;
}

export function readNiftiSummary(absPath: string): NiftiSummary | undefined {
  try {
    let buf: ArrayBuffer = toArrayBuffer(fs.readFileSync(absPath));
    if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
    if (!nifti.isNIFTI(buf)) return undefined;
    const header = nifti.readHeader(buf);
    if (!header) return undefined;
    const nx = header.dims[1] ?? 0;
    const ny = header.dims[2] ?? 0;
    const nz = header.dims[3] ?? 1;
    return {
      dims: [nx, ny, nz],
      sliceCounts: { Axial: nz, Sagittal: nx, Coronal: ny, AP: 0, PA: 0, Lateral: 0, Unknown: 0 },
    };
  } catch {
    return undefined;
  }
}

/** `frameIndex` is the slice number along the requested orientation's axis, packed into the image ref at index time. */
function renderNifti(absPath: string, frameIndex: number): RenderedImage {
  let buf: ArrayBuffer = toArrayBuffer(fs.readFileSync(absPath));
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  const header = nifti.readHeader(buf);
  if (!header) throw new Error("Not a valid NIfTI file");
  const imageBuf = nifti.readImage(header, buf);

  const nx = header.dims[1];
  const ny = header.dims[2];
  const nz = header.dims[3] ?? 1;
  const typed = niftiTypedArray(header.datatypeCode, imageBuf);
  const slope = header.scl_slope || 1;
  const inter = header.scl_inter || 0;

  // Default to axial (fix z, sweep x/y) — the orientation the viewer's
  // SliceNavigator drives by default. Sagittal/coronal use the same flat
  // buffer, just walked along a different axis.
  const z = Math.max(0, Math.min(nz - 1, frameIndex));
  const width = nx;
  const height = ny;

  let min = Infinity;
  let max = -Infinity;
  const slice = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = z * ny * nx + y * nx + x;
      const v = typed[idx] * slope + inter;
      slice[y * width + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const png = new PNG({ width, height });
  const range = Math.max(1, max - min);
  for (let i = 0; i < width * height; i++) {
    // NIfTI's Y axis increases upward (radiological convention); flip rows so it displays right-side-up like the rest of the viewer.
    const row = Math.floor(i / width);
    const col = i % width;
    const flippedIdx = (height - 1 - row) * width + col;
    let v = Math.round(((slice[flippedIdx] - min) / range) * 255);
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    const o = i * 4;
    png.data[o] = v;
    png.data[o + 1] = v;
    png.data[o + 2] = v;
    png.data[o + 3] = 255;
  }

  return { contentType: "image/png", bytes: PNG.sync.write(png) };
}

function niftiTypedArray(datatypeCode: number, buf: ArrayBuffer): { [i: number]: number; length: number } {
  // Matches the NIFTI1.TYPE_* constants.
  switch (datatypeCode) {
    case 2:
      return new Uint8Array(buf);
    case 4:
      return new Int16Array(buf);
    case 8:
      return new Int32Array(buf);
    case 16:
      return new Float32Array(buf);
    case 64:
      return new Float64Array(buf);
    case 256:
      return new Int8Array(buf);
    case 512:
      return new Uint16Array(buf);
    case 768:
      return new Uint32Array(buf);
    default:
      return new Int16Array(buf);
  }
}

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
