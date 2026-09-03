/**
 * ---------------------------------------------------------------------------
 * AN UPLOADED STUDY, AS THE APPLICATION SEES IT
 * ---------------------------------------------------------------------------
 * `UploadedStudyRecord` → `Study`. The upload counterpart of
 * `lib/dataset/to-app-study.ts`, and the whole of the difference is what is
 * absent from it: no index lookup, no nearest match, no borrowed report.
 *
 * Two rules shape every field below.
 *
 * A value is either something this upload's own files or its own form supplied,
 * or it is absent. Absent renders as "Not available" — never another study's
 * value, and never a plausible-looking substitute for one.
 *
 * No image analysis has run, because this application has no model that reads
 * pixels. So `findings` is empty and `aiStatus` is `"not-run"`, which is what
 * makes the AI panel say "AI analysis not available for this study." An empty
 * findings list without that signal would read as "nothing abnormal seen",
 * which is a diagnosis nothing on this path is entitled to make.
 *
 * The report is composed from this upload's own headers and nothing else: the
 * Technique section is extracted metadata, and Findings and Impression say
 * plainly that no interpretation exists yet.
 *
 * Pure and client-safe — no `fs`, no fetch, no parser. The heavy reading is
 * `parse.ts`'s job and the pixels are `decode.ts`'s.
 * ---------------------------------------------------------------------------
 */

import { buildPatientProfile, PatientProfile, ProfileField } from "../patient-profile";
import { Report, SeriesInfo, Study, ViewerImage } from "../types";
import { formatDate } from "../utils";
import {
  NOT_AVAILABLE,
  UploadedDicomMeta,
  UploadedFileRecord,
  UploadedSeriesRecord,
  UploadedStudyRecord,
  UploadValueSource,
  uploadImageUrl,
} from "./types";

/** Matches the dataset cover width, so a study card costs one small decode. */
const COVER_WIDTH = 320;

// ---------------------------------------------------------------------------
// SERIES AND PIXELS
// ---------------------------------------------------------------------------

/**
 * Every image in a series, as viewer instances pointing at stored bytes.
 *
 * `index` is the display position and `frame` is the position inside the file
 * they came from; a series assembled from 300 single-instance DICOM files is 300
 * frame-0 images, and a 300-slice NIfTI is one file's frames 0…299. The viewer
 * looks images up by `index`, so the two must not be conflated.
 *
 * `dicom` is deliberately left unset. The parser read real DICOM tags into the
 * record, but `DicomInstanceMetadata` drives px→mm measurement conversion, and
 * feeding it a study-level pixel spacing that may have come from a different
 * instance would put a wrong millimetre figure under a radiologist's ruler.
 */
function viewerImages(record: UploadedStudyRecord, s: UploadedSeriesRecord): ViewerImage[] {
  return s.frames.map((f, index) => ({
    index,
    imageUrl: uploadImageUrl({ studyId: record.id, blobId: f.blobId, frame: f.frame }),
    width: f.width,
    height: f.height,
  }));
}

function seriesFor(record: UploadedStudyRecord): SeriesInfo[] {
  return record.series.map((s) => ({
    id: s.id,
    label: s.label,
    sliceCount: s.frames.length,
    orientation: s.orientation,
    images: viewerImages(record, s),
    /*
     * There is no server-side volume for an upload and this path does not
     * reslice, so the 3-D view is not offered. False rather than undefined: it
     * is a known answer, not an unknown one.
     */
    volumeAvailable: false,
  }));
}

/** The middle image of the first series, downscaled, for the study cards. */
function coverImageUrl(record: UploadedStudyRecord): string | undefined {
  const s = record.series[0];
  if (!s || s.frames.length === 0) return undefined;
  const middle = s.frames[Math.floor(s.frames.length / 2)];
  return uploadImageUrl({ studyId: record.id, blobId: middle.blobId, frame: middle.frame, maxEdge: COVER_WIDTH });
}

/**
 * Seeds the synthetic placeholder texture, which an uploaded study should never
 * actually show — it has real pixels for every frame. Kept honest anyway: the
 * dataset path derives its seed from a hex id, and `upl_…` is not hex.
 */
function thumbnailSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 100000;
  return hash;
}

// ---------------------------------------------------------------------------
// PATIENT COLUMN
// ---------------------------------------------------------------------------

/**
 * Relabels a field the file itself stated.
 *
 * `buildPatientProfile` badges every supplied value with one source, and this
 * record knows per field whether the scanner wrote it or a person typed it. Only
 * the label changes here; no value is added, removed or recomputed.
 */
function badge<T>(field: ProfileField<T> | undefined, source: UploadValueSource | undefined): void {
  if (field && source === "file") field.source = "source";
}

/**
 * The report's patient column.
 *
 * `simulateMissing: false` is the whole point: the demo studies fill their gaps
 * with deterministic values badged "demo", and an upload must not. A height the
 * files did not state and nobody typed stays absent, and the panel renders "Not
 * available" — which is the requirement, and is also the only truthful answer.
 */
function profileFor(record: UploadedStudyRecord): PatientProfile {
  const profile = buildPatientProfile({
    studyId: record.id,
    displayName: record.patientAlias ?? NOT_AVAILABLE,
    modality: record.modality,
    bodyRegion: record.bodyRegion,
    age: record.age,
    sex: record.sex,
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    history: record.history,
    notes: record.notes,
    supplied: "entered",
    simulateMissing: false,
  });

  badge(profile.name, record.patientAliasSource);
  badge(profile.age, record.ageSource);
  badge(profile.sex, record.sexSource);
  badge(profile.heightCm, record.heightSource);
  badge(profile.weightKg, record.weightSource);
  return profile;
}

// ---------------------------------------------------------------------------
// THE REPORT
// ---------------------------------------------------------------------------

