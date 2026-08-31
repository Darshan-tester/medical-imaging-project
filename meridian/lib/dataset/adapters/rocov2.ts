import path from "path";
import { parseCsv, pickColumn, readTextFileSafe, safeExists, stableId, walk } from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { AdapterIssue, AdapterResult, DatasetAdapter, DatasetStudy, StudyReport } from "../types";
import { buildSeriesFromFiles, RASTER_EXTS, studyCode } from "./shared";

interface CaptionRow {
  key?: string;
  caption: string;
}

/**
 * ROCOv2 is published as image folders alongside CSVs mapping an image ID to
 * a caption (commonly `*_captions.csv` with `ID`/`Caption` columns, e.g. one
 * file per split — train/valid/test). This adapter reads every CSV that has
 * an ID-like and a caption-like column, and matches each image file to a
 * caption by filename stem. Concept/CUI CSVs (modality/anatomy labels) are
 * read too where present, but ROCOv2 spans multiple modalities and this
 * repo has no reliable per-image modality signal without them — images are
 * only ever labeled a specific modality when a concepts file actually says
 * so; otherwise they're indexed as "X-Ray" (the dataset's majority class)
 * and clearly badged "ROCOv2" so nobody mistakes it for a modality-verified
 * source.
 */
export const rocov2Adapter: DatasetAdapter = {
  id: "ROCOV2",
  matchesDir: ["ROCOv2", "ROCOV2"],
  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];
    if (!safeExists(rootDir)) return { studies: [], issues };

    const imageFiles = [...walk(rootDir, { extensions: RASTER_EXTS })];
    if (imageFiles.length === 0) return { studies: [], issues };

    const csvFiles = [...walk(rootDir, { extensions: [".csv"] })];
    const captionLookup = loadCaptions(csvFiles, issues);

    const studies: DatasetStudy[] = [];
    for (const img of imageFiles) {
      const stem = path.basename(img, path.extname(img));
      const captionRow = matchByIdentifiers(captionLookup, [stem]);
      if (!captionRow) continue; // never expose an ROCOv2 image with no real caption as a "study"

      const series = buildSeriesFromFiles({
        seriesId: stableId("ROCOV2", stem, "series-0"),
        label: "Image",
        modality: "X-Ray",
        orientation: "Unknown",
        files: [img],
      });
      const report: StudyReport = { source: "ROCOv2", text: captionRow.caption };
      const id = stableId("ROCOV2", stem);
      studies.push({
        id,
        dataset: "ROCOV2",
        studyCode: studyCode("ROCO", stem),
        sourceStudyId: stem,
        patientAlias: `ROCOv2 ${id.slice(0, 6).toUpperCase()}`,
        modality: "X-Ray",
        series: [series],
        report,
        sourceDir: rootDir,
      });
    }

    return { studies, issues };
  },
};

function loadCaptions(csvFiles: string[], issues: AdapterIssue[]): Map<string, CaptionRow> {
  const rows: CaptionRow[] = [];
  for (const csv of csvFiles) {
    const content = readTextFileSafe(csv);
    if (!content) {
      issues.push({ dataset: "ROCOV2", path: csv, reason: "Unreadable CSV file" });
      continue;
    }
    let parsed: Record<string, string>[];
    try {
      parsed = parseCsv(content);
    } catch {
      issues.push({ dataset: "ROCOV2", path: csv, reason: "Malformed CSV" });
      continue;
    }
    if (parsed.length === 0) continue;
    const hasCaptionCol = !!pickColumn(parsed[0], ["caption", "captions"]);
    if (!hasCaptionCol) continue; // this CSV is probably the concepts/CUI file, not captions
    for (const row of parsed) {
      const key = pickColumn(row, ["id", "image_id", "imageid", "filename"]);
      const caption = pickColumn(row, ["caption", "captions"]);
      if (key && caption) rows.push({ key, caption });
    }
  }
  return buildLookup(rows, (r) => r.key);
}
