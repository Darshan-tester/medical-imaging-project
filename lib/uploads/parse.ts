/**
 * ---------------------------------------------------------------------------
 * READING AN UPLOADED SCAN
 * ---------------------------------------------------------------------------
 * Turns the files a person dropped in into an `UploadedStudyRecord` plus the
 * original bytes to store beside it. Everything in the record comes from one of
 * exactly two places — the files themselves, or the upload form — and each field
 * records which, so the report can attribute values instead of presenting a
 * parsed DICOM tag and a typed guess as if they were the same thing.
 *
 * Nothing here consults the demo index, and nothing here searches for a
 * "similar" study. An upload that carries no metadata at all produces a record
 * full of absent fields, which the UI renders as "Not available" — that is the
 * honest outcome, and it is not improved by borrowing another study's values.
 *
 * Browser-only: `dicom-parser` and `nifti-reader-js` are both pure JS, but this
 * module is imported on demand by the upload page so neither lands in the bundle
 * of a page that never reads a file.
 * ---------------------------------------------------------------------------
 */

import * as dicomParser from "dicom-parser";
import * as nifti from "nifti-reader-js";

import { Modality, StudyPriority } from "../types";
import { MAX_UPLOAD_BYTES, UploadBlobInput } from "./db";
import {
  UPLOAD_RECORD_VERSION,
  UPLOAD_STUDY_PREFIX,
  UploadedDicomMeta,
  UploadedFileRecord,
  UploadedNiftiMeta,
  UploadedSeriesRecord,
  UploadedStudyRecord,
  UploadValueSource,
} from "./types";

/** What the upload form supplies. All of it optional except the two selects. */
export interface UploadFormDetails {
  patientAlias?: string;
  modality: Modality;
  bodyRegion?: string;
  priority: StudyPriority;
  age?: number;
  sex?: "M" | "F" | "Other";
  heightCm?: number;
  weightKg?: number;
  history?: string[];
  notes?: string;
}

export interface ParsedUpload {
  record: UploadedStudyRecord;
  blobs: UploadBlobInput[];
}

/**
 * DICOM modality codes this application has a modality for.
 *
 * A code outside this table (NM, XA, RF, OT…) is kept verbatim on the record and
 * the form's choice stands, because silently mapping an angiography run to "CT"
 * would misdescribe the study.
 */
const DICOM_MODALITY: Record<string, Modality> = {
  CT: "CT",
  MR: "MRI",
  PT: "PET",
  CR: "X-Ray",
  DX: "X-Ray",
  RG: "X-Ray",
  US: "Ultrasound",
  MG: "Mammography",
};

/** DICOM tags, named so the extraction below reads as the standard defines it. */
const TAG = {
  transferSyntax: "x00020010",
  patientName: "x00100010",
  patientId: "x00100020",
  patientSex: "x00100040",
  patientAge: "x00101010",
  patientSize: "x00101020",
  patientWeight: "x00101030",
  studyDate: "x00080020",
  studyTime: "x00080030",
  accessionNumber: "x00080050",
  modality: "x00080060",
  manufacturer: "x00080070",
  institution: "x00080080",
  stationName: "x00081010",
  studyDescription: "x00081030",
  seriesDescription: "x0008103e",
  modelName: "x00081090",
  contrastAgent: "x00180010",
  bodyPart: "x00180015",
  scanningSequence: "x00180020",
  sliceThickness: "x00180050",
  kvp: "x00180060",
  repetitionTime: "x00180080",
  echoTime: "x00180081",
  fieldStrength: "x00180087",
  protocolName: "x00181030",
  exposure: "x00181152",
  viewPosition: "x00185101",
  studyInstanceUid: "x0020000d",
  seriesInstanceUid: "x0020000e",
  seriesNumber: "x00200011",
  instanceNumber: "x00200013",
  orientation: "x00200037",
  numberOfFrames: "x00280008",
  rows: "x00280010",
  columns: "x00280011",
  pixelSpacing: "x00280030",
} as const;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `Doe^John^^Dr` is the DICOM form; the caret groups are the name components. */
function personName(value: string | undefined): string | undefined {
  return clean(value?.replace(/\^+/g, " ").replace(/\s+/g, " "));
}

