import { DatasetCounts, DatasetSourceId, DatasetStudy } from "./types";

/**
 * Per-dataset tallies over an already-built manifest.
 *
 * Deliberately kept in its own module rather than in `scanner.ts`. This is a
 * pure function over manifest data — it reads no files — but `scanner.ts`
 * imports all six adapters, and `adapters/mri.ts` pulls in `zip-cache.ts` and
 * therefore `adm-zip`. Importing `countByDataset` from `scanner` dragged that
 * whole filesystem-and-ZIP graph into `app/api/datasets/route.ts`, and from
 * there into the server bundle, for a function that needs none of it. That
 * matters on Cloudflare Workers, where there is no local filesystem to walk
 * and `adm-zip`'s optional `original-fs` require has nothing to resolve to.
 *
 * `scanner.ts` and `verify.ts` (both Node-only, run from `scripts/`) import it
 * from here too, so there is still exactly one implementation.
 */
export function countByDataset(studies: DatasetStudy[]): Record<DatasetSourceId, DatasetCounts> {
  const ids: DatasetSourceId[] = ["MRI", "CT", "CHEST_XRAY", "PET", "ULTRASOUND", "ROCOV2"];
  const result = {} as Record<DatasetSourceId, DatasetCounts>;
  for (const id of ids) {
    const subset = studies.filter((s) => s.dataset === id);
    const images = subset.reduce((sum, s) => sum + s.series.reduce((n, se) => n + se.sliceCount, 0), 0);
    const reports = subset.filter((s) => !!s.report).length;
    const completePairs = subset.filter((s) => !!s.report && s.series.some((se) => se.sliceCount > 0)).length;
    result[id] = { studies: subset.length, images, reports, completePairs };
  }
  return result;
}
