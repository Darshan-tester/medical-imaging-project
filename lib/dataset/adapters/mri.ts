import path from "path";
import fs from "fs";

import {
  parseCsv,
  pickColumn,
  readTextFileSafe,
  safeExists,
  stableId,
  walk,
} from "../fs-utils";

import { buildLookup, matchByIdentifiers } from "../report-matcher";
import { ensureExtracted } from "../zip-cache";
import { readDicomSummary } from "../image-render";

import { parseReportSections } from "../../report-utils";
import {
  AdapterIssue,
  AdapterResult,
  DatasetAdapter,
  DatasetSeries,
  DatasetStudy,
  StudyReport,
} from "../types";

import {
  buildNiftiVolumeSeries,
  buildSeriesFromFiles,
  DICOM_EXTS,
  NIFTI_EXTS,
  naturalSort,
  RASTER_EXTS,
  studyCode,
} from "./shared";

interface MetaRow {
  key?: string;
  age?: number;
  sex?: "M" | "F" | "Other";
  bodyRegion?: string;
  date?: string;
  raw: Record<string, string>;
}

interface ReportRow {
  key?: string;
  text: string;
}

/**
 * ============================================================================
 * MRI DATASET ADAPTER
 * ============================================================================
 *
 * Supported:
 *
 *   MR-RATE:
 *     - ZIP -> NIfTI volumes
 *     - .nii
 *     - .nii.gz
 *
 *   Generic MRI:
 *     - DICOM
 *     - NIfTI
 *     - PNG/JPG/WEBP
 *
 * Important:
 *
 * Do NOT rely only on path.extname() for NIfTI.
 *
 * path.extname("volume.nii.gz") === ".gz"
 *
 * Therefore we explicitly check:
 *
 *   .nii
 *   .nii.gz
 *
 * using endsWith().
 * ============================================================================
 */

const MRI_IMAGE_EXTENSIONS = [
  ...DICOM_EXTS,
  ...RASTER_EXTS,
  ".nii",
  ".nii.gz",
];

const IGNORED_DIR_NAMES = new Set([
  "_inspection",
  "_scripts",
  "_cache",
  "inspection",
  "metadata",
  "reports",
  "splits",
  "seg",
  "masks",
  "mask",
]);

/**
 * Directories pruned from the image walk entirely.
 *
 * These hold derived volumes, not acquisitions: a segmentation label map or a
 * defacing mask is a real .nii.gz with a real affine, so nothing downstream
 * would reject it — it would be indexed as an MRI series and reconstructed into
 * three planes, putting a mask on screen labelled as anatomy.
 *
 * Narrower than `IGNORED_DIR_NAMES`, which decides whether a directory counts
 * as a loose *study*; a folder can be a legitimate study and still not be one
 * whose pixels should be shown.
 */
const PRUNED_DIR_NAMES = new Set(["seg", "mask", "masks", "defacing"]);

/**
 * True when a file is a supported MRI display file.
 *
 * This deliberately uses endsWith() instead of path.extname()
 * so .nii.gz works correctly.
 */
function isSupportedMRIImage(file: string): boolean {
  const lower = file.toLowerCase();

  return MRI_IMAGE_EXTENSIONS.some((ext) =>
    lower.endsWith(ext.toLowerCase())
  );
}

/**
 * Returns all supported MRI image files recursively.
 *
 * We intentionally do not depend on walk(... extensions)
 * because .nii.gz can be incorrectly interpreted as .gz.
 */
