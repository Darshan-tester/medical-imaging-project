/**
 * ---------------------------------------------------------------------------
 * UPLOADED STUDIES — SHARED CONTRACT
 * ---------------------------------------------------------------------------
 * An uploaded scan is a study in its own right. It is never matched to,
 * substituted for, or merged with a study from `public/demo-data/index.json`:
 * the demo index describes the committed datasets and nothing else, and an
 * upload gets a fresh id, its own record, its own images and its own report.
 *
 * This module is the seam between the three halves of that:
 *
 *   `parse.ts`    reads the files (dicom-parser / nifti-reader-js)
 *   `db.ts`       stores the record and the bytes (IndexedDB)
 *   `decode.ts`   renders a stored instance to something an <img> can show
 *
 * It is deliberately dependency-free and erasable — the studies list imports
 * `isUploadedStudyId` from here, and must not pull a DICOM parser into its
 * bundle to do so. The one import below is `import type`, so it emits nothing.
 * ---------------------------------------------------------------------------
 */

import type { Modality } from "../types";

/** Shown wherever the files carried no value. Never a substitute from elsewhere. */
export const NOT_AVAILABLE = "Not available";

/**
 * Prefix on every uploaded study id.
 *
 * Demo ids are 16-hex path hashes and dataset ids are the same shape, so this
 * cannot collide with either — which is what lets `fetchStudy` route an id to
 * the upload store without consulting the demo index at all.
 */
export const UPLOAD_STUDY_PREFIX = "upl_";

export function isUploadedStudyId(id: string): boolean {
  return id.startsWith(UPLOAD_STUDY_PREFIX);
}

/** Bumped if the stored record shape changes; older records are then ignored rather than misread. */
export const UPLOAD_RECORD_VERSION = 1;

/**
 * ---------------------------------------------------------------------------
 * PIXEL URLS
 * ---------------------------------------------------------------------------
 * Uploaded pixels are not a URL the browser can fetch: they are bytes in
 * IndexedDB. So a `ViewerImage.imageUrl` for an upload is a marker that
 * `ScanThumbnail` recognises and hands to `decodeUploadImage`, exactly as it
 * already does for the `?dcm=1` / `?nii=` markers of a committed demo asset.
 *
 *   /_uploaded/<studyId>/<blobId>?up=1&f=<frame>&w=<edge>
 *
 * The path is never requested over the network. `up=1` is the discriminator and
 * cannot be confused with a demo marker, which is keyed on `dcm` or `nii`.
 */
export const UPLOAD_PATH_PREFIX = "/_uploaded/";
export const UPLOAD_DECODE_PARAM = "up";
export const UPLOAD_FRAME_PARAM = "f";
export const UPLOAD_WIDTH_PARAM = "w";

export interface UploadImageRef {
  studyId: string;
  /** Which stored file within the study. */
  blobId: string;
  /** Which frame inside that file. Always 0 for a single-instance DICOM or a raster. */
  frame: number;
  /** Optional longest-edge cap, for filmstrip tiles. */
  maxEdge?: number;
}

export function uploadImageUrl(ref: UploadImageRef): string {
  const params = new URLSearchParams();
  params.set(UPLOAD_DECODE_PARAM, "1");
  params.set(UPLOAD_FRAME_PARAM, String(ref.frame));
  if (ref.maxEdge) params.set(UPLOAD_WIDTH_PARAM, String(ref.maxEdge));
  return `${UPLOAD_PATH_PREFIX}${encodeURIComponent(ref.studyId)}/${encodeURIComponent(ref.blobId)}?${params.toString()}`;
}

/** True for a marker URL produced by `uploadImageUrl`, false for anything else. */
export function isUploadDecodeUrl(url: string): boolean {
  const q = url.indexOf("?");
  if (q < 0 || !url.startsWith(UPLOAD_PATH_PREFIX)) return false;
  return new URLSearchParams(url.slice(q + 1)).get(UPLOAD_DECODE_PARAM) === "1";
}

export function parseUploadUrl(url: string): UploadImageRef | undefined {
  if (!isUploadDecodeUrl(url)) return undefined;

  const q = url.indexOf("?");
  const segments = url.slice(UPLOAD_PATH_PREFIX.length, q).split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return undefined;

  const params = new URLSearchParams(url.slice(q + 1));
  const frame = Number(params.get(UPLOAD_FRAME_PARAM) ?? 0);
  const width = Number(params.get(UPLOAD_WIDTH_PARAM));

  return {
    studyId: decodeURIComponent(segments[0]),
    blobId: decodeURIComponent(segments[1]),
    frame: Number.isFinite(frame) ? Math.max(0, Math.trunc(frame)) : 0,
    maxEdge: Number.isFinite(width) && width > 0 ? width : undefined,
  };
}

/**
 * ---------------------------------------------------------------------------
 * RECORD SHAPE
 * ---------------------------------------------------------------------------
 * What gets stored per upload. Every field is either read out of the files or
 * typed by the person doing the upload, and which of the two is recorded — so
 * the report can say where each value came from instead of presenting them
 * alike.
 */

/** How the bytes of one stored file are to be read back. */
export type UploadFileKind = "dicom" | "nifti" | "raster";

