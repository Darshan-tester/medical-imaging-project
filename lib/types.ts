export type Modality = "CT" | "MRI" | "X-Ray" | "Ultrasound" | "PET" | "Mammography";

// `import type` rather than a plain import: this module is types only and must
// stay erasable. `lib/patient-profile.ts` imports `Modality` back from here, and
// a value import would make that cycle real at runtime.
import type { PatientProfile } from "./patient-profile";


export type StudyPriority = "routine" | "urgent" | "stat";

export type StudyStatus = "queued" | "processing" | "ai-complete" | "in-review" | "approved";

export type AIConfidenceBand = "high" | "moderate" | "low";

export interface Radiologist {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export type FindingReviewStatus = "unreviewed" | "pending" | "accepted" | "modified" | "rejected" | "confirmed";

export interface FindingMeasurement {
  lengthMm?: number;
  widthMm?: number;
  areaMm2?: number;
  volumeMm3?: number;
  meanHu?: number;
  maxSuv?: number;
}

export interface FindingEvidence {
  seriesId: string;
  sliceIndex: number;
  region: { x: number; y: number; w: number; h: number };
  centerCoords?: { x: number; y: number };
  thumbnailUrl?: string;
  keyObservation: string;
}

export interface Finding {
  id: string;
  label: string;
  confidence: number; // 0-100
  band: AIConfidenceBand;
  region: { x: number; y: number; w: number; h: number }; // normalized 0-1 bbox on the reference slice
  sliceIndex: number;
  /** Which series this finding lives on. Undefined = applies regardless of series (e.g. single-series studies). */
  seriesId?: string;
  description: string;
  status: "pending" | "accepted" | "modified" | "rejected" | FindingReviewStatus;
  radiologistNote?: string;
  location?: string;
  isCritical?: boolean;
  priority?: string;
  severity?: string;
  modelName?: string;
  modelVersion?: string;
  processingTimeMs?: number;
  measurements?: FindingMeasurement;
  evidence?: FindingEvidence;
}

export interface SeriesInfo {
  id: string;
  label: string;
  sliceCount: number;
  orientation: "Axial" | "Sagittal" | "Coronal" | "AP" | "PA" | "Lateral" | "Unknown";
  pixelSpacing?: [number, number]; // [rowSpacing, colSpacing] in mm
  /**
   * Optional per-series images, ready for a future PACS/DICOM integration
   * where each series carries its own instances instead of sharing the
   * study-level `imageUrls`. Populated by the committed demo studies and by
   * uploaded studies (one entry per instance/frame); the seeded mock studies
   * leave it unset and the viewer falls back to `Study.imageUrls`.
   */
  images?: ViewerImage[];
  /**
   * True when the server indexed this series as a reconstructed 3-D stack and
   * can therefore serve `/api/studies/<id>/volume/<seriesId>` for the 3-D view.
   *
   * Deliberately a boolean and nothing more: the volume itself is a list of
   * absolute file paths and must never reach the browser.
   */
  volumeAvailable?: boolean;
}

/**
 * A single displayable image/instance within a series. Deliberately close to
 * a DICOM instance shape so a future PACS integration can populate `dicom`
 * without changing the viewer. Nothing in this project fabricates DICOM
 * values today — `dicom` stays undefined for all mock/demo/uploaded data.
 */
export interface ViewerImage {
  index: number;
  imageUrl?: string;
  width?: number;
  height?: number;
  dicom?: DicomInstanceMetadata;
}

/** Future PACS/DICOM readiness — intentionally unused by mock data. */
export interface DicomInstanceMetadata {
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number]; // mm per pixel [row, col] — enables px→mm measurement conversion
  windowCenter?: number;
  windowWidth?: number;
  orientation?: string;
  modality?: Modality;
}

/**
 * A user-placed location marker on a specific image. Coordinates are
 * normalized (0-1) against the image's natural bounds, so a marker stays
 * correctly positioned across zoom/pan/resize. Always scoped to the exact
 * series + slice it was placed on — never shown on other slices.
 */
export interface Marker {
  id: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  seriesId: string;
  sliceIndex: number;
  label?: string;
  note?: string;
  createdAt: string;
}