function findMRIImageFiles(dir: string): string[] {
  const results: string[] = [];

  function visit(currentDir: string) {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(currentDir, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (PRUNED_DIR_NAMES.has(entry.name.toLowerCase())) continue;

        visit(fullPath);
        continue;
      }

      if (entry.isFile() && isSupportedMRIImage(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  visit(dir);

  return results.sort(naturalSort);
}

/**
 * Determine whether a directory should be treated as a loose MRI study.
 */
function isValidLooseStudyDir(dir: string): boolean {
  const name = path.basename(dir).toLowerCase();

  if (IGNORED_DIR_NAMES.has(name)) {
    return false;
  }

  if (name.startsWith(".")) {
    return false;
  }

  return true;
}

/**
 * ============================================================================
 * ADAPTER
 * ============================================================================
 */

export const mriAdapter: DatasetAdapter = {
  id: "MRI",

  matchesDir: ["03_MRI"],

  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];

    if (!safeExists(rootDir)) {
      return {
        studies: [],
        issues,
      };
    }

    // ------------------------------------------------------------------------
    // Load metadata and reports
    // ------------------------------------------------------------------------

    const csvFiles = [...walk(rootDir, { extensions: [".csv"] })];

    const { metaLookup, reportLookup } = loadTables(
      csvFiles,
      issues
    );

    // ------------------------------------------------------------------------
    // MR-RATE ZIP files
    // ------------------------------------------------------------------------

    const zipFiles = [...walk(rootDir, { extensions: [".zip"] })]
      .filter((file) => {
        const lower = file.toLowerCase();

        // Ignore ZIPs from unrelated cache/backup folders if any.
        return !lower.includes(`${path.sep}cache${path.sep}zips${path.sep}`);
      })
      .sort(naturalSort);

    const studies: DatasetStudy[] = [];

    for (const zip of zipFiles) {
      const stem = path.basename(
        zip,
        path.extname(zip)
      );

      let extractedDir: string;

      try {
        extractedDir = ensureExtracted(zip);
      } catch (err) {
        issues.push({
          dataset: "MRI",
          path: zip,
          reason:
            `Failed to extract ZIP: ${
              err instanceof Error
                ? err.message
                : String(err)
            }`,
        });

        continue;
      }

      // --------------------------------------------------------------
      // IMPORTANT:
      //
      // Search manually for .nii.gz.
      //
      // This fixes the primary MRI problem.
      // --------------------------------------------------------------

      const imageFiles = findMRIImageFiles(
        extractedDir
      );

      if (imageFiles.length === 0) {
        issues.push({
          dataset: "MRI",
          path: extractedDir,
          reason:
            "ZIP extracted successfully but no supported MRI image files were found. Checked .nii, .nii.gz, .dcm, .png, .jpg, .jpeg and .webp.",
        });

        continue;
      }

      const study = buildStudyFromDir(
        extractedDir,
        stem,
        metaLookup,
        reportLookup,
        rootDir,
        issues
      );

      if (study) {
        studies.push(study);
      }
    }

    // ------------------------------------------------------------------------
    // Loose MRI study directories
    // ------------------------------------------------------------------------

    const topLevelDirs = safeListStudyDirs(rootDir);

    for (const dir of topLevelDirs) {
      if (!isValidLooseStudyDir(dir)) {
        continue;
      }

      const imageFiles = findMRIImageFiles(dir);

      if (imageFiles.length === 0) {
        continue;
      }

      const stem = path.basename(dir);

      const study = buildStudyFromDir(
        dir,
        stem,
        metaLookup,
        reportLookup,
        rootDir,
        issues
      );

      if (study) {
        studies.push(study);
      }
    }

    // ------------------------------------------------------------------------
    // Deduplicate studies
    // ------------------------------------------------------------------------

    const uniqueStudies = new Map<string, DatasetStudy>();

    for (const study of studies) {
      if (!uniqueStudies.has(study.id)) {
        uniqueStudies.set(study.id, study);
      }
    }

    return {
      studies: [...uniqueStudies.values()],
      issues,
    };
  },
};

/**
 * ============================================================================
 * TOP-LEVEL DIRECTORY DISCOVERY
 * ============================================================================
 */

function safeListStudyDirs(
  rootDir: string
): string[] {
  try {
    return fs
      .readdirSync(rootDir, {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(rootDir, entry.name)
      );
  } catch {
    return [];
  }
}

/**
 * ============================================================================
 * BUILD STUDY
 * ============================================================================
 */

function buildStudyFromDir(
  dir: string,
  idHint: string,
  metaLookup: Map<string, MetaRow>,
  reportLookup: Map<string, ReportRow>,
  rootDir: string,
  issues: AdapterIssue[]
): DatasetStudy | undefined {
  // --------------------------------------------------------------------------
  // Find image files first.
  //
  // This is the critical change.
  // --------------------------------------------------------------------------

  const allImageFiles = findMRIImageFiles(dir);

  if (allImageFiles.length === 0) {
    issues.push({
      dataset: "MRI",
      path: dir,
      reason:
        "No supported MRI image files found. Expected .nii/.nii.gz, .dcm, .png, .jpg, .jpeg or .webp.",
    });

    return undefined;
  }

  // --------------------------------------------------------------------------
  // Identify actual series directories.
  //
  // MR-RATE commonly has:
  //
  //   img/
  //   seg/
  //
  // We use img as primary imaging and ignore seg.
  // --------------------------------------------------------------------------

  const candidateSeriesDirs = findSeriesDirectories(
    dir,
    allImageFiles
  );

  const series: DatasetSeries[] = [];

  for (
    let i = 0;
    i < candidateSeriesDirs.length;
    i++
  ) {
    const seriesDir = candidateSeriesDirs[i];

    const files = findMRIImageFiles(
      seriesDir
    );

    if (files.length === 0) {
      continue;
    }

    const lowerSeriesPath =
      seriesDir.toLowerCase();

    // --------------------------------------------------------------
    // Never expose segmentation/mask data as primary MRI series.
    // --------------------------------------------------------------

    if (
      lowerSeriesPath.includes(
        `${path.sep}seg${path.sep}`
      ) ||
      lowerSeriesPath.endsWith(
        `${path.sep}seg`
      ) ||
      lowerSeriesPath.includes(
        `${path.sep}mask${path.sep}`
      ) ||
      lowerSeriesPath.includes(
        `${path.sep}masks${path.sep}`
      )
    ) {
      continue;
    }

    const seriesName =
      path.basename(seriesDir);

    series.push(
      ...buildMriSeriesForFiles({
        files,
        seriesIdSeed: stableId(
          "MRI",
          idHint,
          seriesName,
          String(i)
        ),
        fallbackLabel:
          seriesName ===
          path.basename(dir)
            ? `Series ${i + 1}`
            : seriesName,
        idHint,
        issues,
      })
    );
  }

  // --------------------------------------------------------------------------
  // Safety fallback:
  //
  // If the directory itself contains NIfTI files and no child series was
  // detected, create one series from the entire directory.
  // --------------------------------------------------------------------------

  if (series.length === 0) {
    const directFiles =
      allImageFiles.filter(
        (file) =>
          path.dirname(file) === dir
      );

    if (directFiles.length > 0) {
      series.push(
        ...buildMriSeriesForFiles({
          files: directFiles,
          seriesIdSeed: stableId(
            "MRI",
            idHint,
            "main"
          ),
          fallbackLabel: "MRI",
          idHint,
          issues,
        })
      );
    }
  }

  // --------------------------------------------------------------------------
  // No usable series
  // --------------------------------------------------------------------------

  if (series.length === 0) {
    issues.push({
      dataset: "MRI",
      path: dir,
      reason:
        "MRI image files were found but no primary displayable series could be constructed.",
    });

    return undefined;
  }

  // --------------------------------------------------------------------------
  // Metadata
  // --------------------------------------------------------------------------

  const meta = matchByIdentifiers(
    metaLookup,
    buildIdentifierCandidates(
      idHint,
      dir
    )
  );

  // --------------------------------------------------------------------------
  // Report
  // --------------------------------------------------------------------------

  const reportRow =
    matchByIdentifiers(
      reportLookup,
      buildIdentifierCandidates(
        idHint,
        dir
      )
    );

  const report: StudyReport | undefined =
    reportRow
      ? (() => {
          const sections =
            parseReportSections(reportRow.text);

          return {
            source: "MR-RATE",

            // Preserve the complete original report verbatim.
            text: reportRow.text,

            // Structured report sections.
            clinicalInformation:
              sections.clinicalInformation,

            technique:
              sections.technique,

            findings:
              sections.findings,

            impression:
              sections.impression,

            comparison:
              sections.comparison,
          };
        })()
      : undefined;

  // --------------------------------------------------------------------------
  // Stable study ID
  // --------------------------------------------------------------------------

  const id = stableId(
    "MRI",
    idHint
  );

  return {
    id,

    dataset: "MRI",

    studyCode: studyCode(
      "MRI",
      idHint
    ),

    sourceStudyId: idHint,

    patientAlias:
      `Patient ${id
        .slice(0, 6)
        .toUpperCase()}`,

    age: meta?.age,

    sex: meta?.sex,

    modality: "MRI",

    bodyRegion: meta?.bodyRegion,

    date: meta?.date,

    series,

    report,

    sourceDir: rootDir,
  };
}

/**
 * ============================================================================
 * SERIES CONSTRUCTION
 * ============================================================================
 *
 * A directory of MRI files is not homogeneous: MR-RATE ships several whole
 * NIfTI volumes side by side in `img/`, while other MRI sources ship a flat
 * stack of DICOM instances or rasters.
 *
 * These two cases are fundamentally different and must not be merged:
 *
 *   NIfTI volume  -> ONE file that already contains every slice. It is walked
 *                    three times, once per anatomical plane, using the axis
 *                    mapping in its own affine (see buildNiftiVolumeSeries).
 *                    This is what previously collapsed to a single image:
 *                    one file became one DatasetImageRef, so only slice 0 of
 *                    the volume was ever reachable.
 *
 *   DICOM/raster  -> MANY files that together form one plane. Unchanged
 *                    behaviour: one file per slice, orientation from the DICOM
 *                    header when present, filename otherwise.
 */
function buildMriSeriesForFiles(opts: {
  files: string[];
  seriesIdSeed: string;
  fallbackLabel: string;
  idHint: string;
  issues: AdapterIssue[];
}): DatasetSeries[] {
  const volumeFiles = opts.files.filter(isNiftiFile);
  const flatFiles = opts.files.filter((file) => !isNiftiFile(file));

  const out: DatasetSeries[] = [];

  volumeFiles.forEach((absPath, vi) => {
    const built = buildNiftiVolumeSeries({
      seriesIdSeed: stableId(opts.seriesIdSeed, "vol", String(vi)),
      label: niftiVolumeLabel(absPath, opts.idHint) ?? opts.fallbackLabel,
      modality: "MRI",
      absPath,
    });

    if (built.length === 0) {
      opts.issues.push({
        dataset: "MRI",
        path: absPath,
        reason:
          "NIfTI file could not be read as a volume (unreadable or corrupt header), so no plane could be reconstructed from it.",
      });

      return;
    }

    out.push(...built);
  });

  if (flatFiles.length > 0) {
    out.push(
      buildSeriesFromFiles({
        seriesId: stableId(opts.seriesIdSeed, "flat"),
        label: opts.fallbackLabel,
        modality: "MRI",
        orientation: flatOrientation(flatFiles),
        files: flatFiles,
      })
    );
  }

  return out;
}

function isNiftiFile(file: string): boolean {
  const lower = file.toLowerCase();
  return NIFTI_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Orientation for a stack of 2D files (DICOM/raster only).
 * DICOM ImageOrientationPatient wins; filename is the fallback.
 */
function flatOrientation(files: string[]): DatasetSeries["orientation"] {
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".dcm")) continue;
    try {
      const summary = readDicomSummary(file);
      if (summary?.orientation) {
        return summary.orientation as DatasetSeries["orientation"];
      }
    } catch {
      // Fall through to filename inference.
    }
    break;
  }
  return inferOrientation(files);
}