/** Values read out of a DICOM instance. Absent keys mean the tag was absent. */
export interface UploadedDicomMeta {
  patientName?: string;
  patientId?: string;
  patientSex?: "M" | "F" | "Other";
  /** Years, parsed from the DICOM `nnnY` form only. */
  patientAge?: number;
  patientHeightCm?: number;
  patientWeightKg?: number;
  /** Raw DICOM modality code, e.g. "CT", "MR", "DX". Kept verbatim. */
  modalityCode?: string;
  bodyPart?: string;
  /** ISO date derived from DICOM `YYYYMMDD`. */
  studyDate?: string;
  studyDescription?: string;
  studyInstanceUid?: string;
  accessionNumber?: string;
  seriesInstanceUid?: string;
  seriesNumber?: number;
  seriesDescription?: string;
  instanceNumber?: number;
  /** NumberOfFrames. A cine loop or an enhanced multi-frame instance is more than one image. */
  numberOfFrames?: number;
  rows?: number;
  columns?: number;
  /** Raw ViewPosition, e.g. "AP", "LL". Kept verbatim; mapped only for the series label. */
  viewPosition?: string;
  /** Derived from ImageOrientationPatient's own direction cosines. */
  orientation?: "Axial" | "Sagittal" | "Coronal";
  sliceThicknessMm?: number;
  pixelSpacing?: [number, number];
  manufacturer?: string;
  modelName?: string;
  institution?: string;
  protocolName?: string;
  /** CT/X-ray acquisition parameters, when the file states them. */
  kvp?: number;
  exposureMas?: number;
  /** MR acquisition parameters, when the file states them. */
  repetitionTimeMs?: number;
  echoTimeMs?: number;
  magneticFieldStrengthT?: number;
  scanningSequence?: string;
  contrastAgent?: string;
}

/** Values read out of a NIfTI header. */
export interface UploadedNiftiMeta {
  dims: [number, number, number];
  /** mm per voxel, in the same axis order as `dims`. */
  pixDims?: [number, number, number];
  description?: string;
  /** How many frames the stored third axis has — the number of slices in this series. */
  frames: number;
  /**
   * The acquired plane, from the axis the header's own affine sends the stored
   * third axis along. Absent when the file declares no spatial transform, since
   * there is then nothing in the file that says which plane it is.
   */
  orientation?: "Axial" | "Sagittal" | "Coronal";
}

/** Natural size of an ordinary raster, when the browser could decode it to find out. */
export interface UploadedRasterMeta {
  width?: number;
  height?: number;
}

export interface UploadedFileRecord {
  /** Stable within the study; used as the second path segment of a marker URL. */
  blobId: string;
  name: string;
  bytes: number;
  mimeType: string;
  kind: UploadFileKind;
  dicom?: UploadedDicomMeta;
  nifti?: UploadedNiftiMeta;
  raster?: UploadedRasterMeta;
}

export interface UploadedSeriesRecord {
  id: string;
  label: string;
  orientation: "Axial" | "Sagittal" | "Coronal" | "AP" | "PA" | "Lateral" | "Unknown";
  /**
   * One entry per slice, in display order: which stored file it lives in and
   * which frame of that file it is.
   */
  frames: { blobId: string; frame: number; width?: number; height?: number }[];
  /** Verbatim SeriesDescription / NIfTI description, when the files carried one. */
  description?: string;
  seriesInstanceUid?: string;
}

/** Where a displayed value came from, mirroring `FieldSource` in lib/patient-profile.ts. */
export type UploadValueSource = "file" | "entered";

export interface UploadedStudyRecord {
  version: number;
  /** `upl_<timestamp>_<random>` — unique per upload, never derived from a demo study. */
  id: string;
  /** Human-facing study code, e.g. `UPL-20260903-4F1C`. */
  studyCode: string;
  uploadedAt: string;
  storage: "persistent" | "session";

  /**
   * Resolved modality, and whether the files or the form supplied it.
   *
   * A `Modality` rather than a `string`: every writer sets it from the DICOM
   * modality map or from the form's own select, both of which are already one of
   * the app's modalities. A code the map has no equivalent for leaves the form's
   * choice standing and is kept verbatim in `unmappedModalityCode` — so this
   * field is never a raw tag value, and the viewer, the badges and the patient
   * profile can take it as given.
   */
  modality: Modality;
  modalitySource: UploadValueSource;
  /** Present when the DICOM modality code has no equivalent in the app's list. */
  unmappedModalityCode?: string;

  patientAlias?: string;
  patientAliasSource?: UploadValueSource;
  patientId?: string;
  age?: number;
  ageSource?: UploadValueSource;
  sex?: "M" | "F" | "Other";
  sexSource?: UploadValueSource;
  heightCm?: number;
  heightSource?: UploadValueSource;
  weightKg?: number;
  weightSource?: UploadValueSource;
  history?: string[];
  notes?: string;

  bodyRegion?: string;
  bodyRegionSource?: UploadValueSource;
  studyDate?: string;
  studyDescription?: string;
  accessionNumber?: string;
  studyInstanceUid?: string;
  priority: "routine" | "urgent" | "stat";

  files: UploadedFileRecord[];
  series: UploadedSeriesRecord[];
  /** Files that could not be read as any supported format, with the reason. */
  rejected: { name: string; reason: string }[];
}
