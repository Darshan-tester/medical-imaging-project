/**
 * ---------------------------------------------------------------------------
 * RENDERING AN UPLOADED IMAGE
 * ---------------------------------------------------------------------------
 * `uploadImageUrl` produces a marker, not a URL the browser can fetch: the
 * pixels are bytes in IndexedDB. This module is what turns one of those markers
 * into an object URL an `<img>` can show, and it is the upload half of
 * `lib/demo/decode.ts` — same job, different source of bytes.
 *
 * Deliberately not a second decoder. The DICOM path is `decodeDicomBytes` from
 * the demo module and the canvas encode is its `grayToObjectUrl`, so an uploaded
 * CT slice and a committed one go through the same windowing and the same
 * encoder. Only the NIfTI path is separate, and only because it has to be: a
 * demo volume carries a server-measured display window in `index.json`, and an
 * uploaded one has never been near a server, so the window is measured here from
 * the volume's own voxels.
 *
 * Nothing in this module fetches. Nothing in it consults the demo index. A
 * marker whose bytes are not in the store rejects, and the caller shows a failed
 * image rather than a substitute.
 *
 * Browser-only, and imported on demand by `ScanThumbnail`.
 * ---------------------------------------------------------------------------
 */

import * as nifti from "nifti-reader-js";

import { niftiTypedArray, VoxelArray } from "../dataset/nifti-voxels";
import { decodeDicomBytes, grayToObjectUrl } from "../demo/decode";
import { DecodedImage, peekSlice, putSlice } from "../viewer/slice-cache";
import { getUploadBytes, getUploadRecord } from "./db";
import { parseUploadUrl, UploadedFileRecord, UploadImageRef } from "./types";

/*
 * Caches.
 *
 * Decoded slices go in the shared LRU in `lib/viewer/slice-cache.ts` — the same
 * one the demo decoder fills, because a decoded slice is a decoded slice however
 * its bytes arrived, and two caches over the same kind of object mean two
 * eviction policies and two chances to leak a Blob.
 *
 * `volumeCache` stays local: it holds inflated voxels, which is the expensive
 * part here — without it, every slice of a gzipped NIfTI would inflate the whole
 * volume again. `inflight` collapses the duplicate requests a fast scroll
 * produces into one decode.
 */
const VOLUME_CACHE_MAX = 2;

const volumeCache = new Map<string, UploadVolume>();
const inflight = new Map<string, Promise<DecodedImage>>();

interface UploadVolume {
  data: VoxelArray;
  dims: [number, number, number];
  slope: number;
  inter: number;
  /** Measured over this volume's own voxels — never a modality preset. */
  win: { lo: number; range: number };
  /** True when the file's affine says increasing row index moves the far way up. */
  flipRows: boolean;
}

function touch<T>(cache: Map<string, T>, key: string): T | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/**
 * Decodes one uploaded-image marker URL.
 *
 * Rejects rather than returning a placeholder — the caller decides what a failed
 * image looks like, and substituting anything for medical pixels is not a
 * decision this module gets to make.
 */
export function decodeUploadImage(url: string): Promise<DecodedImage> {
  const cached = peekSlice(url);
  if (cached) return Promise.resolve(cached);

  const running = inflight.get(url);
  if (running) return running;

  const ref = parseUploadUrl(url);
  if (!ref) return Promise.reject(new Error("Not an uploaded-image URL"));

  const task = renderRef(ref)
    .then((image) => putSlice(url, image))
    .finally(() => inflight.delete(url));

  inflight.set(url, task);
  return task;
}

async function renderRef(ref: UploadImageRef): Promise<DecodedImage> {
  const record = await getUploadRecord(ref.studyId);
  if (!record) {
    // The study is not in the store: a bookmark from a private window, or bytes
    // that only ever lived in a page session that has since ended.
    throw new Error("This uploaded study is no longer in this browser's storage");
  }

  const file = record.files.find((f) => f.blobId === ref.blobId);
  if (!file) throw new Error("That file is not part of this uploaded study");

  const stored = await getUploadBytes(ref.studyId, ref.blobId);
  if (!stored) throw new Error(`The stored data for ${file.name} could not be read back`);

  if (file.kind === "dicom") {
    return decodeDicomBytes(new Uint8Array(stored.bytes), ref.maxEdge, ref.frame);
  }

  if (file.kind === "nifti") {
    return renderNiftiFrame(ref, stored.bytes);
  }

  return rasterObjectUrl(file, stored);
}

// ---------------------------------------------------------------------------
// NIFTI
// ---------------------------------------------------------------------------

/**
 * Inflates and types an uploaded volume once, then keeps it.
 *
 * The display window is a straight min/max over every voxel in the volume. It is
 * measured once rather than per slice on purpose: a per-slice stretch makes the
 * brightness jump as you scroll, and each slice would be windowed against a
 * different range — the same tissue would read as two different intensities.
 */
