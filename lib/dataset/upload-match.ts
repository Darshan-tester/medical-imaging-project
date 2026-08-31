/**
 * SERVER-ONLY. Resolves an uploaded file back to the indexed study it came from.
 *
 * Why this exists: the upload page used to hand its files to `createDemoStudy`,
 * which invents findings from a hardcoded library with a seeded PRNG. Showing
 * that over real patient images would be fabricating a diagnosis. Matching
 * instead means the demo shows only things the dataset actually contains — the
 * study's real images, its real reconstructions, and its real radiology report —
 * with the match itself, not a model, as the thing being demonstrated.
 *
 * Two independent ways in, both exact lookups, neither one guessing from pixels:
 *
 *   1. Content hash. `npm run demo:pack` writes an export pack plus an index of
 *      `sha256 -> studyCode`. Byte-identical upload, certain match.
 *   2. Study code in the filename. Every pack file is named with its study code
 *      (e.g. `MRI-2DFB95_axial-mid.png`), so a file that has been re-saved,
 *      converted or renamed by a phone/email round-trip still resolves.
 *
 * Anything else is reported as unmatched. There is deliberately no fuzzy or
 * similarity-based fallback: a wrong match would attach one patient's report to
 * another patient's image, which is the exact failure mode the report matcher
 * was fixed to avoid.
 */
import fs from "fs";
import path from "path";

import { getCacheDir } from "./config";
import { readManifest } from "./manifest-store";
import type { DatasetSourceId, NormalizedModality } from "./types";
import { DATASET_SOURCE_LABEL } from "./types";

/** Bumped when the on-disk index shape changes, so a stale pack is reported rather than misread. */
export const UPLOAD_INDEX_VERSION = 1;

export interface UploadIndexEntry {
  /** Lowercase hex SHA-256 of the exported file's bytes. */
  sha256: string;
  bytes: number;
  /** Name the file was exported under — carries the study code for the fallback. */
  fileName: string;
  /** Resolved through the manifest at request time, so re-indexing cannot stale it. */
  studyCode: string;
  /** What this particular file is within the study, e.g. "FLAIR · Axial, slice 12 of 24". */
  sourceLabel: string;
}

export interface UploadIndex {
  version: number;
  generatedAt: string;
  entries: UploadIndexEntry[];
}

export interface UploadMatch {
  studyId: string;
  studyCode: string;
  patientAlias: string;
  modality: NormalizedModality;
  dataset: DatasetSourceId;
  datasetLabel: string;
  bodyRegion?: string;
  seriesCount: number;
  /** True when the source dataset supplied a report for this study — never fabricated. */
  hasReport: boolean;
  /** Which of the two lookups resolved it; surfaced in the UI so the demo is legible. */
  matchedBy: "content" | "filename";
  /** Only set for a content match, where the pack knows exactly which slice was exported. */
  sourceLabel?: string;
}

export type UploadMatchOutcome =
  | { status: "matched"; match: UploadMatch }
  | { status: "unmatched"; reason: string }
  | { status: "stale"; reason: string };

const INDEX_FILE = "upload-index.json";

export function getUploadIndexPath(): string {
  return path.join(getCacheDir(), INDEX_FILE);
}

let cached: { key: string; index: UploadIndex } | undefined;

/** Same single-entry mtime memo as the manifest: cheap, and self-invalidating on re-export. */
export function readUploadIndex(): UploadIndex | undefined {
  const p = getUploadIndexPath();
  try {
    const stat = fs.statSync(p);
    const key = `${p}::${stat.mtimeMs}::${stat.size}`;
    if (cached?.key === key) return cached.index;
    const index = JSON.parse(fs.readFileSync(p, "utf-8")) as UploadIndex;
    if (!index || !Array.isArray(index.entries)) return undefined;
    cached = { key, index };
    return index;
  } catch {
    return undefined;
  }
}

let hashLookup: { key: string; map: Map<string, UploadIndexEntry> } | undefined;

