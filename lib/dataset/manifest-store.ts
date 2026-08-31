import fs from "fs";
import path from "path";
import { getManifestPath } from "./config";
import { DatasetManifest, DatasetSourceId, DatasetStudy } from "./types";

/**
 * Bump this whenever an adapter change means an existing manifest would
 * produce visibly wrong output — missing reports, missing planes, wrong
 * grouping. It is the only mechanism that makes "you forgot to re-index"
 * visible instead of silent.
 *
 * History:
 *   1 — original scan (single image ref per NIfTI file, chest reports matched
 *       against MIMIC-CXR_complete_metadata.csv, which has no identifier
 *       column and therefore never matched anything).
 *   2 — paired-manifest chest reports, PET grouped per subject/session,
 *       affine-driven per-plane NIfTI series (real Axial/Coronal/Sagittal),
 *       reconstructed DICOM volumes for CT.
 *   3 — volumetric plane series stored as one compact `frames` run instead of
 *       one ref per slice (see `series-frames.ts`). v2 was never writable: the
 *       expanded refs took the document past V8's maximum string length, so
 *       `JSON.stringify` threw `RangeError: Invalid string length`.
 *   4 — MPR series labels carry the real through-plane thickness, and ROCOv2
 *       modality is read from what the caption states instead of being hardcoded
 *       to X-Ray. Shape is unchanged from v3; the bump is here so an index built
 *       before these land is reported as stale rather than quietly serving the
 *       old labels and the old modality badges.
 */
export const MANIFEST_BUILDER_VERSION = 4;

/**
 * Single-entry memo keyed by the manifest file's mtime+size.
 *
 * Every rendered slice is a separate GET, and a multiplanar series is hundreds
 * of slices, so re-reading and re-parsing the whole manifest per request became
 * the dominant cost once volumes were expanded slice-by-slice. Keying on
 * mtime+size means `dataset:index` still takes effect immediately — a re-index
 * always changes both.
 */
let cached: { key: string; manifest: DatasetManifest } | undefined;

/**
 * Why the last `readManifest()` returned undefined. Kept separate from the
 * memo so `getManifestStatus()` can tell "never indexed" apart from "the file
 * is there but truncated/corrupt", which look identical in the UI otherwise
 * (both used to surface as an empty study list).
 */
let lastReadError: string | undefined;

export function readManifest(): DatasetManifest | undefined {
  const p = getManifestPath();
  try {
    const stat = fs.statSync(p);
    const key = `${p}::${stat.mtimeMs}::${stat.size}`;
    if (cached?.key === key) {
      lastReadError = undefined;
      return cached.manifest;
    }

    const raw = fs.readFileSync(p, "utf-8");
    const manifest = JSON.parse(raw) as DatasetManifest;
    cached = { key, manifest };
    lastReadError = undefined;
    return manifest;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      lastReadError = undefined;
      return undefined;
    }
    /*
     * A manifest larger than V8's maximum string length cannot be read back at
     * all, however well-formed it is. Name that case specifically: "unreadable"
     * otherwise reads as file corruption and sends you looking for a bad write
     * instead of at the size of the index.
     */
    const tooLong = e.code === "ERR_STRING_TOO_LONG" || err instanceof RangeError;
    lastReadError = tooLong
      ? `${e.name ?? "RangeError"}: the index is too large to read into memory (${e.message})`
      : `${e.name ?? "Error"}: ${e.message}`;
    return undefined;
  }
}

/**
 * `dataset:index` always performs a full walk of SCANLAB_DATA_ROOT, so the
 * manifest is written as a full replace of the previous one — keyed and
 * deduped by each study's stable id (a hash of its real identifying
 * path/ID, see `stableId`) so re-running against an unchanged dataset
 * produces byte-identical output apart from `generatedAt`, and a study whose
 * files were deleted since the last run correctly disappears instead of
 * lingering forever.
 */
export function writeManifest(newStudies: DatasetStudy[], issues: DatasetManifest["issues"], scanRoot: string): DatasetManifest {
  const byId = new Map<string, DatasetStudy>();
  for (const s of newStudies) byId.set(s.id, s);

  const manifest: DatasetManifest = {
    generatedAt: new Date().toISOString(),
    scanRoot,
    builderVersion: MANIFEST_BUILDER_VERSION,
    studies: [...byId.values()],
    issues,
  };

  const p = getManifestPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeManifestFile(p, manifest);
  cached = undefined;
  lastReadError = undefined;
  return manifest;
}

/**
 * Chars buffered before each `write`. Large enough that a full index is a few
 * hundred writes rather than one per study, small enough that the peak live
 * string stays trivial next to the document itself.
 */
const WRITE_CHUNK_CHARS = 1 << 22; // ~4M chars

