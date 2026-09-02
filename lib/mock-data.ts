import {
  AIConfidenceBand,
  Finding,
  IncidentReport,
  KPI,
  Modality,
  Radiologist,
  Report,
  SeriesInfo,
  Study,
  StudyPriority,
  StudyStatus,
  SystemStatus,
  VitalsReading,
} from "./types";
import { buildPatientProfile } from "./patient-profile";

/**
 * ---------------------------------------------------------------------------
 * DEMO DATA BOUNDARY
 * ---------------------------------------------------------------------------
 * Everything in this file is deterministic, seeded, synthetic demo data.
 * There is no PACS/DICOM backend, no real AI inference engine, and no real
 * patient information anywhere in this project. Patient identifiers below
 * are aliases, not real records.
 *
 * This file is the single integration boundary for study/report data. When a
 * real backend exists, replace `listStudies()` / `getStudy()` / mutation
 * helpers below with real fetch calls — nothing outside this file should
 * need to change, since components only ever consume the exported functions
 * and types, never `Math.random()` or literals directly.
 * ---------------------------------------------------------------------------
 */

// Deterministic PRNG (mulberry32) — same output on server and client, every time.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(88771);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

export const RADIOLOGISTS: Radiologist[] = [
  { id: "rad-1", name: "Dr. Elena Marsh", initials: "EM", role: "Attending Radiologist" },
  { id: "rad-2", name: "Dr. Kavi Raman", initials: "KR", role: "Attending Radiologist" },
  { id: "rad-3", name: "Dr. Sofia Bianchi", initials: "SB", role: "Senior Radiologist" },
  { id: "rad-4", name: "Dr. James Okafor", initials: "JO", role: "Attending Radiologist" },
];

export const CURRENT_USER: Radiologist = {
  id: "rad-0",
  name: "Dr. Amara Chen",
  initials: "AC",
  role: "Attending Radiologist · Thoracic & Neuro",
};

const MODALITIES: Modality[] = ["CT", "MRI", "X-Ray", "Ultrasound", "PET", "Mammography"];

const BODY_REGIONS: Record<Modality, string[]> = {
  CT: ["Chest", "Abdomen/Pelvis", "Head", "C-Spine"],
  MRI: ["Brain", "Lumbar Spine", "Knee (R)", "Shoulder (L)"],
  "X-Ray": ["Chest PA/Lat", "Wrist (L)", "Pelvis", "Ankle (R)"],
  Ultrasound: ["Abdomen", "Thyroid", "Carotid", "Renal"],
  PET: ["Whole Body", "Brain"],
  Mammography: ["Bilateral Screening", "Left Diagnostic"],
};

const ORIENTATIONS: SeriesInfo["orientation"][] = ["Axial", "Sagittal", "Coronal"];

const FINDING_LIBRARY: Record<Modality, { label: string; description: string }[]> = {
  CT: [
    { label: "Pulmonary opacity", description: "Focal ground-glass opacity in the right lower lobe, non-specific for infectious vs. inflammatory etiology." },
    { label: "Pleural effusion", description: "Small layering pleural effusion, likely simple in composition." },
    { label: "Hepatic hypodensity", description: "Sub-centimeter hypodense lesion, too small to characterize — recommend follow-up." },
    { label: "No acute osseous abnormality", description: "Visualized osseous structures are intact without acute fracture." },
  ],
  MRI: [
    { label: "Disc protrusion", description: "Mild posterior disc protrusion at L4-L5 with mild canal narrowing." },
    { label: "White matter hyperintensity", description: "Scattered nonspecific T2/FLAIR hyperintensities, most consistent with chronic microvascular change." },
    { label: "Meniscal tear", description: "Horizontal tear of the posterior horn of the medial meniscus." },
    { label: "No acute intracranial abnormality", description: "No acute infarct, hemorrhage, or mass effect identified." },
  ],
  "X-Ray": [
    { label: "Suspected fracture", description: "Subtle lucency at the distal radius concerning for non-displaced fracture — correlate clinically." },
    { label: "Cardiomegaly", description: "Mild cardiac silhouette enlargement, cardiothoracic ratio approximately 0.55." },
    { label: "No acute cardiopulmonary process", description: "Lungs clear, no focal consolidation, effusion, or pneumothorax." },
  ],
  Ultrasound: [
    { label: "Gallbladder wall thickening", description: "Mild gallbladder wall thickening without pericholecystic fluid or sonographic Murphy sign." },
    { label: "Thyroid nodule", description: "Well-circumscribed hypoechoic nodule, TI-RADS 3 — routine follow-up suggested." },
    { label: "Normal renal echotexture", description: "Kidneys are normal in size and echotexture bilaterally." },
  ],
  PET: [
    { label: "Hypermetabolic focus", description: "Focal FDG-avid uptake, SUVmax elevated relative to background — correlate with prior imaging." },
    { label: "No hypermetabolic disease", description: "No abnormal FDG-avid lesion identified within the field of view." },
  ],
  Mammography: [
    { label: "Cluster microcalcifications", description: "Grouped amorphous microcalcifications in the upper outer quadrant — recommend diagnostic follow-up." },
    { label: "BI-RADS 2 — Benign", description: "No suspicious mass, architectural distortion, or malignant-type calcification." },
  ],
};