/**
 * Human label for one NIfTI volume, derived from its filename.
 *
 *   22U54Q6WWA_t2w-raw-cor.nii.gz -> "T2W"
 *   22U54Q6WWA_t1w-raw-axi-2.nii.gz -> "T1W 2"
 *
 * The acquisition-plane token is dropped on purpose: the plane shown in the
 * series label comes from the volume's affine, not from its filename, so
 * carrying the filename's guess as well would be redundant and could contradict
 * the geometry. Returns undefined when nothing meaningful survives.
 */
function niftiVolumeLabel(absPath: string, idHint: string): string | undefined {
  const stem = path.basename(absPath).replace(/\.nii(\.gz)?$/i, "");

  const dropped = new Set([
    "raw",
    "axi",
    "axial",
    "cor",
    "coronal",
    "sag",
    "sagittal",
    idHint.toLowerCase(),
  ]);

  const tokens = stem
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !dropped.has(t.toLowerCase()));

  if (tokens.length === 0) return undefined;

  return tokens
    .map((t) => (t.length <= 5 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(" ");
}

/**
 * ============================================================================
 * FIND SERIES DIRECTORIES
 * ============================================================================
 *
 * If the extracted ZIP contains:
 *
 *   img/
 *   seg/
 *
 * return img.
 *
 * If it contains:
 *
 *   t1/
 *   t2/
 *   flair/
 *
 * return those directories.
 *
 * If images are directly inside the root, return root.
 * ============================================================================
 */

function findSeriesDirectories(
  studyDir: string,
  imageFiles: string[]
): string[] {
  const directChildDirs: string[] = [];

  try {
    const entries =
      fs.readdirSync(studyDir, {
        withFileTypes: true,
      });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const name =
        entry.name.toLowerCase();

      if (
        name === "seg" ||
        name === "mask" ||
        name === "masks" ||
        name === "defacing"
      ) {
        continue;
      }

      directChildDirs.push(
        path.join(
          studyDir,
          entry.name
        )
      );
    }
  } catch {
    return [studyDir];
  }

  // Direct image files -> study root is itself a series.
  const directImages =
    imageFiles.filter(
      (file) =>
        path.dirname(file) === studyDir
    );

  if (
    directImages.length > 0 &&
    directChildDirs.length === 0
  ) {
    return [studyDir];
  }

  // If child directories exist, use them.
  if (directChildDirs.length > 0) {
    return directChildDirs;
  }

  return [studyDir];
}