async function loadVolume(key: string, bytes: ArrayBuffer): Promise<UploadVolume> {
  const cached = touch(volumeCache, key);
  if (cached) return cached;

  let buf = bytes;
  // Pure-JS inflate via `fflate`, so this is the same in the browser as in Node.
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) throw new Error("Not a valid NIfTI file");

  const header = nifti.readHeader(buf);
  if (!header) throw new Error("NIfTI header could not be read");

  const dims: [number, number, number] = [
    header.dims[1] ?? 0,
    header.dims[2] ?? 0,
    Math.max(1, header.dims[3] ?? 1),
  ];
  if (dims[0] < 1 || dims[1] < 1) throw new Error("This NIfTI volume has no usable extent");

  const data = niftiTypedArray(header.datatypeCode, nifti.readImage(header, buf));
  const slope = header.scl_slope || 1;
  const inter = header.scl_inter || 0;

  const volume: UploadVolume = {
    data,
    dims,
    slope,
    inter,
    win: measureWindow(data, slope, inter),
    flipRows: rowsRunUpward(header),
  };

  volumeCache.set(key, volume);
  while (volumeCache.size > VOLUME_CACHE_MAX) {
    const oldest = volumeCache.keys().next();
    if (oldest.done) break;
    volumeCache.delete(oldest.value);
  }
  return volume;
}

/** Real min and max of the real voxels, scaled the way the header says to scale them. */
function measureWindow(data: VoxelArray, slope: number, inter: number): { lo: number; range: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, range: 1 };

  const a = min * slope + inter;
  const b = max * slope + inter;
  const lo = Math.min(a, b);
  return { lo, range: Math.max(1e-6, Math.abs(b - a)) };
}

/**
 * Whether the stored rows have to be walked from the far end to come out the
 * right way up.
 *
 * NIfTI's transform is defined into RAS+, so the affine's second column is the
 * direction the row index advances in patient space. Screen-down is posterior on
 * an axial image and inferior on a sagittal or coronal one — both of which are
 * the negative direction of that column's dominant axis — so a column pointing
 * the positive way means the stored rows are upside down for display.
 *
 * This is the file's own geometry, read the same way `readNiftiGeometry` reads it
 * server-side for the indexed studies. A header that declares no transform gets
 * no flip: there is then nothing that says which way is up, and inventing one is
 * worse than showing the volume as it was stored.
 */
function rowsRunUpward(header: { affine?: number[][]; sform_code?: number; qform_code?: number }): boolean {
  if (!(header.sform_code ?? 0) && !(header.qform_code ?? 0)) return false;

  const column = [header.affine?.[0]?.[1], header.affine?.[1]?.[1], header.affine?.[2]?.[1]];
  if (!column.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return false;

  const magnitudes = column.map((v) => Math.abs(v as number));
  const dominant = magnitudes.indexOf(Math.max(...magnitudes));
  return (column[dominant] as number) > 0;
}

/**
 * One stored slice of an uploaded volume.
 *
 * The stored plane and nothing else: axis 0 across, axis 1 down, axis 2 the
 * frame. No reslice, no interpolation, no resampling — every pixel below is one
 * measured voxel. Reconstructing the other two planes would mean deriving a
 * geometry this path has not verified, and a plane labelled wrongly is a
 * clinical error rather than a cosmetic one.
 */
async function renderNiftiFrame(ref: UploadImageRef, bytes: ArrayBuffer): Promise<DecodedImage> {
  const volume = await loadVolume(`${ref.studyId}/${ref.blobId}`, bytes);
  const [nx, ny, nz] = volume.dims;

  const frame = Math.min(Math.max(0, ref.frame), nz - 1);
  const base = frame * nx * ny;
  const { lo, range } = volume.win;
  const gray = new Uint8Array(nx * ny);

  for (let row = 0; row < ny; row++) {
    const source = volume.flipRows ? ny - 1 - row : row;
    const from = base + source * nx;
    const to = row * nx;
    for (let col = 0; col < nx; col++) {
      const value = volume.data[from + col] * volume.slope + volume.inter;
      let v = Math.round(((value - lo) / range) * 255);
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      gray[to + col] = v;
    }
  }

  return grayToObjectUrl(gray, nx, ny, ref.maxEdge);
}

/**
 * An ordinary image needs no decoding — the bytes are already a PNG or a JPEG,
 * so they become a Blob URL directly and the browser does the rest.
 *
 * The dimensions are whatever the parser measured at upload time, and zero when
 * it could not. Nothing reads them: `ScanThumbnail` takes its natural size from
 * the loaded `<img>`, which is the only source that cannot be wrong.
 */
function rasterObjectUrl(file: UploadedFileRecord, stored: { bytes: ArrayBuffer; mimeType: string }): DecodedImage {
  const blob = new Blob([stored.bytes], { type: stored.mimeType || file.mimeType });
  return {
    objectUrl: URL.createObjectURL(blob),
    width: file.raster?.width ?? 0,
    height: file.raster?.height ?? 0,
  };
}

