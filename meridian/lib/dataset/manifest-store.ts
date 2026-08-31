import fs from "fs";
import path from "path";
import { getManifestPath } from "./config";
import { DatasetManifest, DatasetStudy } from "./types";

export function readManifest(): DatasetManifest | undefined {
  const p = getManifestPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as DatasetManifest;
  } catch {
    return undefined;
  }
}

/**
 * `dataset:index` always performs a full walk of SCANLAB_DATA_ROOT, so the
 * manifest is written as a full replace of the previous one — keyed and
 * deduped by each study's stable id (a hash of its real identifying
 * path/ID, see `stableId`) so re-running against an unchanged dataset
 * produces byte-identical output, and a study whose files were deleted
 * since the last run correctly disappears instead of lingering forever.
 */
export function writeManifest(newStudies: DatasetStudy[], issues: DatasetManifest["issues"], scanRoot: string): DatasetManifest {
  const byId = new Map<string, DatasetStudy>();
  for (const s of newStudies) byId.set(s.id, s);

  const manifest: DatasetManifest = {
    generatedAt: new Date().toISOString(),
    scanRoot,
    studies: [...byId.values()],
    issues,
  };

  const p = getManifestPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), "utf-8");
  return manifest;
}