/** A two-point distance measurement, scoped to the exact series + slice it was drawn on. */
export interface ViewerMeasurement {
  id: string;
  a: { x: number; y: number }; // normalized 0-1
  b: { x: number; y: number }; // normalized 0-1
  seriesId: string;
  sliceIndex: number;
  distancePx: number;
  /** Populated only once real DICOM pixel spacing is available — never fabricated. */
  distanceMm?: number;
}

export type FindingType =
  | "Lesion"
  | "Nodule"
  | "Mass"
  | "Fracture"
  | "Hemorrhage"
  | "Calcification"
  | "Fluid"
  | "Abnormality"
  | "Other";

export type AnnotationShape =
  | "freehand"
  | "arrow"
  | "circle"
  | "rectangle"
  | "line"
  | "angle"
  | "text"
  | "marker"
  | "point"
  | "polygon"
  | "measurement";

/**
 * A radiologist-drawn pen/pencil stroke or geometric annotation. Coordinates are normalized (0-1)
 * against the image's natural bounds — same convention as `Marker` and
 * `ViewerMeasurement` — so a stroke stays correctly attached to the same
 * image region across zoom/pan/resize. Always scoped to the exact
 * study → series → slice it was drawn on; the viewer must never render an
 * annotation on any slice other than the one it belongs to.
 */
export interface ViewerAnnotation {
  id: string;
  studyId: string;
  seriesId: string;
  sliceIndex: number;
  type: AnnotationShape;
  /** Points in drawing order, normalized 0-1. */
  points: { x: number; y: number }[];
  color: string; // hex
  strokeWidth: number; // rendered as a constant on-screen px width regardless of zoom
  opacity: number; // 0-1
  createdAt: string;
  updatedAt: string;
  visible?: boolean;

  /** Clinical finding category / classification */
  findingType?: FindingType | string;
  /** Primary label/finding name */
  finding?: string;
  /** Optional custom text label */
  label?: string;
  /** A short free-text note directly on the stroke — distinct from a full `RadiologistFinding`. */
  radiologistNote?: string;
  /** Set once the radiologist writes a full finding for this stroke via "Add Finding". */
  findingId?: string;

  /** Primary image coordinates (normalized 0-1) */
  imageCoordinates?: {
    x: number;
    y: number;
  };

  /** Real 3D patient coordinates (mm or normalized volume space) */
  worldCoordinates?: {
    x: number;
    y: number;
    z: number;
  };

  /** Detailed clinical measurement */
  measurement?: {
    distance?: number;
    area?: number;
    volume?: number;
    unit?: string;
  };

  /** Formatted measurement string (e.g. "12.4 mm", "45.0°", "180.5 mm²") */
  measureValue?: string;

  /** Text label content if type === "text" */
  text?: string;
}

/** 3D spatial annotation attached to anatomical volume coordinates. */
export interface Annotation3D {
  id: string;
  studyId: string;
  seriesId: string;
  sliceIndex?: number;
  annotation2DId?: string;
  type: "marker" | "label" | "arrow" | "distance" | "roi" | "contour";
  position: [number, number, number]; // normalized -0.5..0.5 in volume object space
  endPosition?: [number, number, number];
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    normZ: number;
    depth?: number;
  };
  contourPoints?: Array<{ x: number; y: number }>;
  label?: string;
  findingType?: FindingType | string;
  note?: string;
  color: string;
  createdAt: string;
  visible?: boolean;
  measureValue?: string;
}

export type ViewportLayout = "1x1" | "1x2" | "2x1" | "1+2" | "2x2" | "mpr-3d";
export type ColorMap3D =
  | "mri-tissue"
  | "mri-t1"
  | "mri-flair"
  | "mri-perfusion"
  | "bone"
  | "grayscale"
  | "rainbow"
  | "hotiron"
  | "pet"
  | "viridis"
  | "coolwarm";
export type Quality3D = "performance" | "balanced" | "high" | "ultra";

export interface AnnotationVisibilityState {
  showAiFindings: boolean;
  showBoundingBoxes: boolean;
  showSegmentation: boolean;
  showMeasurements: boolean;
  showHeatmap: boolean;
  showMarkers: boolean;
  showTextLabels: boolean;
}

