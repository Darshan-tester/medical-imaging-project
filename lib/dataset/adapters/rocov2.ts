import path from "path";
import { parseCsv, pickColumn, readTextFileSafe, safeExists, stableId, walk } from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { AdapterIssue, AdapterResult, DatasetAdapter, DatasetStudy, NormalizedModality, StudyReport } from "../types";
import { buildSeriesFromFiles, RASTER_EXTS, studyCode } from "./shared";

interface CaptionRow {
  key?: string;
  caption: string;
}

/**
 * Modality signals that the caption itself states in words.
 *
 * This reads the dataset's own text, it does not look at pixels and it does not
 * infer from anatomy — a caption that says "Coronal T2-weighted MR image" is the
 * source asserting MRI, which is a different thing from this code deciding an
 * image looks like an MRI.
 *
 * Order matters only for the combined-study cases handled in `modalityFromCaption`;
 * within this table the patterns are independent.
 */
const MODALITY_PATTERNS: { modality: NormalizedModality; pattern: RegExp }[] = [
  { modality: "MRI", pattern: /\bMRI?\b|magnetic resonance|\bMR (?:image|imaging|scan)|T1[- ]?weighted|T2[- ]?weighted|\bFLAIR\b|diffusion[- ]weighted|\bDWI\b|gadolinium/i },
  { modality: "CT", pattern: /\bCT\b|\bCTA\b|computed tomograph/i },
  { modality: "PET", pattern: /\bPET\b|positron emission|\bFDG\b/i },
  { modality: "Ultrasound", pattern: /ultrasound|ultrasonograph|sonograph|\bechocardiograph|doppler|apical (?:two|three|four)[- ]chamber/i },
  { modality: "X-Ray", pattern: /radiograph|x-?ray|plain film|scoutview|mammograph/i },
];

/**
 * The modality the caption explicitly claims, or undefined when the text does
 * not say — in which case the caller falls back and records the fallback rather
 * than presenting a guess as fact.
 *
 * A caption naming two different modalities is ambiguous by definition, so it
 * resolves to undefined too. The one exception is a genuinely combined
 * acquisition ("PET/CT", "PET-CT"), which is a PET study that includes a CT
 * component — that one is not ambiguous, it is named.
 */
function modalityFromCaption(caption: string): NormalizedModality | undefined {
  // Written every which way in practice: PET/CT, PET-CT, PET / CT, PET CT.
  // "PET and CT" deliberately does not match — that is two studies being
  // compared, which is genuinely ambiguous, not one combined acquisition.
  if (/\bPET\s*(?:[/\-]\s*)?CT\b/i.test(caption)) return "PET";

  const hits = MODALITY_PATTERNS.filter((m) => m.pattern.test(caption)).map((m) => m.modality);
  const distinct = [...new Set(hits)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

/**
 * ROCOv2 is published as image folders alongside CSVs mapping an image ID to
 * a caption (commonly `*_captions.csv` with `ID`/`Caption` columns, e.g. one
 * file per split — train/valid/test). This adapter reads every CSV that has
 * an ID-like and a caption-like column, and matches each image file to a
 * caption by filename stem.
 *
 * ROCOv2 spans several modalities in one folder and ships no per-image modality
 * column, so modality comes from what the caption states in words (see
 * `modalityFromCaption`). Where the caption does not say, or names more than
 * one, the study is indexed as "X-Ray" — the dataset's majority class — and the
 * count of those fallbacks is reported as a scan issue so the uncertainty is
 * visible instead of silent. Every ROCOv2 study is also badged "ROCOv2" so it is
 * never mistaken for a modality-verified source.
 *
 * Before this, every ROCOv2 study was labeled "X-Ray" unconditionally, which put
 * an "X-Ray" badge over captions that read "CT angiogram obtained on admission"
 * and "Apical four-chamber view ... severe tricuspid valve regurgitation".
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
    let unstatedModality = 0;
    for (const img of imageFiles) {
      const stem = path.basename(img, path.extname(img));
      const captionRow = matchByIdentifiers(captionLookup, [stem]);
      if (!captionRow) continue; // never expose an ROCOv2 image with no real caption as a "study"

      const stated = modalityFromCaption(captionRow.caption);
      if (!stated) unstatedModality++;
      const modality: NormalizedModality = stated ?? "X-Ray";

      const series = buildSeriesFromFiles({
        seriesId: stableId("ROCOV2", stem, "series-0"),
        label: "Image",
        modality,
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
        modality,
        series: [series],
        report,
        sourceDir: rootDir,
      });
    }

    if (unstatedModality > 0) {
      issues.push({
        dataset: "ROCOV2",
        path: rootDir,
        reason: `${unstatedModality} of ${studies.length} ROCOv2 caption(s) do not state a modality (or name more than one); those studies are indexed as X-Ray, the dataset's majority class`,
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
