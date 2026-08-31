import path from "path";
import { fileStem, stableId } from "../fs-utils";
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
  const images: DatasetImageRef[] = opts.files
    .map((absPath, index) => {
      const kind = extKind(absPath);
      if (!kind) return undefined;
      return {
        id: stableId(opts.seriesId, String(index), absPath),
        index,
        kind,
        absPath,
      } satisfies DatasetImageRef;
    })
    .filter((x): x is DatasetImageRef => !!x);
  return {
    id: opts.seriesId,
    label: opts.label,
    modality: opts.modality,
    orientation: opts.orientation,
    sliceCount: images.length,
    images,
  };
}

export function shortAlias(seed: string, prefix: string): string {
  const hash = stableId(seed);
  return `${prefix}-${hash.slice(0, 6).toUpperCase()}`;
}

export function studyCode(dataset: string, seed: string): string {
  return `${dataset}-${stableId(seed).slice(0, 6).toUpperCase()}`;
}

export { fileStem };