function bandFor(confidence: number): AIConfidenceBand {
  if (confidence >= 88) return "high";
  if (confidence >= 70) return "moderate";
  return "low";
}

/**
 * `series` lets each generated finding land on a real series + a real slice
 * within that series' range, so the viewer's series/slice navigation has
 * something genuine to demonstrate instead of every finding sitting on
 * slice 0. Single-slice series (X-Ray, Mammography) always resolve to 0.
 */
function makeFindings(modality: Modality, count: number, series: SeriesInfo[]): Finding[] {
  const pool = [...FINDING_LIBRARY[modality]];
  const findings: Finding[] = [];
  for (let i = 0; i < count; i++) {
    const idx = int(0, pool.length - 1);
    const f = pool.splice(idx, 1)[0] ?? FINDING_LIBRARY[modality][0];
    const isNegative = f.label.toLowerCase().startsWith("no ");
    const confidence = isNegative ? int(85, 99) : int(58, 97);
    const targetSeries = pick(series);
    findings.push({
      id: `fnd-${modality}-${i}-${int(1000, 9999)}`,
      label: f.label,
      description: f.description,
      confidence,
      band: bandFor(confidence),
      region: {
        x: 0.2 + rand() * 0.45,
        y: 0.18 + rand() * 0.45,
        w: 0.12 + rand() * 0.16,
        h: 0.1 + rand() * 0.14,
      },
      sliceIndex: int(0, Math.max(0, targetSeries.sliceCount - 1)),
      seriesId: targetSeries.id,
      status: "pending",
    });
  }
  return findings;
}

function makeSeries(modality: Modality): SeriesInfo[] {
  if (modality === "CT" || modality === "MRI") {
    const count = int(2, 3);
    return Array.from({ length: count }).map((_, i) => ({
      id: `series-${i}`,
      label: `${modality === "CT" ? "CT" : "MR"} ${ORIENTATIONS[i % ORIENTATIONS.length]}`,
      sliceCount: int(24, 220),
      orientation: ORIENTATIONS[i % ORIENTATIONS.length],
    }));
  }
  return [{ id: "series-0", label: `${modality} Series 1`, sliceCount: modality === "PET" ? int(80, 160) : 1, orientation: "Axial" }];
}

function emptyReport(status: Report["status"], findings: Finding[], modality: Modality, region: string): Report {
  const findingLines = findings
    .map((f) => `${f.label}${f.confidence ? ` (AI confidence ${f.confidence}%)` : ""}. ${f.description}`)
    .join("\n\n");
  const impression = findings.length
    ? findings
        .filter((f) => !f.label.toLowerCase().startsWith("no "))
        .map((f, i) => `${i + 1}. ${f.label}.`)
        .join(" ") || "1. No acute findings."
    : "1. No acute findings.";
  return {
    status,
    aiAssisted: true,
    version: status === "approved" ? int(2, 4) : 1,
    reviewer: status === "approved" ? pick(RADIOLOGISTS) : null,
    approvedAt: status === "approved" ? new Date(Date.now() - int(1, 20) * 86400000).toISOString() : null,
    sections: {
      clinicalInformation: `${int(18, 84)}-year-old patient referred for ${modality} ${region.toLowerCase()} evaluation.`,
      technique: `${modality} of the ${region} performed per standard clinical protocol.`,
      findings: findingLines || "No significant findings on this examination.",
      impression,
    },
  };
}

const STATUS_POOL: StudyStatus[] = ["queued", "processing", "ai-complete", "ai-complete", "in-review", "in-review", "approved", "approved", "approved"];
const PRIORITY_POOL: StudyPriority[] = ["routine", "routine", "routine", "urgent", "urgent", "stat"];