/**
 * Serializes the manifest incrementally, one study at a time.
 *
 * `JSON.stringify(manifest)` cannot be used here: the whole document has to fit
 * in a single JavaScript string, and V8 caps those at ~512M chars. A full index
 * of this dataset exceeds that, and the failure is a bare
 * `RangeError: Invalid string length` thrown from inside stringify with the scan
 * already finished — an hour of work discarded at the last step. Stringifying
 * per study bounds the peak string by the largest single study instead of by the
 * size of the dataset, so the writer no longer has a ceiling the data can hit.
 *
 * Written to a sibling temp file and renamed, because the previous in-place
 * write left a half-written manifest behind if the run was interrupted — a
 * state the reader can only report as "unreadable". `renameSync` replaces the
 * old file atomically on both Windows and POSIX, so a reader either sees the
 * complete previous index or the complete new one.
 *
 * Output is compact rather than 2-space indented: at this nesting depth the
 * indentation was roughly a third of the file for no benefit to anything that
 * reads it.
 */
function writeManifestFile(p: string, manifest: DatasetManifest): void {
  const tmp = `${p}.tmp`;
  const fd = fs.openSync(tmp, "w");

  let buffer = "";
  const push = (chunk: string) => {
    buffer += chunk;
    if (buffer.length >= WRITE_CHUNK_CHARS) {
      fs.writeSync(fd, buffer);
      buffer = "";
    }
  };

  try {
    push("{");
    push(`"generatedAt":${JSON.stringify(manifest.generatedAt)},`);
    push(`"scanRoot":${JSON.stringify(manifest.scanRoot)},`);
    push(`"builderVersion":${JSON.stringify(manifest.builderVersion ?? MANIFEST_BUILDER_VERSION)},`);

    push(`"studies":[`);
    manifest.studies.forEach((study, i) => {
      push(i === 0 ? "\n" : ",\n");
      push(JSON.stringify(study));
    });
    push(manifest.studies.length > 0 ? "\n]," : "],");

    push(`"issues":[`);
    manifest.issues.forEach((issue, i) => {
      push(i === 0 ? "" : ",");
      push(JSON.stringify(issue));
    });
    push("]}\n");

    if (buffer.length > 0) fs.writeSync(fd, buffer);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmp, p);
}

export type IndexState = "missing" | "unreadable" | "stale" | "current";

export interface ManifestStatus {
  state: IndexState;
  /** Human-readable single sentence, safe to render directly in the UI. */
  message: string;
  /** The command that resolves a `missing`/`unreadable`/`stale` state. */
  remedy?: string;
  builderVersion: number;
  expectedBuilderVersion: number;
  generatedAt?: string;
  studies: number;
  /** Studies that have a matched source report. */
  reports: number;
  /** Studies with >=1 renderable image AND a report. */
  completePairs: number;
  /** Per-dataset study/report counts, so the UI can say *which* modality is short. */
  perDataset: Record<string, { studies: number; reports: number; images: number }>;
  issues: number;
  /** Never includes the dataset root path — that stays server-side. */
  error?: string;
}

/**
 * A cheap, self-describing summary of the index the app is currently serving.
 *
 * This exists because the manifest is the single source of truth for the UI:
 * if it predates the adapters, every downstream symptom ("no report for this
 * study", "only an axial series") is a *stale index*, not a bug in the code
 * being read. Surfacing that distinction directly is the difference between a
 * 30-second fix and another round of debugging the wrong layer.
 */
export function getManifestStatus(): ManifestStatus {
  const manifest = readManifest();
  const expected = MANIFEST_BUILDER_VERSION;

  if (!manifest) {
    const unreadable = !!lastReadError;
    return {
      state: unreadable ? "unreadable" : "missing",
      message: unreadable
        ? "The dataset index exists but could not be read — it is either truncated from an interrupted run or too large to parse."
        : "No dataset index has been built yet.",
      remedy: "npm run dataset:index",
      builderVersion: 0,
      expectedBuilderVersion: expected,
      studies: 0,
      reports: 0,
      completePairs: 0,
      perDataset: {},
      issues: 0,
      error: lastReadError,
    };
  }

  const version = manifest.builderVersion ?? 0;
  const perDataset: ManifestStatus["perDataset"] = {};
  let reports = 0;
  let completePairs = 0;

  for (const s of manifest.studies) {
    const key: DatasetSourceId = s.dataset;
    const bucket = (perDataset[key] ??= { studies: 0, reports: 0, images: 0 });
    bucket.studies += 1;
    let images = 0;
    for (const series of s.series) images += series.sliceCount;
    bucket.images += images;
    if (s.report) {
      bucket.reports += 1;
      reports += 1;
      if (images > 0) completePairs += 1;
    }
  }

  const stale = version < expected;
  return {
    state: stale ? "stale" : "current",
    message: stale
      ? `The dataset index was built by an older version of the adapters (v${version}, expected v${expected}), so reports and reconstructed planes added since then are missing from it.`
      : `Dataset index is current (v${version}).`,
    remedy: stale ? "npm run dataset:index" : undefined,
    builderVersion: version,
    expectedBuilderVersion: expected,
    generatedAt: manifest.generatedAt,
    studies: manifest.studies.length,
    reports,
    completePairs,
    perDataset,
    issues: manifest.issues.length,
  };
}
