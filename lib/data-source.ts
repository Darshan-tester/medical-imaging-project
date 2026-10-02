import { listStudies, getStudy as getMockStudy } from "./mock-data";
import { getDemoStudy, listDemoStudies } from "./demo/load";
import { getUploadRecord, listUploadRecords } from "./uploads/db";
import { uploadedStudyToApp, uploadedStudyToAppSummary } from "./uploads/to-study";
import { isUploadedStudyId } from "./uploads/types";
import { Study } from "./types";

export type DataMode = "mock" | "dataset" | "demo";

/**
 * Where the studies the UI shows come from.
 *
 * - `demo` (default) reads `public/demo-data/index.json`, the committed index of
 *   the real CT / MRI / PET / chest X-ray studies in this repository. This is
 *   the only mode that works on the deployed Cloudflare Worker, because it is
 *   the only one whose pixels are static assets rather than files on a disk the
 *   Worker does not have.
 * - `dataset` fetches indexed studies from the API routes backed by
 *   `.scanlab/manifest.json` — the full local corpus, requires
 *   `SCANLAB_DATA_ROOT` and a `dataset:index` run.
 * - `mock` is the original seeded placeholder data. Kept because component tests
 *   and the design-time pages rely on a fixed, dependency-free study set, but no
 *   longer the default: a deployed build showing invented MRD-* studies beside
 *   real committed datasets was the problem this mode created.
 *
 * `NEXT_PUBLIC_DATA_MODE` is inlined at build time by Next.js, so this is safe
 * to call from client components.
 */
export function getDataMode(): DataMode {
  const mode = process.env.NEXT_PUBLIC_DATA_MODE;
  if (mode === "dataset" || mode === "mock" || mode === "demo") return mode;
  return "demo";
}

/**
 * Every study the UI can show: the studies of the current mode, plus this
 * browser's own uploads.
 *
 * Uploads are a second, separate source — read from IndexedDB, never from the
 * demo index or the manifest — and they are concatenated, not merged. Nothing is
 * matched or de-duplicated between the two: an upload of a file that happens to
 * be a copy of a committed study is still its own study with its own id.
 *
 * Newest upload first, ahead of the mode's studies. The studies page sorts the
 * combined list itself, so this only decides what the user sees before they pick
 * a sort — and after an upload, that should be the upload.
 */
export async function fetchStudies(): Promise<Study[]> {
  const [uploads, indexed] = await Promise.all([fetchUploadedStudies(), fetchModeStudies()]);
  return [...uploads, ...indexed];
}

async function fetchModeStudies(): Promise<Study[]> {
  const mode = getDataMode();
  if (mode === "mock") return listStudies();
  if (mode === "demo") return listDemoStudies();
  const res = await fetch("/api/studies");
  if (!res.ok) throw new Error(`Failed to load studies (${res.status})`);
  return res.json();
}

/**
 * The uploads stored in this browser.
 *
 * Never throws and never rejects: an unreadable upload store must not take the
 * studies list down with it, because the demo studies are still perfectly
 * loadable. `listUploadRecords` already swallows its own storage errors; this
 * catch covers a record that fails to convert.
 */
async function fetchUploadedStudies(): Promise<Study[]> {
  try {
    return (await listUploadRecords()).map(uploadedStudyToAppSummary);
  } catch {
    return [];
  }
}

/**
 * One study by id.
 *
 * The upload store is consulted first, and an `upl_` id never reaches the demo
 * index or the API at all. That ordering is the fix for the reload case: an
 * uploaded study opened from a fresh page load has to resolve from the store it
 * was written to, not fall through to a dataset that was never asked to contain
 * it — which is what produced "Study not found" on a study that plainly existed.
 */
export async function fetchStudy(id: string): Promise<Study | undefined> {
  if (isUploadedStudyId(id)) {
    const record = await getUploadRecord(id);
    return record ? uploadedStudyToApp(record) : undefined;
  }

  const mode = getDataMode();
  if (mode === "mock") return getMockStudy(id);
  if (mode === "demo") return getDemoStudy(id);
  const res = await fetch(`/api/studies/${encodeURIComponent(id)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Failed to load study (${res.status})`);
  return res.json();
}

