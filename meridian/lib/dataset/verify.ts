import fs from "fs";
import { readManifest } from "./manifest-store";
import { countByDataset } from "./scanner";
import { DatasetSourceId, VerifyReport } from "./types";

export function runVerify(): VerifyReport {
  const manifest = readManifest();
  const ids: DatasetSourceId[] = ["MRI", "CT", "CHEST_XRAY", "PET", "ULTRASOUND", "ROCOV2"];

  if (!manifest) {
    const empty = { studies: 0, images: 0, reports: 0, completePairs: 0 };
    return {
      generatedAt: new Date().toISOString(),
      perDataset: Object.fromEntries(ids.map((id) => [id, empty])) as VerifyReport["perDataset"],
      totals: empty,
      problems: {
        missingImages: [],
        missingReports: [],
        brokenRelationships: [],
        invalidFiles: [],
        duplicateStudyIds: [],
        unsupportedFormats: [],
        missingSeries: [],
        unreadableFiles: ["No manifest found — run `npm run dataset:index` first."],
      },
    };
  }

  const perDataset = countByDataset(manifest.studies);
  const totals = Object.values(perDataset).reduce(
    (acc, c) => ({
      studies: acc.studies + c.studies,
      images: acc.images + c.images,
      reports: acc.reports + c.reports,
      completePairs: acc.completePairs + c.completePairs,
    }),
    { studies: 0, images: 0, reports: 0, completePairs: 0 }
  );

  const missingImages: string[] = [];
  const missingReports: string[] = [];
  const brokenRelationships: string[] = [];
  const missingSeries: string[] = [];
  const seenSourceIds = new Map<string, string[]>(); // "DATASET::sourceStudyId" -> [manifest ids]

  for (const study of manifest.studies) {
    const key = `${study.dataset}::${study.sourceStudyId}`;
    seenSourceIds.set(key, [...(seenSourceIds.get(key) ?? []), study.id]);

    if (study.series.length === 0) {
      missingSeries.push(`${study.studyCode}: study has zero series`);
      continue;
    }

    for (const series of study.series) {
      if (series.images.length === 0) {
        brokenRelationships.push(`${study.studyCode} / ${series.label}: series declares ${series.sliceCount} slices but has 0 image refs`);
      }
      for (const img of series.images) {
        try {
          if (!fs.existsSync(img.absPath)) {
            missingImages.push(`${study.studyCode} / ${series.label} #${img.index}: file no longer exists on disk`);
          }
        } catch {
          missingImages.push(`${study.studyCode} / ${series.label} #${img.index}: unreadable path`);
        }
      }
    }

    if (!study.report) {
      missingReports.push(`${study.studyCode}: no report matched`);
    }
  }

  const duplicateStudyIds = [...seenSourceIds.entries()].filter(([, ids]) => ids.length > 1).map(([key]) => key);

  const invalidFiles = manifest.issues.filter((i) => /invalid|corrupt|parse|malformed/i.test(i.reason)).map((i) => `[${i.dataset}] ${i.reason}: ${i.path}`);
  const unreadableFiles = manifest.issues.filter((i) => /unreadable|could not read|failed to extract/i.test(i.reason)).map((i) => `[${i.dataset}] ${i.reason}: ${i.path}`);
  const unsupportedFormats = manifest.issues.filter((i) => /unsupported/i.test(i.reason)).map((i) => `[${i.dataset}] ${i.reason}: ${i.path}`);

  return {
    generatedAt: new Date().toISOString(),
    perDataset,
    totals,
    problems: { missingImages, missingReports, brokenRelationships, invalidFiles, duplicateStudyIds, unsupportedFormats, missingSeries, unreadableFiles },
  };
}
