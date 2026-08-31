import path from "path";
import fs from "fs";
import { parseCsv, pickColumn, readTextFileSafe, safeExists, stableId, walk, assertWithinRoot } from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { readDicomSummary } from "../image-render";
import { getChestIncludeUnpaired, getChestPairLimit } from "../config";
import { AdapterIssue, AdapterResult, DatasetAdapter, DatasetStudy, StudyReport } from "../types";
import { buildSeriesFromFiles, DICOM_EXTS, extKind, RASTER_EXTS, studyCode } from "./shared";

interface ReportRow {
  id?: string;
  text: string;
  raw: Record<string, string>;
}

/**
 * One row of a "paired manifest": a CSV that carries an identifier, a path to a
 * specific image file, and that image's report all in the SAME row.
 *
 * This is the only trustworthy way to attach MIMIC-CXR reports. MIMIC's image
 * and report live together inside a parquet row and share no printable
 * identifier, so once the images are extracted to disk the pairing survives
 * only as an explicit per-row image path. Joining on anything else — filename
 * similarity, row ordinal against a second CSV, patient-looking substrings —
 * risks attaching one patient's report to another patient's radiograph, so it
 * is not attempted.
 */
interface PairedRow {
  id: string;
  absPath: string;
  text: string;
  source: string;
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

    const studies: DatasetStudy[] = [];

    // ------------------------------------------------------------------------
    // Pass 1 — explicitly paired image+report rows (MIMIC-CXR).
    // ------------------------------------------------------------------------

    const paired = loadPairedRows(rootDir, csvFiles, issues);
    const pairedPaths = new Set<string>();

    for (const row of paired) {
      pairedPaths.add(row.absPath.toLowerCase());

      const seriesId = stableId("CHEST_XRAY", row.id, "series-0");
      const series = buildSeriesFromFiles({
        seriesId,
        label: "Chest X-Ray",
        modality: "X-Ray",
        // MIMIC's extracted JPEGs carry no view metadata, so the view is left
        // Unknown rather than assumed to be frontal.
        orientation: "Unknown",
        files: [row.absPath],
      });
      if (series.images.length === 0) continue;

      const id = stableId("CHEST_XRAY", row.id);
      studies.push({
        id,
        dataset: "CHEST_XRAY",
        studyCode: studyCode("CXR", row.id),
        sourceStudyId: row.id,
        patientAlias: `Patient ${id.slice(0, 6).toUpperCase()}`,
        modality: "X-Ray",
        bodyRegion: "Chest",
        series: [series],
        report: { source: row.source, text: row.text },
        sourceDir: rootDir,
      });
    }

    // ------------------------------------------------------------------------
    // Pass 2 — images not covered by a paired manifest.
    // ------------------------------------------------------------------------

    // Group images: by an explicit "study id" from the CSV if the CSV
    // provides one for this filename, otherwise each image is its own study.
    const includeUnpaired = getChestIncludeUnpaired();
    let skippedUnpaired = 0;
    const groups = new Map<string, string[]>();
    for (const img of imageFiles) {
      if (pairedPaths.has(img.toLowerCase())) continue;
      const stem = path.basename(img, path.extname(img));
      const groupId = groupLookup.get(stem.toLowerCase()) ?? stem;
      const list = groups.get(groupId) ?? [];
      list.push(img);
      groups.set(groupId, list);
    }

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

      // The pneumonia classification set has a folder label, not a report. Those
      // images are real, but a study with no report is not what the reviewer
      // asked to see, and thousands of them hide the paired studies that do have
      // one. Skipped by default, counted below, and never given a made-up report.
      if (!report && !includeUnpaired) {
        skippedUnpaired++;
        continue;
      }

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

    if (skippedUnpaired > 0) {
      issues.push({
        dataset: "CHEST_XRAY",
        path: rootDir,
        reason: `Skipped ${skippedUnpaired} chest images that have no report in this dataset (the pneumonia classification set carries a NORMAL/PNEUMONIA folder label, not a radiology report). Set SCANLAB_CHEST_INCLUDE_UNPAIRED=1 to index them as image-only studies`,
      });
    }

    return { studies, issues };
  },
};

/** Column names that name an actual image FILE (not a free-text blurb about one). */
const IMAGE_PATH_COLUMNS = ["image_path", "imagepath", "image_file", "imagefile", "file_path", "filepath", "jpg_path", "png_path"];
const PAIRED_ID_COLUMNS = ["subject_id", "study_id", "image_id", "id", "uid", "accession", "accession_number"];
const PAIRED_TEXT_COLUMNS = ["report", "findings", "impression", "narrative", "text"];

/**
 * Finds every CSV that pairs an image file with its report in one row, and
 * returns those rows with the image path resolved to a real file on disk.
 *
 * Sibling-directory discovery: extraction tooling writes its output next to the
 * dataset folders rather than inside one of them (e.g. `_integration/` beside
 * `01_CHEST_XRAY/`), and the scanner only ever hands an adapter a single
 * directory. So the parent of `rootDir` is checked for such folders too. That
 * parent IS `SCANLAB_DATA_ROOT`, and every resolved path is re-checked against
 * it, so nothing outside the configured root can be indexed.
 */
