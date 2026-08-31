import path from "path";
import { parseCsv, pickColumn, readTextFileSafe, safeExists, stableId, walk } from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { AdapterIssue, AdapterResult, DatasetAdapter, DatasetStudy, StudyReport } from "../types";
import { buildSeriesFromFiles, DICOM_EXTS, RASTER_EXTS, studyCode } from "./shared";

interface ReportRow {
  key?: string;
  text: string;
}

/**
 * Same image+report pairing approach as Chest X-Ray. If `04_ULTRASOUND`
 * doesn't exist, is empty, or contains no image files at all, this adapter
 * returns an empty study list — the UI is responsible for showing
 * "No indexed studies available.", never a fabricated placeholder.
 */
export const ultrasoundAdapter: DatasetAdapter = {
  id: "ULTRASOUND",
  matchesDir: ["04_ULTRASOUND"],
  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];
    if (!safeExists(rootDir)) return { studies: [], issues };

    const imageFiles = [...walk(rootDir, { extensions: [...RASTER_EXTS, ...DICOM_EXTS] })];
    if (imageFiles.length === 0) return { studies: [], issues };

    const csvFiles = [...walk(rootDir, { extensions: [".csv"] })];
    const reportLookup = loadReports(csvFiles, issues);

    const studies: DatasetStudy[] = [];
    for (const img of imageFiles) {
      const stem = path.basename(img, path.extname(img));
      const series = buildSeriesFromFiles({
        seriesId: stableId("ULTRASOUND", stem, "series-0"),
        label: "Ultrasound",
        modality: "Ultrasound",
        orientation: "Unknown",
        files: [img],
      });
      const reportRow = matchByIdentifiers(reportLookup, [stem]);
      const report: StudyReport | undefined = reportRow ? { source: "Ultrasound dataset", text: reportRow.text } : undefined;
      const id = stableId("ULTRASOUND", stem);
      studies.push({
        id,
        dataset: "ULTRASOUND",
        studyCode: studyCode("US", stem),
        sourceStudyId: stem,
        patientAlias: `Patient ${id.slice(0, 6).toUpperCase()}`,
        modality: "Ultrasound",
        series: [series],
        report,
        sourceDir: rootDir,
      });
    }
    return { studies, issues };
  },
};

function loadReports(csvFiles: string[], issues: AdapterIssue[]): Map<string, ReportRow> {
  const rows: ReportRow[] = [];
  for (const csv of csvFiles) {
    const content = readTextFileSafe(csv);
    if (!content) {
      issues.push({ dataset: "ULTRASOUND", path: csv, reason: "Unreadable CSV file" });
      continue;
    }
    let parsed: Record<string, string>[];
    try {
      parsed = parseCsv(content);
    } catch {
      issues.push({ dataset: "ULTRASOUND", path: csv, reason: "Malformed CSV" });
      continue;
    }
    for (const row of parsed) {
      const key = pickColumn(row, ["filename", "file_name", "image", "image_id", "id"]);
      const text = pickColumn(row, ["report", "findings", "impression", "text"]);
      if (key && text) rows.push({ key, text });
    }
  }
  return buildLookup(rows, (r) => r.key);
}