function buildStudies(n: number): Study[] {
  const studies: Study[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const modality = pick(MODALITIES);
    const region = pick(BODY_REGIONS[modality]);
    const status = STATUS_POOL[int(0, STATUS_POOL.length - 1)];
    const priority = PRIORITY_POOL[int(0, PRIORITY_POOL.length - 1)];
    const hasFindings = status !== "queued" && status !== "processing";
    const findingCount = hasFindings ? int(1, 3) : 0;
    const series = makeSeries(modality);
    const findings = hasFindings ? makeFindings(modality, findingCount, series) : [];
    const aiConfidence = hasFindings ? Math.round(findings.reduce((a, f) => a + f.confidence, 0) / findings.length) : null;
    const daysAgo = int(0, 21);
    const date = new Date(now - daysAgo * 86400000 - int(0, 82800000)).toISOString();

    const reportStatus: Report["status"] = status === "approved" ? "approved" : status === "in-review" ? "in-review" : "ai-draft";

    const id = `study-${i + 1}`;
    const patientAlias = `Patient ${String.fromCharCode(65 + (i % 26))}-${1000 + int(0, 8999)}`;
    const age = int(6, 91);
    const sex = pick<"M" | "F" | "Other">(["M", "F", "Other"]);

    studies.push({
      id,
      studyId: `MRD-${2000 + int(0, 7999)}`,
      patientAlias,
      age,
      sex,
      modality,
      bodyRegion: region,
      date,
      priority,
      status,
      aiConfidence,
      assignedRadiologist: status === "queued" ? null : pick(RADIOLOGISTS),
      series,
      findings,
      thumbnailSeed: int(1, 999999),
      report: emptyReport(reportStatus, findings, modality, region),
      /*
       * The age and sex above are handed straight back in, badged "simulated".
       * These are seeded demo studies, so they are demo values — but the studies
       * table reads `study.age` while the report column reads the profile, and
       * generating a second independent age here would show two different ages
       * for one patient.
       */
      patientProfile: buildPatientProfile({
        studyId: id,
        displayName: patientAlias,
        modality,
        bodyRegion: region,
        age,
        sex,
        supplied: "simulated",
      }),
    });
  }
  return studies.sort((a, b) => +new Date(b.date!) - +new Date(a.date!));
}

export const STUDIES: Study[] = buildStudies(34);

export function createDemoStudy(input: {
  patientAlias: string;
  modality: Modality;
  bodyRegion: string;
  priority: Study["priority"];
  fileCount: number;
  /** Object URLs created from the real files the user uploaded (image/* only). */
  imageUrls?: string[];
  /*
   * Whatever the person actually typed into Study Details. Anything omitted is
   * generated by `buildPatientProfile` and badged as a demo value — this
   * function never fills a blank field with a number that then reads as entered.
   */
  age?: number;
  sex?: "M" | "F" | "Other";
  heightCm?: number;
  weightKg?: number;
  history?: string[];
  notes?: string;
}): Study {
  const isMultiSlice = input.modality === "CT" || input.modality === "MRI" || input.modality === "PET";
  // If the user actually dropped in real image files, the slice count should
  // reflect exactly how many real images we have to page through — otherwise
  // the slice navigator would let you scrub past the last real upload into
  // nothing. Falls back to fileCount for non-image uploads (e.g. raw DICOM).
  const realSliceCount = input.imageUrls?.length ?? input.fileCount;
  const series: SeriesInfo[] = isMultiSlice
    ? [{ id: "series-0", label: `${input.modality} ${ORIENTATIONS[0]}`, sliceCount: Math.max(realSliceCount, 1), orientation: ORIENTATIONS[0] }]
    : [{ id: "series-0", label: `${input.modality} Series 1`, sliceCount: Math.max(realSliceCount, 1), orientation: "Axial" }];

  const findingCount = int(1, 3);
  const findings = makeFindings(input.modality, findingCount, series);
  const aiConfidence = Math.round(findings.reduce((a, f) => a + f.confidence, 0) / findings.length);

  const study: Study = {
    id: `study-upload-${Date.now()}`,
    studyId: `MRD-${2000 + int(0, 7999)}`,
    patientAlias: input.patientAlias || `Patient ${String.fromCharCode(65 + int(0, 25))}-${1000 + int(0, 8999)}`,
    age: input.age,
    sex: input.sex,
    modality: input.modality,
    bodyRegion: input.bodyRegion,
    date: new Date().toISOString(),
    priority: input.priority,
    status: "ai-complete",
    aiConfidence,
    assignedRadiologist: CURRENT_USER,
    series,
    findings,
    thumbnailSeed: int(1, 999999),
    imageUrls: input.imageUrls && input.imageUrls.length > 0 ? input.imageUrls : undefined,
    report: emptyReport("ai-draft", findings, input.modality, input.bodyRegion),
  };

  /*
   * Built after the study so the profile can be keyed to its id, and so the
   * entered values keep the "entered" badge while the gaps are filled and
   * marked as demo. Note `age`/`sex` above are exactly what was typed and
   * nothing more — an upload with the age box left empty has no age, and the
   * profile is the only thing that shows one.
   */
  study.patientProfile = buildPatientProfile({
    studyId: study.id,
    displayName: study.patientAlias,
    modality: input.modality,
    bodyRegion: input.bodyRegion,
    age: input.age,
    sex: input.sex,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    history: input.history,
    notes: input.notes,
    supplied: "entered",
  });

  STUDIES.unshift(study);
  return study;
}

