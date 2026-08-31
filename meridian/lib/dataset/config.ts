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
