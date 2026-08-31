/**
 * ---------------------------------------------------------------------------
 * NORMALIZED DATASET MODEL
 * ---------------------------------------------------------------------------
 * Every dataset adapter (MRI, CT, Chest X-Ray, PET, Ultrasound, ROCOv2)
 * outputs values shaped like this, regardless of how the underlying files on
 * disk are organized. Nothing downstream (the manifest, the API routes, the
 * Meridian UI) ever needs to know the difference between a DICOM series on
 * disk and a ROCOv2 image/caption pair — it only ever sees a DatasetStudy.
 *
 * This file has NO Node.js imports (no `fs`, no `path`) so it is safe to
 * import from both server-only code (scanner, API routes) and, if ever
 * needed, client code — it is pure type/shape definitions.
 * ---------------------------------------------------------------------------
 */

export type DatasetSourceId = "MRI" | "CT" | "CHEST_XRAY" | "PET" | "ULTRASOUND" | "ROCOV2";

/** Short, human-facing badge label. Never a filesystem path. */
export const DATASET_SOURCE_LABEL: Record<DatasetSourceId, string> = {
  MRI: "MR-RATE",
  CT: "Perle CT",
  CHEST_XRAY: "Chest X-Ray",
  PET: "PET",
  ULTRASOUND: "Ultrasound",
  ROCOV2: "ROCOv2",
};

export type NormalizedModality = "CT" | "MRI" | "X-Ray" | "Ultrasound" | "PET";

export type SliceOrientation = "Axial" | "Sagittal" | "Coronal" | "AP" | "PA" | "Lateral" | "Unknown";

/** How to read the underlying bytes for a single image/slice. Only ever resolved server-side. */
export type ImageSourceKind = "raster" | "dicom" | "nifti";

/**
 * A reference to one real, on-disk file that backs one displayable image.
 * `absPath` is never sent to the browser — API routes resolve it server-side
 * only, and only for paths that were produced by a scan (see fs-utils
 * `assertWithinRoot`), never from user-supplied input.
 */
export interface DatasetImageRef {
  id: string; // stable id, unique within the series
  index: number; // 0-based position within the series
  kind: ImageSourceKind;
  absPath: string; // absolute path on the local filesystem (server-only)
  /** For multi-frame containers (NIfTI volumes, multi-frame DICOM): which frame/slice within the file. */
  frameIndex?: number;
  width?: number;
  height?: number;
}

export interface DatasetSeries {
  id: string;
  label: string;
  modality: NormalizedModality;
  orientation: SliceOrientation;
  sliceCount: number;
  images: DatasetImageRef[];
}

/**
 * Only sections that were actually present in the source report are ever
 * populated. `text` always holds the full original report content
 * (verbatim) as a fallback for datasets whose reports aren't sectioned.
 */
export interface StudyReport {
  source: string; // dataset badge this report came from, e.g. "MR-RATE"
  text: string; // full original report, verbatim, never rewritten
  clinicalInformation?: string;
  indication?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  comparison?: string;
  metadata?: Record<string, string>;
}

export interface DatasetAIFinding {
  label: string;
  confidence: number;
  band: "high" | "moderate" | "low";
  region: { x: number; y: number; w: number; h: number };
  sliceIndex: number;
  seriesId?: string;
  description: string;
}

export interface DatasetStudy {
  /** Stable across re-indexing runs — derived from a hash of the study's identifying path/ID, never random. */
  id: string;
  dataset: DatasetSourceId;
  /** Human-readable accession-style code shown in the UI, e.g. "MRI-A1B2C3". Never a filesystem path. */
  studyCode: string;
  /** Best available original identifier (StudyInstanceUID, accession number, dataset row ID, filename stem...). Used for report matching and de-dup, not necessarily shown in the UI. */
  sourceStudyId: string;
  patientAlias: string;
  /** Only set when the source data actually provides it. Never invented. */
  age?: number;
  sex?: "M" | "F" | "Other";
  modality: NormalizedModality;
  bodyRegion?: string;
  date?: string; // ISO date, only if the source provides one
  series: DatasetSeries[];
  report?: StudyReport;
  /** Only set once a real AI model has actually produced results for this study. Absent = "AI analysis not available". */
  aiFindings?: DatasetAIFinding[];
  /** Free-form provenance for the verify report / debugging — never shown verbatim as a filesystem path in the UI. */
  sourceDir: string;
}

export interface AdapterIssue {
  dataset: DatasetSourceId;
  path: string;
  reason: string;
}

export interface AdapterResult {
  studies: DatasetStudy[];
  issues: AdapterIssue[];
}

export interface DatasetAdapter {
  id: DatasetSourceId;
  /** Folder name(s), relative to SCANLAB_DATA_ROOT, this adapter scans. */
  matchesDir: string[];
  scan(rootDir: string): Promise<AdapterResult>;
}

/** What gets persisted to `.scanlab/manifest.json`. */
export interface DatasetManifest {
  generatedAt: string;
  scanRoot: string;
  studies: DatasetStudy[];
  issues: AdapterIssue[];
}

export interface DatasetCounts {
  studies: number;
  images: number;
  reports: number;
  completePairs: number; // studies with >=1 image AND a report
}

export interface VerifyReport {
  generatedAt: string;
  perDataset: Record<DatasetSourceId, DatasetCounts>;
  totals: DatasetCounts;
  problems: {
    missingImages: string[];
    missingReports: string[];
    brokenRelationships: string[];
    invalidFiles: string[];
    duplicateStudyIds: string[];
    unsupportedFormats: string[];
    missingSeries: string[];
    unreadableFiles: string[];
  };
}