/**
 * ============================================================================
 * ORIENTATION INFERENCE
 * ============================================================================
 */

function inferOrientation(
  files: string[]
): DatasetSeries["orientation"] {
  for (const file of files) {
    const name =
      path.basename(file).toLowerCase();

    if (
      name.includes("-axi") ||
      name.includes("_axi") ||
      name.includes("axial")
    ) {
      return "Axial";
    }

    if (
      name.includes("-cor") ||
      name.includes("_cor") ||
      name.includes("coronal")
    ) {
      return "Coronal";
    }

    if (
      name.includes("-sag") ||
      name.includes("_sag") ||
      name.includes("sagittal")
    ) {
      return "Sagittal";
    }
  }

  return "Axial";
}

/**
 * ============================================================================
 * IDENTIFIER CANDIDATES
 * ============================================================================
 */

function buildIdentifierCandidates(
  idHint: string,
  dir: string
): string[] {
  const candidates = new Set<string>();

  const add = (value?: string) => {
    if (!value) return;

    const clean =
      value.trim();

    if (!clean) return;

    candidates.add(clean);
    candidates.add(clean.toLowerCase());
    candidates.add(clean.toUpperCase());
  };

  add(idHint);
  add(path.basename(dir));

  // Remove common filename suffixes.
  const withoutZip =
    idHint.replace(
      /\.zip$/i,
      ""
    );

  add(withoutZip);

  return [...candidates];
}