function loadPairedRows(rootDir: string, csvFilesInRoot: string[], issues: AdapterIssue[]): PairedRow[] {
  const dataRoot = path.dirname(rootDir);
  const candidates = [...csvFilesInRoot, ...siblingManifestCsvs(dataRoot)];

  const limit = getChestPairLimit();
  const out: PairedRow[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  let unresolved = 0;
  let truncated = 0;

  for (const csv of candidates) {
    const content = readTextFileSafe(csv);
    if (!content) continue;

    let parsed: Record<string, string>[];
    try {
      parsed = parseCsv(content);
    } catch {
      continue; // Already reported by loadReportsAndGroups for in-root CSVs.
    }
    if (parsed.length === 0) continue;

    // A paired manifest must carry all three in the same row. Any CSV missing
    // one of them is left to the ordinary report-lookup path.
    const probe = parsed[0];
    const hasTriple =
      !!pickColumn(probe, PAIRED_ID_COLUMNS) &&
      !!pickColumn(probe, IMAGE_PATH_COLUMNS) &&
      !!pickColumn(probe, PAIRED_TEXT_COLUMNS);
    if (!hasTriple) continue;

    const csvDir = path.dirname(csv);
    const source = pairedReportSource(csv);
    let acceptedFromThisCsv = 0;

    for (const row of parsed) {
      const id = pickColumn(row, PAIRED_ID_COLUMNS)?.trim();
      const rawPath = pickColumn(row, IMAGE_PATH_COLUMNS)?.trim();
      const text = pickColumn(row, PAIRED_TEXT_COLUMNS)?.trim();
      if (!id || !rawPath || !text) continue;

      if (limit > 0 && out.length >= limit) {
        truncated++;
        continue;
      }

      const absPath = resolveManifestImage(rawPath, csvDir, rootDir, dataRoot);
      if (!absPath) {
        unresolved++;
        continue;
      }

      // One study per image, and never two studies over the same file — an id
      // or a path appearing twice would otherwise duplicate a patient.
      const pathKey = absPath.toLowerCase();
      if (seenIds.has(id) || seenPaths.has(pathKey)) continue;
      seenIds.add(id);
      seenPaths.add(pathKey);

      out.push({ id, absPath, text, source });
      acceptedFromThisCsv++;
    }

    if (acceptedFromThisCsv === 0 && unresolved > 0) {
      issues.push({
        dataset: "CHEST_XRAY",
        path: csv,
        reason: `Looks like a paired image/report manifest but none of its ${unresolved} image paths resolved to a file on disk, so no report was attached from it`,
      });
      unresolved = 0;
    }
  }

  if (truncated > 0) {
    issues.push({
      dataset: "CHEST_XRAY",
      path: rootDir,
      reason: `Indexed ${out.length} paired chest studies and skipped ${truncated} more. The pairing for the skipped rows exists and is valid; only the number indexed is capped (SCANLAB_CHEST_PAIR_LIMIT, set to "all" to index every pair)`,
    });
  }

  return out;
}

/**
 * Directories beside the dataset folders that hold extraction output. Only
 * their top level is read, and only CSVs — no recursive walk of a folder that
 * may contain tens of thousands of extracted images.
 */
function siblingManifestCsvs(dataRoot: string): string[] {
  const out: string[] = [];
  for (const name of ["_integration", "_derived", "_prepared"]) {
    const dir = path.join(dataRoot, name);
    if (!safeExists(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
          out.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // Unreadable sibling directory is not an error for this dataset.
    }
  }
  return out.sort();
}

/**
 * Resolves a manifest's image reference to a real, supported image file inside
 * the data root. Returns undefined for anything that is not one — which is also
 * what rejects prose masquerading as a path (MIMIC's ID-less metadata CSV
 * stores literal strings like "Image present | Bytes: 33,749").
 */
function resolveManifestImage(rawPath: string, csvDir: string, rootDir: string, dataRoot: string): string | undefined {
  const attempts = path.isAbsolute(rawPath)
    ? [rawPath]
    : [path.resolve(csvDir, rawPath), path.resolve(rootDir, rawPath), path.resolve(dataRoot, rawPath)];

  for (const attempt of attempts) {
    let withinRoot: string;
    try {
      withinRoot = assertWithinRoot(dataRoot, attempt);
    } catch {
      continue; // Points outside SCANLAB_DATA_ROOT — refuse to index it.
    }
    if (!extKind(withinRoot)) continue;
    if (!safeExists(withinRoot)) continue;
    return withinRoot;
  }
  return undefined;
}

/** Badge shown on the report, derived from the manifest that supplied it. */
function pairedReportSource(csv: string): string {
  const name = path.basename(csv).toLowerCase();
  if (name.includes("mimic")) return "MIMIC-CXR";
  if (name.includes("chest_image_manifest")) return "MIMIC-CXR";
  return "Chest X-Ray dataset";
}

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
