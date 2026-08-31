import path from "path";
import {
  parseCsv,
  pickColumn,
  readTextFileSafe,
  safeExists,
  stableId,
  walk,
} from "../fs-utils";
import { buildLookup, matchByIdentifiers } from "../report-matcher";
import {
  readDicomSummary,
  readNiftiSummary,
} from "../image-render";
import {
  AdapterIssue,
  AdapterResult,
  DatasetAdapter,
  DatasetImageRef,
  DatasetSeries,
  DatasetStudy,
} from "../types";
import { naturalSort, studyCode } from "./shared";

interface ReportRow {
  key?: string;
  text: string;
}

/**
 * PET adapter
 *
 * Supports:
 * 1. DICOM PET series
 * 2. Standalone NIfTI PET volumes
 * 3. PETWB-REP report_en.csv
 *
 * PETWB-REP report_en.csv uses:
 *   Image ID
 *   Image description
 *   Report Diagnosis
 *
 * Example:
 *
 * Image ID:
 *   983777-000001
 *
 * NIfTI:
 *   sub-983777-000001_ses-01_desc-pet_suv.nii.gz
 *
 * Therefore the NIfTI filename is converted back to:
 *   983777-000001
 *
 * and matched against "Image ID".
 *
 * This adapter intentionally does NOT calculate SUV.
 */