export interface DatasetSummary {
  dataset: string;
  label: string;
  studies: number;
  images: number;
  reports: number;
  completePairs: number;
}

export async function fetchDatasetSummary(): Promise<DatasetSummary[]> {
  const res = await fetch("/api/datasets");
  if (!res.ok) throw new Error(`Failed to load dataset summary (${res.status})`);
  return res.json();
}

/**
 * Mirrors `ManifestStatus` from lib/dataset/manifest-store. Declared here
 * rather than imported so client components never pull in a module that
 * touches `fs`/`process.env.SCANLAB_DATA_ROOT`.
 */
export interface IndexStatus {
  state: "missing" | "unreadable" | "stale" | "current";
  message: string;
  remedy?: string;
  builderVersion: number;
  expectedBuilderVersion: number;
  generatedAt?: string;
  studies: number;
  reports: number;
  completePairs: number;
  perDataset: Record<string, { studies: number; reports: number; images: number }>;
  issues: number;
  error?: string;
}

export async function fetchIndexStatus(): Promise<IndexStatus | undefined> {
  // Neither mock nor demo mode has a manifest to report on, and in demo mode
  // `/api/datasets/status` has no data root to read — asking would produce an
  // "index missing" banner over studies that are present and working.
  if (getDataMode() !== "dataset") return undefined;
  const res = await fetch("/api/datasets/status");
  if (!res.ok) return undefined;
  return res.json();
}

/**
 * Mirrors the server types in lib/dataset/upload-match, declared here for the
 * same reason as `IndexStatus`: the client must not import a module that reads
 * `fs` or `SCANLAB_DATA_ROOT`. Deliberately carries no filesystem path.
 */
export interface UploadMatch {
  studyId: string;
  studyCode: string;
  patientAlias: string;
  modality: string;
  dataset: string;
  datasetLabel: string;
  bodyRegion?: string;
  seriesCount: number;
  hasReport: boolean;
  matchedBy: "content" | "filename";
  sourceLabel?: string;
}

export type UploadMatchOutcome =
  | { status: "matched"; match: UploadMatch }
  | { status: "unmatched"; reason: string }
  | { status: "stale"; reason: string };

export interface UploadMatchResult {
  fileName: string;
  bytes: number;
  sha256: string;
  outcome: UploadMatchOutcome;
}

/**
 * Sends the chosen files to be hashed and matched against the indexed dataset.
 *
 * Returns one result per file, in request order. Throws on transport or limit
 * errors so the caller can show the server's own message rather than presenting
 * a failure as "no match".
 *
 * NOT PART OF THE UPLOAD FLOW, AND NOT TO BE WIRED BACK INTO IT. This is a
 * dataset-administration lookup — "is this file already in the indexed corpus?"
 * — and it has no caller. The Upload Scan page used to call it and open whatever
 * study came back, which meant an uploaded scan could be silently replaced by a
 * demo study that happened to share its bytes. Uploads now always become their
 * own study (`lib/uploads/parse.ts` → `lib/uploads/db.ts` → `uploadedStudyToApp`)
 * and are never looked up here, or anywhere else, by hash, name, patient,
 * accession, study code or modality.
 */
export async function matchUploads(files: File[]): Promise<UploadMatchResult[]> {
  const body = new FormData();
  for (const f of files) body.append("files", f, f.name);
  const session = typeof window !== "undefined" ? window.localStorage.getItem("meridian:session") : null;
  const headers: Record<string, string> = {};
  if (session) {
    headers["x-meridian-session"] = session;
  }
  const res = await fetch("/api/uploads/match", { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new Error(detail?.error ?? `Upload matching failed (${res.status})`);
  }
  const payload = (await res.json()) as { results: UploadMatchResult[] };
  return payload.results ?? [];
}