function entryByHash(index: UploadIndex, sha256: string): UploadIndexEntry | undefined {
  if (hashLookup?.key !== index.generatedAt) {
    const map = new Map<string, UploadIndexEntry>();
    for (const e of index.entries) map.set(e.sha256.toLowerCase(), e);
    hashLookup = { key: index.generatedAt, map };
  }
  return hashLookup.map.get(sha256.toLowerCase());
}

/**
 * Study codes look like `MRI-2DFB95` / `CHEST-7B1A02` — a dataset prefix and six
 * uppercase hex characters (see `studyCode()` in adapters/shared.ts). Anchored to
 * non-alphanumeric boundaries so it cannot cut a code out of the middle of a
 * longer token and match the wrong study.
 */
const STUDY_CODE_IN_NAME = /(?:^|[^0-9A-Za-z])([A-Z][A-Z0-9]{1,7}-[0-9A-F]{6})(?:[^0-9A-Za-z]|$)/;

export function studyCodeFromFileName(fileName: string): string | undefined {
  const m = STUDY_CODE_IN_NAME.exec(fileName.toUpperCase());
  return m?.[1];
}

/**
 * Resolves a study code against the live manifest.
 *
 * The index stores codes rather than ids on purpose: `DatasetStudy.id` is a hash
 * of the source path and `studyCode` is a hash of the adapter's seed, so both are
 * stable across re-indexing — but resolving through the manifest means an export
 * pack made before a re-index still points at whatever the current index holds,
 * and a study that has since dropped out of the index is reported as stale
 * instead of silently 404-ing the way the old "Open Study" button did.
 */
function matchByStudyCode(studyCode: string, matchedBy: UploadMatch["matchedBy"], sourceLabel?: string): UploadMatchOutcome {
  const manifest = readManifest();
  if (!manifest) {
    return { status: "stale", reason: "The dataset index has not been built yet — run `npm run dataset:index`" };
  }
  const study = manifest.studies.find((s) => s.studyCode === studyCode);
  if (!study) {
    return {
      status: "stale",
      reason: `Study ${studyCode} is not in the current index — re-run \`npm run dataset:index\`, then \`npm run demo:pack\``,
    };
  }
  return {
    status: "matched",
    match: {
      studyId: study.id,
      studyCode: study.studyCode,
      patientAlias: study.patientAlias,
      modality: study.modality,
      dataset: study.dataset,
      datasetLabel: DATASET_SOURCE_LABEL[study.dataset] ?? study.dataset,
      bodyRegion: study.bodyRegion,
      seriesCount: study.series.length,
      hasReport: Boolean(study.report),
      matchedBy,
      sourceLabel,
    },
  };
}

/**
 * Content hash first, filename second. Never both, and never a guess.
 *
 * `sha256` must already be computed from the uploaded bytes by the caller — this
 * module never touches the filesystem for uploaded data, and nothing uploaded is
 * ever written to disk.
 *
 * The version gate sits ahead of the hash lookup on purpose: reading `entries`
 * out of an index written by a different shape is precisely what the version
 * field exists to prevent. The filename lookup is left running either way,
 * because it resolves through the manifest and never touches the index, so a
 * stale pack does not have to cost a correct match.
 */
export function matchUpload(sha256: string, fileName: string): UploadMatchOutcome {
  const index = readUploadIndex();
  const usable = index?.version === UPLOAD_INDEX_VERSION ? index : undefined;

  if (usable) {
    const entry = entryByHash(usable, sha256);
    if (entry) return matchByStudyCode(entry.studyCode, "content", entry.sourceLabel);
  }

  const code = studyCodeFromFileName(fileName);
  if (code) return matchByStudyCode(code, "filename");

  if (!index) {
    return {
      status: "unmatched",
      reason: "No export pack has been generated — run `npm run demo:pack` to create matchable files",
    };
  }
  if (!usable) {
    return { status: "stale", reason: "The export pack was built by an older version — re-run `npm run demo:pack`" };
  }
  return {
    status: "unmatched",
    reason: "This file is not from the indexed dataset, so there is no real study or report to show for it",
  };
}