export function listStudies(): Study[] {
  return STUDIES;
}

export function getStudy(id: string): Study | undefined {
  return STUDIES.find((s) => s.id === id || s.studyId === id);
}

export function getKPIs(): KPI[] {
  const today = STUDIES.filter((s) => new Date(s.date!).toDateString() === new Date().toDateString()).length || 128;
  const aiAnalyses = STUDIES.filter((s) => s.status !== "queued").length;
  const pendingReviews = STUDIES.filter((s) => s.status === "ai-complete" || s.status === "in-review").length;
  const critical = STUDIES.filter((s) => s.priority === "stat").length;
  return [
    { label: "Studies Today", value: String(today || 128), delta: "+12.4%", trend: "up", positiveIsGood: true },
    { label: "AI Analyses", value: String(aiAnalyses), delta: "+8.1%", trend: "up", positiveIsGood: true },
    { label: "Pending Reviews", value: String(pendingReviews), delta: "-4.6%", trend: "down", positiveIsGood: true },
    { label: "Critical Findings", value: String(critical), delta: "+2", trend: "up", positiveIsGood: false },
  ];
}

export function getSystemStatus(): SystemStatus[] {
  return [
    { name: "AI Inference Engine", state: "operational", detail: "Demo model · not for clinical use" },
    { name: "DICOM Processing", state: "operational", detail: "Ingest pipeline nominal" },
    { name: "Storage", state: "operational", detail: "142ms avg. read" },
  ];
}

/**
 * Live vitals strip on the dashboard — bound to whichever STAT study is
 * actively being scanned/reviewed right now, so it reads as part of the same
 * live workspace rather than an unrelated widget. Falls back gracefully if
 * no STAT study happens to be mid-pipeline. bpm/stats are fixed demo values
 * (no Math.random() here) so server and client render identically.
 */
export function getLiveVitals(): VitalsReading {
  const active =
    STUDIES.find((s) => s.priority === "stat" && (s.status === "processing" || s.status === "in-review")) ||
    STUDIES.find((s) => s.status === "processing") ||
    STUDIES[0];

  return {
    studyRouteId: active.id,
    studyCode: active.studyId,
    patientAlias: active.patientAlias,
    modality: active.modality,
    bodyRegion: active.bodyRegion!,
    bpm: 118,
    restingBpm: 72,
    status: "elevated",
    updatedSecondsAgo: 4,
    stats: [
      { label: "Min", value: "68", unit: "bpm" },
      { label: "Avg", value: "94", unit: "bpm" },
      { label: "Max", value: "132", unit: "bpm" },
      { label: "HRV", value: "29", unit: "ms" },
    ],
  };
}

export const INCIDENTS: IncidentReport[] = [
  {
    id: "inc-1",
    incidentType: "AI Misclassification",
    severity: "medium",
    studyId: "MRD-4821",
    description: "AI flagged a pulmonary opacity that was determined on review to be a positioning artifact.",
    findings: "No true opacity present; patient rotation caused apparent asymmetry.",
    actionTaken: "Finding rejected in review workspace. Model output logged for retraining set.",
    reviewer: RADIOLOGISTS[0],
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    status: "resolved",
  },
  {
    id: "inc-2",
    incidentType: "Series Ingestion Delay",
    severity: "low",
    studyId: "MRD-3390",
    description: "CT series (212 slices) took longer than expected to preprocess before AI analysis began.",
    findings: "N/A — infrastructure issue, not a clinical finding.",
    actionTaken: "Escalated to platform engineering for pipeline profiling.",
    reviewer: RADIOLOGISTS[2],
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    status: "under-review",
  },
  {
    id: "inc-3",
    incidentType: "Discrepant Finding",
    severity: "high",
    studyId: "MRD-5512",
    description: "Radiologist identified a finding not flagged by the AI model on initial pass.",
    findings: "Small pneumothorax visible on lung window, not surfaced by AI overlay.",
    actionTaken: "Report amended prior to approval. Case queued for model review committee.",
    reviewer: RADIOLOGISTS[1],
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    status: "open",
  },
];