export const DEFAULT_ANNOTATION_VISIBILITY: AnnotationVisibilityState = {
  showAiFindings: true,
  showBoundingBoxes: true,
  showSegmentation: true,
  showMeasurements: true,
  showHeatmap: false,
  showMarkers: true,
  showTextLabels: true,
};


export interface WindowLevelPreset {
  id: string;
  name: string;
  description: string;
  windowWidth: number;
  windowCenter: number;
  brightness: number;
  contrast: number;
}

/**
 * A radiologist's free-text observation, optionally tied to a specific
 * `ViewerAnnotation`. `text` is authoritative, radiologist-authored content:
 * the application stores and displays it exactly as written. Nothing in
 * this app rewrites, paraphrases, "improves", or otherwise alters it —
 * AI-assisted content is always represented separately via `Finding`.
 */
export interface RadiologistFinding {
  id: string;
  studyId: string;
  seriesId: string;
  sliceIndex: number;
  /** Undefined once the source annotation has been deleted but the finding was preserved. */
  annotationId?: string;
  /** Exact, unmodified radiologist-authored text. Never AI-generated or AI-edited. */
  text: string;
  findingType?: string;
  location?: string;
  severity?: string;
  confidence?: string;
  radiologistNote?: string;
  author: Radiologist;
  createdAt: string;
  updatedAt: string;
  addedToReport: boolean;
}

/**
 * The immutable, original report exactly as it exists in the source
 * dataset (or, for a future PACS, in the RIS). Never edited in place —
 * `Report` (the "working report") is what the radiologist actually edits
 * and approves. See `lib/dataset/to-app-study.ts` for how a real dataset's
 * report gets mapped into this shape.
 */
export interface SourceReport {
  source: string; // dataset badge, e.g. "MR-RATE" — never a filesystem path
  text: string; // full original report, verbatim
  clinicalInformation?: string;
  indication?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  comparison?: string;
}

export interface Study {
  id: string;
  studyId: string;
  patientAlias: string;
  /** Undefined when the source dataset doesn't provide it — never fabricated. Render as "Not available" rather than guessing. */
  age?: number;
  sex?: "M" | "F" | "Other";
  modality: Modality;
  /** Undefined when the source dataset doesn't provide it. */
  bodyRegion?: string;
  /** ISO date, undefined when the source dataset doesn't provide one. */
  date?: string;
  priority: StudyPriority;
  status: StudyStatus;
  aiConfidence: number | null; // overall
  assignedRadiologist: Radiologist | null;
  series: SeriesInfo[];
  findings: Finding[];
  thumbnailSeed: number;
  /**
   * Object URLs for real files the user dropped in on the Upload Scan page
   * (one per slice/image). Undefined for the seeded demo studies, which have
   * no underlying file and fall back to the synthetic placeholder texture.
   */
  imageUrls?: string[];
  report: Report;
  /**
   * Only set for studies that came from a real indexed local dataset
   * (NEXT_PUBLIC_DATA_MODE=dataset). A short badge label like "MR-RATE" or
   * "ROCOv2" — never a filesystem path. Undefined for mock/uploaded studies.
   */
  datasetSource?: string;
  /**
   * The immutable original report from the dataset, kept separate from the
   * editable `report` (working report). Undefined when no real source
   * report was matched — the Radiology Report panel must show "not
   * available" rather than inventing one.
   */
  sourceReport?: SourceReport;
  /**
   * Explicit AI-availability signal. "complete" (default, via `?? "complete"`
   * at every read site) preserves today's behavior for mock/uploaded
   * studies. Real dataset studies are indexed with "not-run" since no AI
   * model produced `findings` for them — the AI Findings panel must show
   * "AI analysis not available for this study." instead of an empty list
   * that could be mistaken for a normal/clear result.
   *
   * "simulated" means `findings` exist but were placed by
   * `lib/simulated-findings.ts`: the text is quoted from the study's own
   * report, the box and the confidence are inferred from that text rather
   * than measured from the pixels. Anything rendering findings must badge
   * this state — it is not a detection.
   */
  aiStatus?: "not-run" | "complete" | "simulated";
  /**
   * Demographics and anthropometrics for the report's patient column, each
   * field carrying where it came from. Values the source or the upload form
   * supplied are badged as such; the rest are deterministic demo values. See
   * `lib/patient-profile.ts` — and note that `age`/`sex` above stay undefined
   * for real dataset studies regardless, so nothing reading them sees a
   * generated number.
   */
  patientProfile?: PatientProfile;
  /**
   * Set only on a study created by the Upload Scan page from files the person
   * supplied, and never on a demo, dataset or mock study. This is what keeps
   * the two sources of truth apart: demo studies come from
   * `public/demo-data/index.json`, uploaded studies come from the browser's own
   * upload store (`lib/uploads/db.ts`), and nothing merges them.
   */
  uploaded?: UploadOrigin;
}

