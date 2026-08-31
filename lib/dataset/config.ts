import path from "path";
import { DatasetSourceId } from "./types";

/**
 * ---------------------------------------------------------------------------
 * SERVER-ONLY. Do not import this file from a "use client" component.
 * ---------------------------------------------------------------------------
 * `SCANLAB_DATA_ROOT` is intentionally NOT prefixed `NEXT_PUBLIC_` — Next.js
 * only inlines `NEXT_PUBLIC_*` vars into the browser bundle, so this value
 * never reaches client JavaScript. Every other module in lib/dataset and
 * every app/api route reads the root exclusively through `getDataRoot()`
 * below instead of touching `process.env` directly, so there is exactly one
 * place in the whole codebase that knows the real path.
 */

export function getDataRoot(): string {
  const root = process.env.SCANLAB_DATA_ROOT;
  if (!root) {
    throw new DataRootNotConfiguredError();
  }
  return path.resolve(root);
}

export function hasDataRootConfigured(): boolean {
  return !!process.env.SCANLAB_DATA_ROOT;
}

export class DataRootNotConfiguredError extends Error {
  constructor() {
    super("SCANLAB_DATA_ROOT is not set. Copy .env.local.example to .env.local and set it to your local dataset folder.");
    this.name = "DataRootNotConfiguredError";
  }
}

/** "mock" (default) or "dataset". Read from the client-safe NEXT_PUBLIC_ var. */
export function getDataMode(): "mock" | "dataset" {
  const v = process.env.NEXT_PUBLIC_DATA_MODE;
  return v === "dataset" ? "dataset" : "mock";
}

export const DATASET_SUBDIRS: Record<DatasetSourceId, string[]> = {
  CHEST_XRAY: ["01_CHEST_XRAY"],
  CT: ["02_CT"],
  MRI: ["03_MRI"],
  ULTRASOUND: ["04_ULTRASOUND"],
  PET: ["06_PET"],
  ROCOV2: ["ROCOv2", "ROCOV2"],
};

/**
 * Where the manifest + extraction cache live. Kept OUTSIDE the Next.js
 * `app`/`components`/`public` trees (so nothing in it is ever accidentally
 * bundled or served as a static asset) and outside source control. Override
 * with SCANLAB_CACHE_DIR to point it at a drive with more room (e.g. right
 * next to the dataset itself) — useful once real volumes get large.
 */
export function getCacheDir(): string {
  return process.env.SCANLAB_CACHE_DIR ? path.resolve(process.env.SCANLAB_CACHE_DIR) : path.resolve(process.cwd(), ".scanlab");
}

export function getManifestPath(): string {
  return path.join(getCacheDir(), "manifest.json");
}

export function getZipExtractCacheDir(): string {
  return path.join(getCacheDir(), "cache", "zips");
}

export function getLogsDir(): string {
  return path.join(getCacheDir(), "logs");
}

/**
 * How many paired chest studies to index from a paired manifest CSV
 * (image path + report text in the same row).
 *
 * MIMIC-CXR ships tens of thousands of pairs. Indexing all of them is correct
 * data-wise but produces a manifest large enough that parsing it on every API
 * request dominates request time, so the default takes a bounded prefix and the
 * scan reports how many rows were left out. Set to 0 (or "all") to index every
 * pair once the manifest is served from a database rather than a JSON file.
 *
 * This only limits how many studies are indexed — it never alters, truncates or
 * substitutes the content of a report that is indexed.
 */
export function getChestPairLimit(): number {
  const raw = process.env.SCANLAB_CHEST_PAIR_LIMIT?.trim();
  if (!raw) return 1500;
  if (raw.toLowerCase() === "all") return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Whether to index chest images that have no report at all.
 *
 * `01_CHEST_XRAY` holds two different things: a paired MIMIC-CXR export (image +
 * report in one row) and a pneumonia *classification* set, which ships thousands
 * of images with a NORMAL/PNEUMONIA folder label and no radiology report of any
 * kind. Indexing both meant ~4.5k report-less studies buried the paired ones, so
 * the dataset looked like "no reports anywhere" — the reported symptom.
 *
 * Default false: index the report-less images only when explicitly asked. This
 * changes which studies are listed, never what any report says — nothing is
 * invented for the images that are skipped, and the count is reported as a scan
 * issue so the omission is visible rather than silent.
 */
export function getChestIncludeUnpaired(): boolean {
  const raw = process.env.SCANLAB_CHEST_INCLUDE_UNPAIRED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