/** DICOM `YYYYMMDD` (+ optional `HHMMSS`) to ISO. Anything else is left out entirely. */
function dicomDate(date: string | undefined, time: string | undefined): string | undefined {
  const d = clean(date);
  if (!d || !/^\d{8}$/.test(d)) return undefined;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  const t = clean(time)?.replace(/[^\d]/g, "");
  if (!t || t.length < 4) return iso;
  const hh = t.slice(0, 2);
  const mm = t.slice(2, 4);
  const ss = t.length >= 6 ? t.slice(4, 6) : "00";
  return `${iso}T${hh}:${mm}:${ss}`;
}

/** Only the `nnnY` form. Months and weeks are real DICOM ages but not years, so they are dropped rather than converted into a rounded number nobody entered. */
function dicomAgeYears(value: string | undefined): number | undefined {
  const m = /^(\d{1,3})Y$/i.exec(clean(value) ?? "");
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 120 ? n : undefined;
}

function dicomSex(value: string | undefined): "M" | "F" | "Other" | undefined {
  const v = clean(value)?.toUpperCase();
  if (v === "M") return "M";
  if (v === "F") return "F";
  if (v === "O") return "Other";
  return undefined;
}

/**
 * PatientSize is defined in metres, and a good number of scanners write
 * centimetres into it anyway. Both are accepted within their own plausible
 * range; a value outside both is ignored rather than scaled on a guess.
 */
function heightCmFrom(size: number | undefined): number | undefined {
  if (size === undefined || !Number.isFinite(size)) return undefined;
  if (size >= 0.5 && size <= 2.5) return Math.round(size * 100);
  if (size >= 50 && size <= 250) return Math.round(size);
  return undefined;
}

/**
 * The acquired plane, from the image's own direction cosines.
 *
 * ImageOrientationPatient holds the row and column direction vectors in patient
 * space; their cross product is the slice normal, and the axis it points most
 * along is the plane. This is a definition, not an inference — but it is only
 * ever applied to a file that states the tag, and series that do not state it
 * stay "Unknown".
 */
function orientationFrom(cosines: number[] | undefined): "Axial" | "Sagittal" | "Coronal" | undefined {
  if (!cosines || cosines.length < 6 || cosines.some((c) => !Number.isFinite(c))) return undefined;
  const [rx, ry, rz, cx, cy, cz] = cosines;
  const normal = [ry * cz - rz * cy, rz * cx - rx * cz, rx * cy - ry * cx].map(Math.abs);
  const dominant = normal.indexOf(Math.max(...normal));
  return dominant === 0 ? "Sagittal" : dominant === 1 ? "Coronal" : "Axial";
}

/** Projection radiography states its own view; the codes map straight onto the series orientation. */
function viewOrientation(view: string | undefined): "AP" | "PA" | "Lateral" | undefined {
  const v = clean(view)?.toUpperCase();
  if (v === "AP") return "AP";
  if (v === "PA") return "PA";
  if (v === "LL" || v === "RL" || v === "LATERAL" || v === "LAT") return "Lateral";
  return undefined;
}

type DicomDataSet = ReturnType<typeof dicomParser.parseDicom>;

function floats(ds: DicomDataSet, tag: string, count: number): number[] | undefined {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = ds.floatString(tag, i);
    if (v === undefined || !Number.isFinite(v)) return undefined;
    out.push(v);
  }
  return out;
}

