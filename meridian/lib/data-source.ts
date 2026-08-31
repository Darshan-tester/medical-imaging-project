import { listStudies, getStudy as getMockStudy } from "./mock-data";
import { Study } from "./types";

/**
 * "mock" (default) uses the existing seeded demo data untouched. "dataset"
 * fetches real indexed ScanLab studies from the API routes backed by
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