/**
 * ============================================================================
 * CSV LOADING
 * ============================================================================
 */

function loadTables(
  csvFiles: string[],
  issues: AdapterIssue[]
) {
  const metaRows: MetaRow[] = [];

  const reportRows: ReportRow[] = [];

  for (const csv of csvFiles) {
    const content =
      readTextFileSafe(csv);

    if (!content) {
      issues.push({
        dataset: "MRI",
        path: csv,
        reason: "Unreadable CSV file",
      });

      continue;
    }

    let parsed:
      Record<string, string>[];

    try {
      parsed = parseCsv(content);
    } catch {
      issues.push({
        dataset: "MRI",
        path: csv,
        reason: "Malformed CSV",
      });

      continue;
    }

    if (parsed.length === 0) {
      continue;
    }

    const looksLikeReports =
      !!pickColumn(
        parsed[0],
        [
          "report",
          "findings",
          "impression",
          "text",
        ]
      );

    for (const row of parsed) {
      // --------------------------------------------------------------
      // MR-RATE identifiers
      // --------------------------------------------------------------

      const key =
        pickColumn(
          row,
          [
            "study_uid",
            "study_id",
            "studyid",
            "case_id",
            "caseid",
            "batch_id",
            "id",
            "filename",
            "file_name",
            "zip",
            "zip_name",
            "accession",
            "accession_number",
          ]
        );

      if (looksLikeReports) {
        const text =
          pickColumn(
            row,
            [
              "report",
              "findings",
              "impression",
              "text",
              "caption",
              "description",
            ]
          );

        if (
          key &&
          text
        ) {
          reportRows.push({
            key: key.trim(),
            text: text.trim(),
          });
        }

        continue;
      }

      // --------------------------------------------------------------
      // Metadata
      // --------------------------------------------------------------

      const ageStr =
        pickColumn(
          row,
          [
            "age",
            "patient_age",
          ]
        );

      const sexStr =
        pickColumn(
          row,
          [
            "sex",
            "gender",
          ]
        );

      const normalizedSex =
        sexStr?.trim().toUpperCase();

      let sex:
        | "M"
        | "F"
        | "Other"
        | undefined;

      if (
        normalizedSex?.startsWith("M")
      ) {
        sex = "M";
      } else if (
        normalizedSex?.startsWith("F")
      ) {
        sex = "F";
      } else if (
        normalizedSex
      ) {
        sex = "Other";
      }

      let age:
        | number
        | undefined;

      if (ageStr) {
        const parsedAge =
          Number.parseInt(
            ageStr,
            10
          );

        if (
          Number.isFinite(
            parsedAge
          )
        ) {
          age = parsedAge;
        }
      }

      metaRows.push({
        key: key?.trim(),

        age,

        sex,

        bodyRegion:
          pickColumn(
            row,
            [
              "body_region",
              "region",
              "anatomy",
              "bodypart",
              "body_part",
            ]
          )?.trim(),

        date:
          pickColumn(
            row,
            [
              "date",
              "study_date",
              "exam_date",
              "anon_study_date",
            ]
          )?.trim(),

        raw: row,
      });
    }
  }

  return {
    metaLookup:
      buildLookup(
        metaRows,
        (row) => row.key
      ),

    reportLookup:
      buildLookup(
        reportRows,
        (row) => row.key
      ),
  };
}


