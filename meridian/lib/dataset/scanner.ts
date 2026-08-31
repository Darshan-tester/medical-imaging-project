import path from "path";
import { getDataRoot } from "./config";
import { writeManifest } from "./manifest-store";
import { chestXrayAdapter } from "./adapters/chest-xray";
import { ctAdapter } from "./adapters/ct";
import { mriAdapter } from "./adapters/mri";
import { petAdapter } from "./adapters/pet";
import { ultrasoundAdapter } from "./adapters/ultrasound";
import { rocov2Adapter } from "./adapters/rocov2";
import { AdapterIssue, DatasetAdapter, DatasetCounts, DatasetManifest, DatasetSourceId, DatasetStudy } from "./types";

export const ADAPTERS: DatasetAdapter[] = [chestXrayAdapter, ctAdapter, mriAdapter, petAdapter, ultrasoundAdapter, rocov2Adapter];

export interface ScanSummary {
  manifest: DatasetManifest;
  perDataset: Record<DatasetSourceId, DatasetCounts>;
  totals: DatasetCounts;
}

export async function runScan(): Promise<ScanSummary> {
  const root = getDataRoot();
  const allStudies: DatasetStudy[] = [];
  const allIssues: AdapterIssue[] = [];

  for (const adapter of ADAPTERS) {
    const dirCandidates = adapter.matchesDir.map((d) => path.join(root, d));
    // Adapters resolve their own subdir internally via matchesDir; we just
    // hand each adapter the dataset root's first existing candidate path.
    const target = dirCandidates.find((d) => require("fs").existsSync(d)) ?? dirCandidates[0];
    try {
      const { studies, issues } = await adapter.scan(target);
      allStudies.push(...studies);
      allIssues.push(...issues);
    } catch (err) {
      allIssues.push({ dataset: adapter.id, path: target, reason: `Adapter crashed: ${(err as Error).message}` });
    }
  }

  const manifest = writeManifest(allStudies, allIssues, root);
  const perDataset = countByDataset(manifest.studies);
  const totals = sumCounts(Object.values(perDataset));

  return { manifest, perDataset, totals };
}

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

function sumCounts(counts: DatasetCounts[]): DatasetCounts {
  return counts.reduce(
    (acc, c) => ({
      studies: acc.studies + c.studies,
      images: acc.images + c.images,
      reports: acc.reports + c.reports,
      completePairs: acc.completePairs + c.completePairs,
    }),
    { studies: 0, images: 0, reports: 0, completePairs: 0 }
  );
}