function readDicomMeta(ds: DicomDataSet): UploadedDicomMeta {
  const spacing = floats(ds, TAG.pixelSpacing, 2);

  const meta: UploadedDicomMeta = {
    patientName: personName(ds.string(TAG.patientName)),
    patientId: clean(ds.string(TAG.patientId)),
    patientSex: dicomSex(ds.string(TAG.patientSex)),
    patientAge: dicomAgeYears(ds.string(TAG.patientAge)),
    patientHeightCm: heightCmFrom(ds.floatString(TAG.patientSize)),
    patientWeightKg: ds.floatString(TAG.patientWeight),
    modalityCode: clean(ds.string(TAG.modality))?.toUpperCase(),
    bodyPart: clean(ds.string(TAG.bodyPart)),
    studyDate: dicomDate(ds.string(TAG.studyDate), ds.string(TAG.studyTime)),
    studyDescription: clean(ds.string(TAG.studyDescription)),
    studyInstanceUid: clean(ds.string(TAG.studyInstanceUid)),
    accessionNumber: clean(ds.string(TAG.accessionNumber)),
    seriesInstanceUid: clean(ds.string(TAG.seriesInstanceUid)),
    seriesNumber: ds.intString(TAG.seriesNumber),
    seriesDescription: clean(ds.string(TAG.seriesDescription)),
    instanceNumber: ds.intString(TAG.instanceNumber),
    numberOfFrames: ds.intString(TAG.numberOfFrames),
    rows: ds.uint16(TAG.rows),
    columns: ds.uint16(TAG.columns),
    viewPosition: clean(ds.string(TAG.viewPosition))?.toUpperCase(),
    orientation: orientationFrom(floats(ds, TAG.orientation, 6)),
    sliceThicknessMm: ds.floatString(TAG.sliceThickness),
    pixelSpacing: spacing ? [spacing[0], spacing[1]] : undefined,
    manufacturer: clean(ds.string(TAG.manufacturer)),
    modelName: clean(ds.string(TAG.modelName)),
    institution: clean(ds.string(TAG.institution)) ?? clean(ds.string(TAG.stationName)),
    protocolName: clean(ds.string(TAG.protocolName)),
    kvp: ds.floatString(TAG.kvp),
    exposureMas: ds.floatString(TAG.exposure),
    repetitionTimeMs: ds.floatString(TAG.repetitionTime),
    echoTimeMs: ds.floatString(TAG.echoTime),
    magneticFieldStrengthT: ds.floatString(TAG.fieldStrength),
    scanningSequence: clean(ds.string(TAG.scanningSequence)),
    contrastAgent: clean(ds.string(TAG.contrastAgent)),
  };

  // Dropping the absent keys keeps "the file did not say" distinguishable from
  // "the file said nothing useful", and keeps the stored record small.
  for (const key of Object.keys(meta) as (keyof UploadedDicomMeta)[]) {
    if (meta[key] === undefined) delete meta[key];
  }
  return meta;
}

// ---------------------------------------------------------------------------
// WHAT KIND OF FILE IS THIS
// ---------------------------------------------------------------------------

/** "DICM" at byte 128, after the preamble — a Part 10 file says so in its own bytes. */
function hasDicomMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length > 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4d
  );
}

const DICOM_NAME = /\.(dcm|dicom|ima)$/i;

/**
 * Transfer syntaxes whose pixel data this application can actually read.
 *
 * Both are uncompressed and little-endian, which is what makes a typed-array
 * view over the pixel element correct. `1.2.840.10008.1.2.4.x` (JPEG family),
 * `.1.99` (deflated) and `.2` (big-endian) would each need work this build does
 * not do, so a file in one of them is rejected by name and reason rather than
 * accepted and then rendered as noise.
 */
const READABLE_SYNTAX = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"]);

/**
 * Reads a NIfTI header for its shape and description.
 *
 * The bytes kept in the store are always the ones that arrived — gzip and all —
 * so this inflates a throwaway copy purely to read the header; `decode.ts`
 * inflates again when it needs voxels. Returns undefined for anything that is
 * not NIfTI, which is the signal to try the next format.
 */
