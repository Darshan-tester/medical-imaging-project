import path from "path";
import { parseCsv, pickColumn, readTextFileSafe, safeExists, stableId, walk } from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { readDicomSummary } from "../image-render";
import { AdapterIssue, AdapterResult, DatasetAdapter, DatasetStudy, StudyReport } from "../types";
import { buildSeriesFromFiles, DICOM_EXTS, extKind, RASTER_EXTS, studyCode } from "./shared";

interface ReportRow {
  id?: string;
  text: string;
  raw: Record<string, string>;
}

/**
 * Chest X-Ray is normally single-frame: one file = one study by default.
 * If a metadata CSV groups multiple files under a shared study/patient ID
 * (e.g. an AP + a Lateral view of the same exam), those are grouped into
 * one study with multiple single-image series instead — but only when the
 * CSV actually says so. Nothing here guesses a grouping from filenames
 * alone, since that's exactly the "randomly associate" mistake the spec
 * calls out.
 */
export const chestXrayAdapter: DatasetAdapter = {
  id: "CHEST_XRAY",
  matchesDir: ["01_CHEST_XRAY"],
  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];
    if (!safeExists(rootDir)) return { studies: [], issues };

    const imageFiles = [...walk(rootDir, { extensions: [...RASTER_EXTS, ...DICOM_EXTS] })];
    const csvFiles = [...walk(rootDir, { extensions: [".csv"] })];
    const jsonFiles = [...walk(rootDir, { extensions: [".json"] })];

    const { reportLookup, groupLookup } = loadReportsAndGroups(csvFiles, jsonFiles, issues);

    // Group images: by an explicit "study id" from the CSV if the CSV
    // provides one for this filename, otherwise each image is its own study.
    const groups = new Map<string, string[]>();
    for (const img of imageFiles) {
      const stem = path.basename(img, path.extname(img));
      const groupId = groupLookup.get(stem.toLowerCase()) ?? stem;
      const list = groups.get(groupId) ?? [];
      list.push(img);
      groups.set(groupId, list);
    }

    const studies: DatasetStudy[] = [];
    for (const [groupId, files] of groups) {
      files.sort();
      const seriesId = stableId("CHEST_XRAY", groupId, "series-0");
      let orientation = detectOrientationFromDicom(files);
      const series = buildSeriesFromFiles({
        seriesId,
        label: orientation !== "Unknown" ? orientation : "Chest X-Ray",
        modality: "X-Ray",
        orientation,
        files,
      });
      if (series.images.length === 0) continue;

      const stem = path.basename(files[0], path.extname(files[0]));
      const reportRow = matchByIdentifiers(reportLookup, [groupId, stem]);
      const report: StudyReport | undefined = reportRow
        ? { source: "Chest X-Ray dataset", text: reportRow.text }
        : undefined;

      const id = stableId("CHEST_XRAY", groupId);
      studies.push({
        id,
        dataset: "CHEST_XRAY",
        studyCode: studyCode("CXR", groupId),
        sourceStudyId: groupId,
        patientAlias: `Patient ${id.slice(0, 6).toUpperCase()}`,
        modality: "X-Ray",
        bodyRegion: "Chest",
        series: [series],
        report,
        sourceDir: rootDir,
      });
    }

    return { studies, issues };
  },
};

function detectOrientationFromDicom(files: string[]): "AP" | "PA" | "Lateral" | "Unknown" {
  for (const f of files) {
    if (extKind(f) !== "dicom") continue;
    const summary = readDicomSummary(f);
    if (summary?.orientation) return summary.orientation as "AP" | "PA" | "Lateral";
  }
  return "Unknown";
}

function loadReportsAndGroups(csvFiles: string[], jsonFiles: string[], issues: AdapterIssue[]) {
  const rows: ReportRow[] = [];
  const groupRows: { fileStem: string; groupId: string }[] = [];

  for (const csv of csvFiles) {
    const content = readTextFileSafe(csv);
    if (!content) {
      issues.push({ dataset: "CHEST_XRAY", path: csv, reason: "Unreadable CSV file" });
      continue;
    }
    let parsed: Record<string, string>[];
    try {
      parsed = parseCsv(content);
    } catch {
      issues.push({ dataset: "CHEST_XRAY", path: csv, reason: "Malformed CSV" });
      continue;
    }
    for (const row of parsed) {
      const id = pickColumn(row, ["filename", "file_name", "image", "image_id", "id", "uid"]);
      const text = pickColumn(row, ["report", "findings", "impression", "text", "caption", "narrative"]);
      const studyGroup = pickColumn(row, ["study_id", "study id", "accession", "accession_number", "patient_id"]);
      if (id && text) rows.push({ id, text, raw: row });
      if (id && studyGroup) groupRows.push({ fileStem: id.toLowerCase(), groupId: studyGroup });
    }
  }

  for (const jf of jsonFiles) {
    const content = readTextFileSafe(jf);
    if (!content) continue;
    try {
      const data = JSON.parse(content);
      const arr = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({ id: k, ...(typeof v === "object" ? v : { text: v }) }));
      for (const entry of arr) {
        const id = entry.filename ?? entry.file_name ?? entry.image_id ?? entry.id;
        const text = entry.report ?? entry.findings ?? entry.impression ?? entry.text ?? entry.caption;
        if (id && text) rows.push({ id: String(id), text: String(text), raw: entry });
      }
    } catch {
      issues.push({ dataset: "CHEST_XRAY", path: jf, reason: "Malformed JSON" });
    }
  }

  const reportLookup = buildLookup(rows, (r) => r.id);
  const groupLookup = new Map<string, string>();
  for (const g of groupRows) groupLookup.set(g.fileStem, g.groupId);

  return { reportLookup, groupLookup };
}