export const petAdapter: DatasetAdapter = {
  id: "PET",

  matchesDir: ["06_PET"],

  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];

    if (!safeExists(rootDir)) {
      return {
        studies: [],
        issues,
      };
    }

    // Find all CSV files under the PET dataset.
    const csvFiles = [...walk(rootDir, { extensions: [".csv"] })];

    // Load PET reports.
    const reportLookup = loadReports(csvFiles, issues);

    const studies: DatasetStudy[] = [];

    // Scan DICOM PET studies.
    studies.push(
      ...scanDicom(rootDir, reportLookup, issues)
    );

    // Scan NIfTI PET volumes.
    studies.push(
      ...scanNifti(rootDir, reportLookup, issues)
    );

    return {
      studies,
      issues,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* DICOM                                                                       */
/* -------------------------------------------------------------------------- */

function scanDicom(
  rootDir: string,
  reportLookup: Map<string, ReportRow>,
  issues: AdapterIssue[]
): DatasetStudy[] {
  const dcmFiles = [
    ...walk(rootDir, {
      extensions: [".dcm"],
    }),
  ];

  type Instance = {
    absPath: string;
    summary: ReturnType<typeof readDicomSummary>;
  };

  const studies = new Map<string, Map<string, Instance[]>>();

  const meta = new Map<
    string,
    {
      accession?: string;
      bodyPart?: string;
    }
  >();

  for (const file of dcmFiles) {
    const summary = readDicomSummary(file);

    if (!summary) {
      issues.push({
        dataset: "PET",
        path: file,
        reason: "Could not parse DICOM header",
      });

      continue;
    }

    const studyKey =
      summary.studyInstanceUID ||
      path.basename(
        path.dirname(
          path.dirname(file)
        )
      );

    const seriesKey =
      summary.seriesInstanceUID ||
      path.basename(
        path.dirname(file)
      );

    if (!studies.has(studyKey)) {
      studies.set(
        studyKey,
        new Map()
      );
    }

    const seriesMap = studies.get(studyKey)!;

    if (!seriesMap.has(seriesKey)) {
      seriesMap.set(seriesKey, []);
    }

    seriesMap.get(seriesKey)!.push({
      absPath: file,
      summary,
    });

    if (!meta.has(studyKey)) {
      meta.set(studyKey, {
        accession: summary.accessionNumber,
        bodyPart: summary.bodyPart,
      });
    }
  }

  const result: DatasetStudy[] = [];

  for (const [studyKey, seriesMap] of studies) {
    const series: DatasetSeries[] = [];

    let idx = 0;

    for (const [, instances] of seriesMap) {
      instances.sort((a, b) => {
        const an =
          a.summary?.instanceNumber ?? 0;

        const bn =
          b.summary?.instanceNumber ?? 0;

        return an !== bn
          ? an - bn
          : naturalSort(
              a.absPath,
              b.absPath
            );
      });

      idx++;

      const images: DatasetImageRef[] =
        instances.map((inst, i) => ({
          id: stableId(
            studyKey,
            String(idx),
            String(i)
          ),

          index: i,

          kind: "dicom",

          absPath: inst.absPath,

          width:
            inst.summary?.columns,

          height:
            inst.summary?.rows,
        }));

      series.push({
        id: stableId(
          studyKey,
          String(idx)
        ),

        label: `Series ${idx}`,

        modality: "PET",

        orientation: "Axial",

        sliceCount: images.length,

        images,
      });
    }

    if (series.length === 0) {
      continue;
    }

    const m = meta.get(studyKey);

    const reportRow =
      matchByIdentifiers(
        reportLookup,
        [
          studyKey,
          m?.accession,
        ]
      );

    const id = stableId(
      "PET",
      studyKey
    );

    result.push({
      id,

      dataset: "PET",

      studyCode: studyCode(
        "PET",
        studyKey
      ),

      sourceStudyId: studyKey,

      patientAlias:
        `Patient ${id
          .slice(0, 6)
          .toUpperCase()}`,

      modality: "PET",

      bodyRegion:
        m?.bodyPart,

      series,

      report: reportRow
        ? {
            source: "PETWB-REP",
            text: reportRow.text,
          }
        : undefined,

      sourceDir: rootDir,
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* NIFTI                                                                       */
/* -------------------------------------------------------------------------- */

function scanNifti(
  rootDir: string,
  reportLookup: Map<string, ReportRow>,
  issues: AdapterIssue[]
): DatasetStudy[] {
  const niftiFiles = [
    ...walk(rootDir),
  ].filter(
    (f) =>
      f.toLowerCase().endsWith(".nii") ||
      f.toLowerCase().endsWith(".nii.gz")
  );

  const result: DatasetStudy[] = [];

  for (const file of niftiFiles) {
    /*
     * Example:
     *
     * sub-983777-000001_ses-01_desc-pet_suv.nii.gz
     *
     * stem becomes:
     *
     * sub-983777-000001_ses-01_desc-pet_suv
     */
    const stem = path
      .basename(file)
      .replace(
        /\.nii(\.gz)?$/i,
        ""
      );

    const summary =
      readNiftiSummary(file);

    if (!summary) {
      issues.push({
        dataset: "PET",
        path: file,
        reason:
          "Could not read NIfTI header (invalid or corrupt file)",
      });

      continue;
    }

    /*
     * IMPORTANT:
     *
     * PETWB-REP report_en.csv uses:
     *
     * Image ID = 983777-000001
     *
     * while the NIfTI filename contains:
     *
     * sub-983777-000001_ses-01_desc-pet_suv
     *
     * Extract the Image ID from the NIfTI filename.
     */
    const imageId =
      extractPetImageId(stem);

    /*
     * Real slice count from NIfTI header.
     */
    const nz =
      summary.dims[2] || 1;

    const images: DatasetImageRef[] =
      Array.from(
        { length: nz },
        (_, i) => ({
          id: stableId(
            "PET",
            stem,
            String(i)
          ),

          index: i,

          kind: "nifti",

          absPath: file,

          frameIndex: i,

          width:
            summary.dims[0],

          height:
            summary.dims[1],
        })
      );

    const series: DatasetSeries = {
      id: stableId(
        "PET",
        stem,
        "series"
      ),

      label: "Axial",

      modality: "PET",

      orientation: "Axial",

      sliceCount:
        images.length,

      images,
    };

    /*
     * Match using multiple identifiers.
     *
     * Primary:
     *   983777-000001
     *
     * Secondary:
     *   sub-983777-000001_ses-01_desc-pet_suv
     */
    const reportRow =
      matchByIdentifiers(
        reportLookup,
        [
          imageId,
          stem,
        ].filter(
          (value): value is string =>
            Boolean(value)
        )
      );

    const id = stableId(
      "PET",
      "nifti",
      stem
    );

    result.push({
      id,

      dataset: "PET",

      studyCode: studyCode(
        "PET",
        imageId || stem
      ),

      sourceStudyId:
        imageId || stem,

      patientAlias:
        `Patient ${id
          .slice(0, 6)
          .toUpperCase()}`,

      modality: "PET",

      series: [series],

      report: reportRow
        ? {
            source: "PETWB-REP",
            text: reportRow.text,
          }
        : undefined,

      sourceDir: rootDir,
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* PET IMAGE ID EXTRACTION                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Convert PETWB-REP NIfTI filename to the Image ID used by report_en.csv.
 *
 * Input:
 *   sub-983777-000001_ses-01_desc-pet_suv
 *
 * Output:
 *   983777-000001
 *
 * Also handles:
 *   sub-983777-000001
 */
function extractPetImageId(
  stem: string
): string | undefined {
  const match =
    stem.match(
      /^sub-(.+?)(?:_ses-|$)/i
    );

  if (match?.[1]) {
    return match[1];
  }

  /*
   * Fallback:
   *
   * If the filename does not follow the expected
   * BIDS-style "sub-..._ses-..." format, return
   * the stem itself so the matcher can still try it.
   */
  return stem || undefined;
}

/* -------------------------------------------------------------------------- */
/* REPORT LOADING                                                              */
/* -------------------------------------------------------------------------- */

function loadReports(
  csvFiles: string[],
  issues: AdapterIssue[]
): Map<string, ReportRow> {
  const rows: ReportRow[] = [];

  for (const csv of csvFiles) {
    const content =
      readTextFileSafe(csv);

    if (!content) {
      issues.push({
        dataset: "PET",
        path: csv,
        reason: "Unreadable CSV file",
      });

      continue;
    }

    let parsed: Record<
      string,
      string
    >[];

    try {
      parsed = parseCsv(content);
    } catch {
      issues.push({
        dataset: "PET",
        path: csv,
        reason: "Malformed CSV",
      });

      continue;
    }

    for (const row of parsed) {
      /*
       * PETWB-REP report_en.csv:
       *
       * Image ID
       * Image description
       * Report Diagnosis
       *
       * The previous adapter did NOT include these
       * column names, which caused all PET reports
       * to be ignored.
       */

      const key =
        pickColumn(
          row,
          [
            "Image ID",
            "image id",
            "Image_ID",
            "image_id",

            "study_id",
            "accession",
            "accession_number",
            "id",
            "filename",
          ]
        );

      /*
       * Prefer the actual radiology diagnosis/report.
       */
      const text =
        pickColumn(
          row,
          [
            "Report Diagnosis",
            "report diagnosis",
            "Report_Diagnosis",
            "report_diagnosis",

            "report",
            "findings",
            "impression",
            "text",
          ]
        );

      if (
        key &&
        text
      ) {
        rows.push({
          key: key.trim(),
          text: text.trim(),
        });
      }
    }
  }

  return buildLookup(
    rows,
    (r) => r.key
  );
}