function readNiftiMeta(buffer: ArrayBuffer): UploadedNiftiMeta | undefined {
  let buf = buffer;
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) return undefined;

  const header = nifti.readHeader(buf);
  if (!header) return undefined;

  const nx = header.dims[1] ?? 0;
  const ny = header.dims[2] ?? 0;
  const nz = Math.max(1, header.dims[3] ?? 1);
  if (nx < 1 || ny < 1) return undefined;

  const spacing = [header.pixDims?.[1], header.pixDims?.[2], header.pixDims?.[3]];
  const usable = spacing.every((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  return {
    dims: [nx, ny, nz],
    pixDims: usable ? [spacing[0] as number, spacing[1] as number, spacing[2] as number] : undefined,
    description: clean(header.description),
    frames: nz,
    orientation: niftiPlane(header),
  };
}

/**
 * The plane a NIfTI's stored third axis slices along.
 *
 * NIfTI's spatial transform is defined into RAS+, so the third column of the
 * affine is the direction the slice index advances in patient space, and the
 * anatomical axis it points most along is the plane — the same rule as the DICOM
 * slice normal above. A header with neither an sform nor a qform declares no
 * such transform, and then the file simply does not say.
 */
function niftiPlane(header: { affine?: number[][]; sform_code?: number; qform_code?: number }): "Axial" | "Sagittal" | "Coronal" | undefined {
  if (!(header.sform_code ?? 0) && !(header.qform_code ?? 0)) return undefined;
  const a = header.affine;
  if (!a || a.length < 3) return undefined;

  const column = [a[0]?.[2], a[1]?.[2], a[2]?.[2]];
  if (!column.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return undefined;

  const magnitudes = column.map((v) => Math.abs(v as number));
  if (magnitudes.every((m) => m === 0)) return undefined;

  const dominant = magnitudes.indexOf(Math.max(...magnitudes));
  return dominant === 0 ? "Sagittal" : dominant === 1 ? "Coronal" : "Axial";
}

/**
 * Natural size of a raster, from actually decoding it.
 *
 * Best effort: a browser without `createImageBitmap`, or a file it declines to
 * decode, leaves the dimensions absent and the viewer sizes from the rendered
 * element instead. They are never guessed from the file size or the form.
 */
async function rasterSize(file: File): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// READING ONE FILE
// ---------------------------------------------------------------------------

interface ReadFile {
  file: UploadedFileRecord;
  blob: UploadBlobInput;
  /** Position in the selection — the tiebreak when the files carry no order of their own. */
  order: number;
}

interface RejectedFile {
  name: string;
  reason: string;
}

function isRejected(value: ReadFile | RejectedFile): value is RejectedFile {
  return "reason" in value;
}

/**
 * Classifies one file and pulls out whatever it states about itself.
 *
 * Order matters: DICOM is checked first because a `.dcm` file's own magic is
 * conclusive, then NIfTI by header, then the browser's own raster types. A file
 * none of the three claims is returned as a rejection carrying the reason, which
 * ends up on the record for the UI to show — an upload is never silently
 * reduced to the files that happened to work.
 */
async function readOne(file: File, index: number): Promise<ReadFile | RejectedFile> {
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength === 0) return { name: file.name, reason: "The file is empty." };

  const blobId = `f${index}`;
  const mimeType = file.type || "application/octet-stream";
  const blob: UploadBlobInput = { blobId, bytes, mimeType, name: file.name };
  const common = { blobId, name: file.name, bytes: bytes.byteLength, mimeType };
  const u8 = new Uint8Array(bytes);

  if (hasDicomMagic(u8) || DICOM_NAME.test(file.name)) {
    return readDicomFile(u8, file, { common, blob, index });
  }

  try {
    const niftiMeta = readNiftiMeta(bytes);
    if (niftiMeta) {
      return { file: { ...common, kind: "nifti", nifti: niftiMeta }, blob, order: index };
    }
  } catch {
    /* Not readable as NIfTI — fall through to the raster check. */
  }

  if (mimeType.startsWith("image/")) {
    const raster = await rasterSize(file);
    return { file: { ...common, kind: "raster", raster }, blob, order: index };
  }

  return {
    name: file.name,
    reason: "Not a DICOM instance, a NIfTI volume, or an image this browser can decode.",
  };
}

/**
 * Parses one DICOM instance, or explains why it cannot be displayed.
 *
 * Three rejections, all of them about this build's actual decoding ability
 * rather than about the file being wrong: unparseable bytes, a compressed or
 * big-endian transfer syntax, and an instance with no image in it at all (a
 * structured report, a DICOMDIR, a presentation state). Each says which.
 */
function readDicomFile(
  u8: Uint8Array,
  file: File,
  ctx: { common: Omit<UploadedFileRecord, "kind">; blob: UploadBlobInput; index: number },
): ReadFile | RejectedFile {
  let ds: DicomDataSet;
  try {
    ds = dicomParser.parseDicom(u8);
  } catch (err) {
    return { name: file.name, reason: `Could not be parsed as DICOM (${message(err)}).` };
  }

  const syntax = clean(ds.string(TAG.transferSyntax));
  if (syntax && !READABLE_SYNTAX.has(syntax)) {
    return {
      name: file.name,
      reason: `Transfer syntax ${syntax} is compressed or big-endian; this build reads uncompressed little-endian DICOM only.`,
    };
  }

  const meta = readDicomMeta(ds);
  if (!ds.elements.x7fe00010 || !meta.rows || !meta.columns) {
    return { name: file.name, reason: "This DICOM object carries no image pixel data." };
  }

  return { file: { ...ctx.common, kind: "dicom", dicom: meta }, blob: ctx.blob, order: ctx.index };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// GROUPING FILES INTO SERIES
// ---------------------------------------------------------------------------

/** `IM2` before `IM10`, which plain string order gets backwards. */
const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type SeriesDraft = Omit<UploadedSeriesRecord, "id">;

/**
 * DICOM instances, grouped the way the standard groups them: by
 * SeriesInstanceUID, ordered by InstanceNumber.
 *
 * Instances that state no UID fall back to SeriesNumber, and instances that
 * state neither become one series — they arrived in one upload and nothing in
 * them says they are separate acquisitions, whereas splitting them would turn a
 * scrollable stack into a list of one-slice series.
 */
function dicomSeries(items: ReadFile[]): SeriesDraft[] {
  const groups = new Map<string, ReadFile[]>();

  for (const item of items) {
    const d = item.file.dicom;
    const key = d?.seriesInstanceUid ?? (d?.seriesNumber !== undefined ? `n${d.seriesNumber}` : "dicom");
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  const drafts = [...groups.values()].map((list) => {
    const sorted = [...list].sort(compareInstances);
    const first = sorted[0].file.dicom ?? {};

    const frames = sorted.flatMap((item) => {
      const d = item.file.dicom ?? {};
      const count = Math.max(1, d.numberOfFrames ?? 1);
      return Array.from({ length: count }, (_, frame) => ({
        blobId: item.file.blobId,
        frame,
        width: d.columns,
        height: d.rows,
      }));
    });

    return {
      // SeriesNumber is the order the scanner assigned; failing that, the order
      // the files were selected in.
      rank: first.seriesNumber ?? sorted[0].order,
      draft: {
        label: first.seriesDescription ?? first.protocolName ?? seriesFallbackLabel(first.seriesNumber),
        orientation: dicomSeriesOrientation(sorted),
        frames,
        description: first.seriesDescription,
        seriesInstanceUid: first.seriesInstanceUid,
      },
    };
  });

  return drafts.sort((a, b) => a.rank - b.rank).map((entry) => entry.draft);
}

/**
 * The series' plane, only when every instance in it agrees.
 *
 * Two sources, in the order the standard makes them meaningful:
 * ImageOrientationPatient (already reduced to a plane per instance) and, for
 * projection radiography which has no such tag, ViewPosition. A series whose
 * instances disagree — or which states neither — is "Unknown", because a
 * localiser mixed in with axial slices does not make the stack sagittal.
 */
function dicomSeriesOrientation(items: ReadFile[]): UploadedSeriesRecord["orientation"] {
  const planes = new Set(items.map((i) => i.file.dicom?.orientation).filter(Boolean));
  if (planes.size === 1) return [...planes][0] as "Axial" | "Sagittal" | "Coronal";

  const views = new Set(items.map((i) => viewOrientation(i.file.dicom?.viewPosition)).filter(Boolean));
  if (views.size === 1) return [...views][0] as "AP" | "PA" | "Lateral";

  return "Unknown";
}

function seriesFallbackLabel(seriesNumber: number | undefined): string {
  return seriesNumber !== undefined ? `Series ${seriesNumber}` : "Series";
}

function compareInstances(a: ReadFile, b: ReadFile): number {
  const an = a.file.dicom?.instanceNumber;
  const bn = b.file.dicom?.instanceNumber;
  if (an !== undefined && bn !== undefined && an !== bn) return an - bn;
  return NAMES.compare(a.file.name, b.file.name) || a.order - b.order;
}

/**
 * One series per NIfTI file, one frame per stored slice.
 *
 * The frames are the volume's own third axis, and the plane is whatever the
 * header's affine says that axis is. No other plane is offered: reconstructing
 * coronal and sagittal views out of an uploaded volume would mean deriving a
 * geometry this path has not verified, and a mislabelled plane is a clinical
 * error, not a cosmetic one.
 */
function niftiSeries(items: ReadFile[]): SeriesDraft[] {
  return items.map((item) => {
    const meta = item.file.nifti as UploadedNiftiMeta;
    return {
      label: meta.description ?? item.file.name,
      orientation: meta.orientation ?? "Unknown",
      frames: Array.from({ length: meta.frames }, (_, frame) => ({
        blobId: item.file.blobId,
        frame,
        width: meta.dims[0],
        height: meta.dims[1],
      })),
      description: meta.description,
    };
  });
}

/**
 * Every ordinary image in the upload as a single series, in name order.
 *
 * One series rather than one each: a folder of exported PNGs is a stack, and
 * there is nothing in a PNG to group it by. Nothing in these files states a
 * plane, so the orientation stays "Unknown" rather than inheriting the form's.
 */
function rasterSeries(items: ReadFile[]): SeriesDraft[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => NAMES.compare(a.file.name, b.file.name) || a.order - b.order);

  return [
    {
      label: sorted.length === 1 ? sorted[0].file.name : `${sorted.length} uploaded images`,
      orientation: "Unknown",
      frames: sorted.map((item) => ({
        blobId: item.file.blobId,
        frame: 0,
        width: item.file.raster?.width,
        height: item.file.raster?.height,
      })),
    },
  ];
}

// ---------------------------------------------------------------------------
// WHERE EACH STUDY FIELD CAME FROM
// ---------------------------------------------------------------------------

/**
 * The first instance that states this tag.
 *
 * Sparse tags are normal — a series may carry PatientWeight on one instance and
 * not the next — so "absent" means no instance in the upload stated it. Where
 * instances genuinely disagree the first wins, in read order; that only happens
 * in a mixed upload, which is not a case this path tries to reconcile.
 */
function fromFiles<K extends keyof UploadedDicomMeta>(
  metas: UploadedDicomMeta[],
  key: K,
): UploadedDicomMeta[K] | undefined {
  for (const meta of metas) {
    const value = meta[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * File beats form for anything the scanner measured.
 *
 * The form is a fallback, not an override: a typed age of 50 does not get to
 * contradict a PatientAge of 62 in the file. The one exception is handled at the
 * call site — see `patientAlias` below.
 */
function resolved<T>(file: T | undefined, entered: T | undefined): { value?: T; source?: UploadValueSource } {
  if (file !== undefined) return { value: file, source: "file" };
  if (entered !== undefined) return { value: entered, source: "entered" };
  return {};
}

/**
 * The study's modality.
 *
 * A DICOM code this application has a modality for decides it outright. A code
 * it does not — NM, XA, OT — leaves the form's choice standing and is recorded
 * verbatim as `unmappedModalityCode`, so the report can show what the file
 * actually said instead of implying the mapping succeeded.
 */
function resolveModality(
  code: string | undefined,
  entered: Modality,
): Pick<UploadedStudyRecord, "modality" | "modalitySource" | "unmappedModalityCode"> {
  if (!code) return { modality: entered, modalitySource: "entered" };

  const mapped = DICOM_MODALITY[code];
  if (mapped) return { modality: mapped, modalitySource: "file" };

  return { modality: entered, modalitySource: "entered", unmappedModalityCode: code };
}

// ---------------------------------------------------------------------------
// IDENTITY
// ---------------------------------------------------------------------------

/**
 * A fresh id for every upload, and never anything derived from the file's
 * contents.
 *
 * Deriving it — hashing the StudyInstanceUID, say — would make two uploads of
 * the same scan collide, and would make an uploaded id look like the 16-hex path
 * hashes the demo index uses. The `upl_` prefix is what routes a lookup to the
 * upload store instead of the demo index; see `isUploadedStudyId`.
 */
function newStudyId(now: Date): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${UPLOAD_STUDY_PREFIX}${now.getTime().toString(36)}${random}`;
}

/** `UPL-20260903-4F1C` — a human-facing code, visibly not an `MRD-…` demo one. */
function newStudyCode(now: Date): string {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, i) => (i === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("");
  const suffix = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `UPL-${date}-${suffix}`;
}

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Reads an upload into a record and the bytes to store with it.
 *
 * Rejects only when nothing at all could be read — a partly readable upload
 * becomes a study containing what was readable, with the rest listed in
 * `rejected` so the UI can name the files it left out.
 */
export async function parseUpload(files: File[], details: UploadFormDetails): Promise<ParsedUpload> {
  if (files.length === 0) throw new Error("No files were selected.");

  // Checked before anything is read: reading 2 GB into memory only to refuse it
  // afterwards is how the tab dies instead of showing a message.
  const declared = files.reduce((sum, f) => sum + f.size, 0);
  if (declared > MAX_UPLOAD_BYTES) {
    throw new Error(
      `This upload is ${(declared / 1024 / 1024).toFixed(0)} MB, over the ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit for a single study.`,
    );
  }

  const read: ReadFile[] = [];
  const rejected: RejectedFile[] = [];

  for (const [index, file] of files.entries()) {
    const result = await readOne(file, index);
    if (isRejected(result)) rejected.push(result);
    else read.push(result);
  }

  if (read.length === 0) throw new Error(nothingReadable(rejected));

  return assemble(read, rejected, details);
}

/** The message for an upload with nothing in it this build can display. */
function nothingReadable(rejected: RejectedFile[]): string {
  if (rejected.length === 1) return `${rejected[0].name}: ${rejected[0].reason}`;
  const reasons = [...new Set(rejected.map((r) => r.reason))];
  return reasons.length === 1
    ? `None of the ${rejected.length} selected files could be read. ${reasons[0]}`
    : `None of the ${rejected.length} selected files could be read as DICOM, NIfTI, or an image this browser can decode.`;
}

/**
 * Builds the record.
 *
 * Every value below comes from one of exactly two places, and each carries which
 * — nothing is looked up, matched, or borrowed. A field neither the files nor the
 * form supplied is simply absent, and the UI renders `NOT_AVAILABLE` for it.
 */
function assemble(read: ReadFile[], rejected: RejectedFile[], details: UploadFormDetails): ParsedUpload {
  const now = new Date();
  const id = newStudyId(now);

  const dicomMetas = read.flatMap((r) => (r.file.dicom ? [r.file.dicom] : []));

  const series: UploadedSeriesRecord[] = [
    ...dicomSeries(read.filter((r) => r.file.kind === "dicom")),
    ...niftiSeries(read.filter((r) => r.file.kind === "nifti")),
    ...rasterSeries(read.filter((r) => r.file.kind === "raster")),
  ].map((draft, index) => ({ ...draft, id: `s${index + 1}` }));

  // A typed alias beats PatientName on purpose: typing one is a deliberate
  // de-identification, and honouring the file here would put the real name back
  // on the screen.
  const enteredAlias = clean(details.patientAlias);
  const fileAlias = fromFiles(dicomMetas, "patientName");

  const age = resolved(fromFiles(dicomMetas, "patientAge"), details.age);
  const sex = resolved(fromFiles(dicomMetas, "patientSex"), details.sex);
  const height = resolved(fromFiles(dicomMetas, "patientHeightCm"), details.heightCm);
  const weight = resolved(fromFiles(dicomMetas, "patientWeightKg"), details.weightKg);
  const bodyRegion = resolved(fromFiles(dicomMetas, "bodyPart"), clean(details.bodyRegion));

  const record: UploadedStudyRecord = {
    version: UPLOAD_RECORD_VERSION,
    id,
    studyCode: newStudyCode(now),
    uploadedAt: now.toISOString(),
    // Provisional. `putUpload` returns the record with the storage that was
    // actually achieved, and that is the copy the UI reads.
    storage: "session",

    ...resolveModality(fromFiles(dicomMetas, "modalityCode"), details.modality),

    patientAlias: enteredAlias ?? fileAlias,
    patientAliasSource: enteredAlias ? "entered" : fileAlias ? "file" : undefined,
    patientId: fromFiles(dicomMetas, "patientId"),

    age: age.value,
    ageSource: age.source,
    sex: sex.value,
    sexSource: sex.source,
    heightCm: height.value,
    heightSource: height.source,
    weightKg: weight.value,
    weightSource: weight.source,

    history: details.history?.length ? details.history : undefined,
    notes: clean(details.notes),

    bodyRegion: bodyRegion.value,
    bodyRegionSource: bodyRegion.source,

    // The upload date is not the study date, so an upload of a file that states
    // no StudyDate has none rather than today's.
    studyDate: fromFiles(dicomMetas, "studyDate"),
    studyDescription: fromFiles(dicomMetas, "studyDescription"),
    accessionNumber: fromFiles(dicomMetas, "accessionNumber"),
    studyInstanceUid: fromFiles(dicomMetas, "studyInstanceUid"),
    priority: details.priority,

    files: read.map((r) => r.file),
    series,
    rejected,
  };

  return { record, blobs: read.map((r) => r.blob) };
}