/** The first value any of these files states for a tag, or nothing. */
function stated<K extends keyof UploadedDicomMeta>(
  files: UploadedFileRecord[],
  key: K,
): UploadedDicomMeta[K] | undefined {
  for (const f of files) {
    const value = f.dicom?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Trims trailing zeros off a measured value without rounding it away. */
function mm(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Joins clauses into a sentence, dropping the ones nothing supplied. */
function sentence(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  return kept.length > 0 ? `${kept.join(", ")}.` : undefined;
}

/**
 * One line per series, describing only what its own files state.
 *
 * "Orientation not stated" where the geometry did not say: the parser derives
 * the plane from ImageOrientationPatient's direction cosines or a NIfTI affine
 * and leaves it `"Unknown"` otherwise, and an unlabelled plane is safer than a
 * guessed one.
 */
function seriesLine(s: UploadedSeriesRecord, position: number, byId: Map<string, UploadedFileRecord>): string {
  const files = [...new Set(s.frames.map((f) => f.blobId))]
    .map((id) => byId.get(id))
    .filter((f): f is UploadedFileRecord => f !== undefined);

  const parts: string[] = [
    s.orientation === "Unknown" ? "orientation not stated" : s.orientation.toLowerCase(),
    plural(s.frames.length, "image"),
  ];

  const thickness = stated(files, "sliceThicknessMm");
  if (thickness !== undefined) parts.push(`${mm(thickness)} mm slice thickness`);

  const spacing = stated(files, "pixelSpacing");
  if (spacing) parts.push(`${mm(spacing[0])} × ${mm(spacing[1])} mm pixel spacing`);

  const rows = stated(files, "rows");
  const columns = stated(files, "columns");
  if (rows !== undefined && columns !== undefined) parts.push(`${columns} × ${rows} matrix`);

  const volume = files.find((f) => f.nifti)?.nifti;
  if (volume) {
    parts.push(`${volume.dims.join(" × ")} voxels`);
    if (volume.pixDims) parts.push(`${volume.pixDims.map(mm).join(" × ")} mm voxel size`);
  }

  const detail = s.description && s.description !== s.label ? `${s.label} — ${s.description}` : s.label;
  return `Series ${position} · ${detail}: ${parts.join(", ")}.`;
}

/** How the study came to have the modality it has. */
function modalityProvenance(record: UploadedStudyRecord): string {
  if (record.unmappedModalityCode) {
    return `The files state modality ${record.unmappedModalityCode}, which this build has no equivalent for; ${record.modality} was selected on the upload form.`;
  }
  if (record.modalitySource === "file") {
    return `Modality read from the files' own DICOM Modality tag.`;
  }
  return `Modality as selected on the upload form; the files state none.`;
}

/**
 * The Technique section: extracted metadata, and nothing but.
 *
 * Every clause below is a value the uploaded files or the upload form supplied.
 * Where neither did, the clause is simply not written — this section never
 * describes an acquisition parameter it did not read.
 */
function techniqueFor(record: UploadedStudyRecord): string {
  const byId = new Map(record.files.map((f) => [f.blobId, f]));
  const totalBytes = record.files.reduce((sum, f) => sum + f.bytes, 0);
  const images = record.series.reduce((sum, s) => sum + s.frames.length, 0);

  const lines: string[] = [];

  lines.push(
    sentence([
      record.bodyRegion ? `${record.modality} of the ${record.bodyRegion}` : `${record.modality} study`,
      record.studyDescription ? `described by the files as "${record.studyDescription}"` : undefined,
      record.studyDate ? `acquired ${formatDate(record.studyDate)}` : "acquisition date not stated by the files",
    ]) as string,
  );

  lines.push(modalityProvenance(record));

  lines.push(
    `${plural(record.series.length, "series", "series")}, ${plural(images, "image")}, read from ${plural(record.files.length, "uploaded file")} (${bytesLabel(totalBytes)}).`,
  );

  record.series.forEach((s, i) => lines.push(seriesLine(s, i + 1, byId)));

  const equipment = sentence([
    stated(record.files, "manufacturer"),
    stated(record.files, "modelName"),
    stated(record.files, "institution"),
  ]);
  if (equipment) lines.push(`Equipment: ${equipment}`);

  const protocol = stated(record.files, "protocolName");
  if (protocol) lines.push(`Protocol: ${protocol}.`);

  const kvp = stated(record.files, "kvp");
  const mas = stated(record.files, "exposureMas");
  const exposure = sentence([
    kvp !== undefined ? `${kvp} kVp` : undefined,
    mas !== undefined ? `${mas} mAs` : undefined,
  ]);
  if (exposure) lines.push(`Exposure: ${exposure}`);

  const tr = stated(record.files, "repetitionTimeMs");
  const te = stated(record.files, "echoTimeMs");
  const field = stated(record.files, "magneticFieldStrengthT");
  const sequence = sentence([
    stated(record.files, "scanningSequence"),
    tr !== undefined ? `TR ${mm(tr)} ms` : undefined,
    te !== undefined ? `TE ${mm(te)} ms` : undefined,
    field !== undefined ? `${mm(field)} T` : undefined,
  ]);
  if (sequence) lines.push(`Sequence: ${sequence}`);

  const contrast = stated(record.files, "contrastAgent");
  if (contrast) lines.push(`Contrast agent stated by the files: ${contrast}.`);

  const identifiers = sentence([
    record.accessionNumber ? `accession ${record.accessionNumber}` : undefined,
    record.studyInstanceUid ? `Study Instance UID ${record.studyInstanceUid}` : undefined,
  ]);
  if (identifiers) lines.push(`From the files: ${identifiers}`);

  if (record.rejected.length > 0) {
    const named = record.rejected.map((r) => `${r.name} (${r.reason})`).join("; ");
    lines.push(`${plural(record.rejected.length, "file")} in this upload could not be read and are not part of this study: ${named}.`);
  }

  lines.push(
    `Uploaded ${formatDate(record.uploadedAt)}. Every value in this section was read from these files' own headers or entered on the upload form; none of it comes from another study.`,
  );

  return lines.join("\n");

}

/**
 * Clinical Information, from the history and notes the upload carried.
 *
 * Where it carried none, the section says so rather than being left blank: an
 * empty box reads as "no relevant history", which is a clinical negative nobody
 * has asserted.
 */
function clinicalFor(record: UploadedStudyRecord): string {
  const parts: string[] = [];

  if (record.history?.length) parts.push(`History: ${record.history.join("; ")}.`);
  if (record.notes) parts.push(record.notes);

  if (record.bodyRegion) {
    const origin = record.bodyRegionSource === "file" ? "stated by the files" : "entered on upload";
    parts.push(`Region: ${record.bodyRegion} (${origin}).`);
  }

  if (parts.length === 0) {
    return `${NOT_AVAILABLE} — no clinical information accompanied this upload.`;
  }
  return parts.join("\n\n");
}

/**
 * The working report for an uploaded study.
 *
 * Technique is real. Findings and Impression are explicit statements that no
 * interpretation exists, because this application has no model that reads pixels
 * and the alternative — a blank Findings box, or worse a drafted one — would
 * either read as a normal study or present invented text as analysis.
 */
function reportFor(record: UploadedStudyRecord): Report {
  return {
    /*
     * Not "ai-draft": nothing drafted it. The report is open for the radiologist
     * who reads this study to write, and is pending approval from the moment it
     * exists.
     */
    status: "in-review",
    sections: {
      clinicalInformation: clinicalFor(record),
      technique: techniqueFor(record),
      findings: `${NOT_AVAILABLE} — these images have not been interpreted. No automated image analysis was run on this upload, and no findings have been recorded for it.`,
      impression: `${NOT_AVAILABLE} — no impression has been recorded for this study.`,
    },
    aiAssisted: false,
    version: 1,
    reviewer: null,
    approvedAt: null,
  };
}

// ---------------------------------------------------------------------------
// THE STUDY
// ---------------------------------------------------------------------------

/**
 * The uploaded study the viewer opens.
 *
 * `datasetSource` and `sourceReport` stay undefined, and that is load-bearing
 * rather than incidental: the first would badge this study as having come from a
 * committed dataset, and the second is where a *prior* report belongs. An upload
 * has neither, and `resolveReportPanelContent` reads exactly this combination —
 * no `sourceReport`, no `datasetSource` — as "mirror the working report", so the
 * Radiology Report panel shows this study's own text and no other.
 */
export function uploadedStudyToApp(record: UploadedStudyRecord): Study {
  const cover = coverImageUrl(record);

  return {
    id: record.id,
    studyId: record.studyCode,
    patientAlias: record.patientAlias ?? NOT_AVAILABLE,
    age: record.age,
    sex: record.sex,
    modality: record.modality,
    bodyRegion: record.bodyRegion,
    /*
     * The acquisition date, where a file states one — never the upload date. An
     * upload made today of a study acquired in 2019 is a 2019 study, and dating
     * it today would misfile it in every list that sorts on this.
     */
    date: record.studyDate,
    priority: record.priority,
    /*
     * Arrived and waiting to be read. Not "ai-complete" (nothing ran) and not
     * "in-review" (nobody is reviewing it — `assignedRadiologist` is null).
     */
    status: "queued",
    aiConfidence: null,
    assignedRadiologist: null,
    series: seriesFor(record),
    /*
     * Empty, with `aiStatus: "not-run"` to say why. This is the requirement that
     * findings appear only where the pipeline genuinely supports them: there is
     * no detector, so there are no boxes, no confidences and no "Show on scan".
     */
    findings: [],
    aiStatus: "not-run",
    thumbnailSeed: thumbnailSeed(record.id),
    imageUrls: cover ? [cover] : undefined,
    report: reportFor(record),
    patientProfile: profileFor(record),
    uploaded: {
      uploadedAt: record.uploadedAt,
      fileCount: record.files.length,
      fileNames: record.files.map((f) => f.name),
      storage: record.storage,
    },
  };
}

/**
 * The list projection, mirroring `toAppStudySummary`.
 *
 * The studies table renders no per-slice URL and no report prose, and a 500-slice
 * upload otherwise carries 500 marker strings through every filter and re-sort.
 * The cover URL survives, so the card shows a real slice of the real upload.
 */
export function uploadedStudyToAppSummary(record: UploadedStudyRecord): Study {
  const full = uploadedStudyToApp(record);

  return {
    ...full,
    series: full.series.map((s) => ({
      id: s.id,
      label: s.label,
      sliceCount: s.sliceCount,
      orientation: s.orientation,
    })),
    report: {
      ...full.report,
      sections: { clinicalInformation: "", technique: "", findings: "", impression: "" },
    },
  };
}