/**
 * Provenance for a study that came from an upload rather than from a dataset.
 *
 * Deliberately records only what is true of the transfer itself — when it
 * happened, which files arrived, whether they survived a reload. Nothing here
 * describes the images; that comes from the files' own metadata.
 */
export interface UploadOrigin {
  /** ISO timestamp of when the files were accepted. */
  uploadedAt: string;
  fileCount: number;
  /** Original file names, in the order they were read. */
  fileNames: string[];
  /**
   * `"persistent"` — the bytes are in IndexedDB, so reloading the study URL
   * re-renders the same pixels. `"session"` — IndexedDB was unavailable and the
   * bytes are only in memory for this page session, which the UI says plainly
   * rather than letting a reload look like data loss.
   */
  storage: "persistent" | "session";
}


export interface ReportSection {
  clinicalInformation: string;
  technique: string;
  comparison?: string;
  findings: string;
  impression: string;
}

export type ReportStatus = "ai-draft" | "in-review" | "approved";

export interface Report {
  status: ReportStatus;
  sections: ReportSection;
  aiAssisted: boolean;
  version: number;
  reviewer: Radiologist | null;
  approvedAt: string | null;
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "under-review" | "resolved";

export interface IncidentReport {
  id: string;
  incidentType: string;
  severity: IncidentSeverity;
  studyId: string | null;
  description: string;
  findings: string;
  actionTaken: string;
  reviewer: Radiologist | null;
  createdAt: string;
  status: IncidentStatus;
}

export interface KPI {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down" | "flat";
  positiveIsGood: boolean;
}

export interface SystemStatus {
  name: string;
  state: "operational" | "degraded" | "offline";
  detail: string;
}

export type VitalsStatus = "normal" | "elevated" | "critical";

export interface VitalStat {
  label: string;
  value: string;
  unit: string;
}

export interface VitalsReading {
  /** Study.id — used to link back to the study detail route. */
  studyRouteId: string;
  /** Study.studyId — the human-readable MRD code. */
  studyCode: string;
  patientAlias: string;
  modality: Modality;
  bodyRegion: string;
  bpm: number;
  restingBpm: number;
  status: VitalsStatus;
  updatedSecondsAgo: number;
  stats: VitalStat[];
}

export interface ReportQCWarning {
  id: string;
  category: "laterality" | "measurement" | "contradiction" | "missing_critical" | "unsupported_claim";
  severity: "critical" | "warning" | "advisory";
  title: string;
  description: string;
  suggestedAction?: string;
  findingId?: string;
  resolved: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  action:
    | "STUDY_OPENED"
    | "IMAGE_VIEWED"
    | "FINDING_ACCEPTED"
    | "FINDING_REJECTED"
    | "FINDING_EDITED"
    | "REPORT_EDITED"
    | "REPORT_QC_CHECKED"
    | "REPORT_APPROVED"
    | "REPORT_EXPORTED";
  studyId: string;
  details: string;
}

export interface PriorStudyComparison {
  priorStudyId: string;
  priorDate: string;
  modality: Modality;
  findingDeltas: {
    findingName: string;
    status: "new" | "stable" | "increased" | "decreased" | "resolved";
    currentMeasurementMm?: number;
    priorMeasurementMm?: number;
    percentChange?: number;
  }[];
}
