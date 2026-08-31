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

/**
 * How to read the underlying bytes for a single image/slice. Only ever resolved server-side.
 *
 * - `raster`  — an ordinary JPEG/PNG file; one file = one image.
 * - `dicom`   — a single DICOM instance; one file = one image. This is the
 *               original CT path and is deliberately left untouched.
 * - `nifti`   — one frame inside a NIfTI volume, selected by `frameIndex`
 *               along the axis named by `orientation`.
 * - `dicom-volume` — one reconstructed slice of a *stack* of DICOM instances.
 *               The stack itself lives on the study as `volumes[series.volumeId]`
 *               because a single ordered file list is shared by all three planes.
 */
export type ImageSourceKind = "raster" | "dicom" | "nifti" | "dicom-volume";

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
  /**
   * Which anatomical plane `frameIndex` counts along. Only meaningful for
   * volumetric sources (a NIfTI file, or a reconstructed DICOM stack): a volume
   * is indexed three times over, once per plane, and the renderer walks the
   * voxel axis that the volume's own affine says corresponds to this plane.
   * Absent = render the container's natural/first plane (the pre-MPR behaviour,
   * still correct for 2D files).
   */
  orientation?: SliceOrientation;
  width?: number;
  height?: number;
}

/**
 * Everything needed to reconstruct one stack of single-slice DICOM instances
 * into a 3-D volume, measured once at index time.
 *
 * Persisted on the study rather than on each image ref because all three MPR
 * planes of a 500-instance CT series share exactly one stack — writing the
 * paths per plane would triple the manifest for no information gain.
 *
 * `files` holds absolute paths, so like `DatasetImageRef.absPath` this whole
 * structure is server-only and must never be forwarded to the browser.
 */
export interface DicomVolumeRef {
  /** Ordered by true spatial position along the slice normal, not by InstanceNumber. */
  files: string[];
  /** Per-instance pixel matrix; every instance in the stack shares these. */
  rows: number;
  columns: number;
  /** DICOM PixelSpacing (0028,0030) — [between rows, between columns] in mm. */
  pixelSpacing: [number, number];
  /** ImageOrientationPatient (0020,0037) — six LPS direction cosines. */
  iop: [number, number, number, number, number, number];
  /** Signed centre-to-centre mm step along the slice normal, in `files` order. */
  sliceDelta: number;
  /** False when `sliceDelta` fell back to SliceThickness because positions were missing. */
  spacingFromPositions: boolean;
}

/**
 * A whole series' worth of image refs described in one object, for the case
 * where every slice resolves to the same container and differs only by index.
 *
 * That is exactly what a reslice plane is: a 512×512×420 NIfTI walked coronally
 * is 512 refs that share one `absPath`, one `kind`, one `orientation` and one
 * pixel size, with `frameIndex` counting 0…511. Writing all of them out cost
 * ~190 bytes each, and a study has three planes per volume, which is what took
 * `.scanlab/manifest.json` past V8's maximum string length (~512 MB) and made
 * `JSON.stringify` throw `RangeError: Invalid string length` mid-index.
 *
 * Only ever used where the run really is uniform; a series backed by one file
 * per slice (raster, single-instance DICOM) keeps its explicit `images`,
 * because those refs each carry a different path and cannot be derived.
 *
 * Read this through `seriesImageAt` / `seriesImageRefs` in `series-frames.ts`
 * rather than by hand, so the two representations stay interchangeable.
 */
export interface SeriesFrameRun {
  kind: ImageSourceKind;
  /** The single container every frame in the run comes from. Server-only, like `DatasetImageRef.absPath`. */
  absPath: string;
  /** Number of frames, i.e. `frameIndex` runs 0…count-1. */
  count: number;
  /** Which anatomical plane `frameIndex` counts along — see `DatasetImageRef.orientation`. */
  orientation?: SliceOrientation;
  width?: number;
  height?: number;
}

export interface DatasetSeries {
  id: string;
  label: string;
  modality: NormalizedModality;
  orientation: SliceOrientation;
  sliceCount: number;
  /**
   * Explicit per-slice refs, one entry per distinct file. Empty when `frames`
   * describes the series instead — always read through `series-frames.ts`.
   */
  images: DatasetImageRef[];
  /** Compact form of `images` for a uniform run of frames out of one container. */
  frames?: SeriesFrameRun;
  /**
   * Set only for `dicom-volume` series: which entry of the parent study's
   * `volumes` map holds the ordered instance list this series reslices.
   * Server-only — `toAppStudy` never forwards it to the browser.
   */
  volumeId?: string;
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
  /**
   * Reconstructed DICOM stacks used by this study's `dicom-volume` series,
   * keyed by the `volumeId` those series reference. Stored once per stack rather
   * than once per plane so the MPR series of a 500-instance CT don't write the
   * same 500 paths into the manifest three times.
   *
   * Server-only — see `DicomVolumeRef`.
   */
  volumes?: Record<string, DicomVolumeRef>;
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
  /**
   * Which build of the adapters produced this file (see
   * `MANIFEST_BUILDER_VERSION` in manifest-store.ts). Optional because
   * manifests written before this field existed simply don't have it — those
   * are treated as version 0, i.e. stale.
   *
   * The whole point: the app serves the manifest, NOT the adapters. Improving
   * an adapter changes nothing a user can see until `dataset:index` is re-run,
   * and without this stamp that failure mode is completely silent — the UI
   * happily shows pre-fix data (no reports, single-plane series) with no hint
   * that the index is out of date.
   */
  builderVersion?: number;
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
