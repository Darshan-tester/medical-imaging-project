import { listStudies, getStudy as getMockStudy } from "./mock-data";
import { Study } from "./types";

/**
 * "mock" (default) uses the existing seeded demo data untouched. "dataset"
 * fetches real indexed dataset studies from the API routes backed by
 * `.scanlab/manifest.json`. `NEXT_PUBLIC_DATA_MODE` is inlined at build
 * time by Next.js, so this is safe to call from client components.
 */
export function getDataMode(): "mock" | "dataset" {
  return process.env.NEXT_PUBLIC_DATA_MODE === "dataset" ? "dataset" : "mock";
}

export async function fetchStudies(): Promise<Study[]> {
  if (getDataMode() === "mock") return listStudies();
  const res = await fetch("/api/studies");
  if (!res.ok) throw new Error(`Failed to load studies (${res.status})`);
  return res.json();
}

export async function fetchStudy(id: string): Promise<Study | undefined> {
  if (getDataMode() === "mock") return getMockStudy(id);
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
  if (getDataMode() === "mock") return undefined;
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
 */
export async function matchUploads(files: File[]): Promise<UploadMatchResult[]> {
  const body = new FormData();
  for (const f of files) body.append("files", f, f.name);
  const res = await fetch("/api/uploads/match", { method: "POST", body });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new Error(detail?.error ?? `Upload matching failed (${res.status})`);
  }
  const payload = (await res.json()) as { results: UploadMatchResult[] };
  return payload.results ?? [];
}
