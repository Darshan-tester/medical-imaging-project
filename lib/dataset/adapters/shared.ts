import path from "path";
import { fileStem, stableId } from "../fs-utils";
import { MPR_PLANES, readNiftiGeometry } from "../image-render";
import { DatasetImageRef, DatasetSeries, ImageSourceKind, NormalizedModality, SliceOrientation } from "../types";

export const RASTER_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
export const DICOM_EXTS = [".dcm"];
export const NIFTI_EXTS = [".nii", ".nii.gz"];
export const ZIP_EXTS = [".zip"];

/** Filenames rarely sort correctly as plain strings ("img2" before "img10") — this fixes that for slice ordering. */
export function naturalSort(a: string, b: string): number {
  const chunk = (s: string) => s.match(/\d+|\D+/g) ?? [s];
  const ca = chunk(path.basename(a));
  const cb = chunk(path.basename(b));
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const x = ca[i] ?? "";
    const y = cb[i] ?? "";
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx - ny;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function extKind(absPath: string): ImageSourceKind | undefined {
  const lower = absPath.toLowerCase();
  if (RASTER_EXTS.some((e) => lower.endsWith(e))) return "raster";
  if (DICOM_EXTS.some((e) => lower.endsWith(e))) return "dicom";
  if (NIFTI_EXTS.some((e) => lower.endsWith(e))) return "nifti";
  return undefined;
}

/** Builds a DatasetSeries from an already-ordered list of same-kind image files. */
export function buildSeriesFromFiles(opts: {
  seriesId: string;
  label: string;
  modality: NormalizedModality;
  orientation: SliceOrientation;
  files: string[];
}): DatasetSeries {
  /*
   * Unsupported files are dropped BEFORE indices are handed out, so the indices
   * are contiguous 0…n-1.
   *
   * Taking the index from the raw file list and filtering afterwards left a gap
   * wherever a non-image file sat in the folder (a .txt, a stray .json). The
   * viewer walks 0…sliceCount-1 and looks each index up, so every gap was a
   * slice with no URL — which renders as a blank or wrong frame and is
   * indistinguishable from a broken decoder.
   */
  const usable = opts.files
    .map((absPath) => ({ absPath, kind: extKind(absPath) }))
    .filter((f): f is { absPath: string; kind: ImageSourceKind } => !!f.kind);

  const images: DatasetImageRef[] = usable.map(({ absPath, kind }, index) => ({
    id: stableId(opts.seriesId, String(index), absPath),
    index,
    kind,
    absPath,
  }));

  return {
    id: opts.seriesId,
    label: opts.label,
    modality: opts.modality,
    orientation: opts.orientation,
    sliceCount: images.length,
    images,
  };
}

/**
 * Builds one DatasetSeries per anatomical plane that a NIfTI volume genuinely
 * supports, reading the plane geometry out of the file's own header/affine.
 *
 * A volume is not a stack of files — it is a single container walked three
 * different ways. Each emitted series therefore points at the SAME absPath and
 * varies only `frameIndex` (slice within the plane) and `orientation` (which
 * voxel axis `frameIndex` counts along). The renderer resolves the axis from the
 * affine, so nothing here rotates or fakes a view. Because the refs of one plane
 * differ by nothing but their index, each series is stored as a single `frames`
 * run (see `series-frames.ts`) instead of one ref per slice.
 *
 * Planes with fewer than 2 slices are dropped rather than fabricated: a volume
 * that is 1 voxel thick in a direction has no reconstructable view along it.
 * Returns [] when the file has no readable NIfTI header.
 */
export function buildNiftiVolumeSeries(opts: {
  /** Namespace for deterministic ids — must be unique per volume within the study. */
  seriesIdSeed: string;
  /** Human label for the volume itself, e.g. "T2W" or "PET SUV". Plane is appended. */
  label: string;
  modality: NormalizedModality;
  absPath: string;
}): DatasetSeries[] {
  const geo = readNiftiGeometry(opts.absPath);
  if (!geo) return [];

  // Coarsest voxel spacing in the volume = the acquisition slice thickness. One
  // number explains both halves of what a reader needs to know: how thick the
  // native slices are, and why the two reconstructions are limited — each of
  // them samples that same coarse axis as one of its in-plane directions. A
  // 512 x 512 x 20 brain MR at 7.2 mm reconstructs into a legitimately correct
  // coronal image with only 20 rows of real data in it, and saying "7.2 mm
  // slices" on the label is the honest way to show that.
  const sliceThicknessMm = Math.max(geo.spacing[0], geo.spacing[1], geo.spacing[2]);
  const thickness = formatMm(sliceThicknessMm);

  const out: DatasetSeries[] = [];
  for (const plane of MPR_PLANES) {
    const p = geo.planes[plane];
    if (p.sliceCount < 2) continue;

    const seriesId = stableId(opts.seriesIdSeed, opts.absPath, plane);

    // Stored as one compact run rather than `sliceCount` near-identical refs:
    // every slice of a plane is the same file at a different frame index, so
    // writing them out individually is what blew the manifest past V8's string
    // limit. `seriesImageAt()` materializes any single slice on demand.
    const frames = {
      kind: "nifti" as const,
      absPath: opts.absPath,
      count: p.sliceCount,
      orientation: plane,
      width: p.width,
      height: p.height,
    };

    // The acquired plane is the one the scanner actually sampled (coarsest
    // through-plane spacing); the other two are honest reconstructions and are
    // labelled as such so a reader is never misled about what is native.
    const isAcquired = plane === geo.acquiredPlane;
    const qualifier = isAcquired ? thickness : `MPR · ${thickness}`;
    out.push({
      id: seriesId,
      label: `${opts.label} · ${plane}${qualifier ? ` (${qualifier})` : isAcquired ? "" : " (MPR)"}`,
      modality: opts.modality,
      orientation: plane,
      sliceCount: frames.count,
      images: [],
      frames,
    });
  }

  // Acquired plane first — that is the view a radiologist expects to land on.
  out.sort((a, b) => {
    const rank = (s: DatasetSeries) => (s.orientation === geo.acquiredPlane ? 0 : 1);
    return rank(a) - rank(b);
  });
  return out;
}

/**
 * Renders a millimetre spacing for a series label: "7.2 mm slices", "0.43 mm
 * slices". Returns "" for a non-finite or non-positive spacing so a volume with
 * an unusable pixdim gets no thickness claim at all rather than "0 mm".
 */
function formatMm(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return "";
  const rounded = mm >= 10 ? mm.toFixed(0) : mm >= 1 ? mm.toFixed(1) : mm.toFixed(2);
  return `${rounded.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")} mm slices`;
}

export function shortAlias(seed: string, prefix: string): string {
  const hash = stableId(seed);
  return `${prefix}-${hash.slice(0, 6).toUpperCase()}`;
}

export function studyCode(dataset: string, seed: string): string {
  return `${dataset}-${stableId(seed).slice(0, 6).toUpperCase()}`;
}

export { fileStem };
