import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { getZipExtractCacheDir } from "./config";
import { stableId } from "./fs-utils";

/**
 * Extracts a ZIP archive from the dataset into the local cache dir exactly
 * once, keyed by a hash of (absolute path + mtime + size) so editing or
 * replacing a ZIP on disk invalidates the cache automatically, but reruns
 * against an unchanged ZIP are a no-op. Returns the directory the ZIP's
 * contents live in. Never writes anything back into `D:\ScanLab_Datasets`
 * itself and never copies the ZIP bytes — only what's inside it, and only
 * once.
 */
export function ensureExtracted(zipAbsPath: string): string {
  const stat = fs.statSync(zipAbsPath);
  const key = stableId(zipAbsPath, String(stat.mtimeMs), String(stat.size));
  const destDir = path.join(getZipExtractCacheDir(), key);
  const doneMarker = path.join(destDir, ".extracted-ok");

  if (fs.existsSync(doneMarker)) {
    return destDir;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipAbsPath);
  zip.extractAllTo(destDir, true);
  fs.writeFileSync(doneMarker, new Date().toISOString());
  return destDir;
}

/** True if `p` looks like it lives under the managed extraction cache (used by verify/debug tooling, not a security boundary by itself). */
export function isCachedExtractionPath(p: string): boolean {
  return path.resolve(p).startsWith(path.resolve(getZipExtractCacheDir()));
}
