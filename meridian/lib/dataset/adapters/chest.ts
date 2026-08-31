import path from "path";

import {
  parseCsv,
  pickColumn,
  readTextFileSafe,
  safeExists,
  stableId,
  walk,
} from "../fs-utils";

import {
  buildLookup,
  matchByIdentifiers,
} from "../report-matcher";

import { readDicomSummary } from "../image-render";

import {
  AdapterIssue,
  AdapterResult,
  DatasetAdapter,
  DatasetImageRef,
  DatasetSeries,
  DatasetStudy,
  StudyReport,
} from "../types";

import { naturalSort, studyCode } from "./shared";

import { parseReportSections } from "../../report-utils";

interface ReportRow {
  key?: string;
  text: string;
  raw: Record<string, string>;
}

export const chestAdapter: DatasetAdapter = {
  id: "CHEST_XRAY",

  matchesDir: ["01_CHEST_XRAY"],

  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];

    if (!safeExists(rootDir)) {
      return {
        studies: [],
        issues,
      };
    }

    /*
     * ----------------------------------------------------------
     * DISCOVER FILES
     * ----------------------------------------------------------
     */

    const candidateFiles = [...walk(rootDir)];

    const csvFiles = [
      ...walk(rootDir, {
        extensions: [".csv"],
      }),
    ];

    const jsonFiles = [
      ...walk(rootDir, {
        extensions: [".json"],
      }),
    ];

    const txtFiles = [
      ...walk(rootDir, {
        extensions: [".txt"],
      }),
    ];

    /*
     * ----------------------------------------------------------
     * LOAD REPORTS
     * ----------------------------------------------------------
     */

    const reportLookup = loadReports(
      csvFiles,
      jsonFiles,
      txtFiles,
      issues
    );

    /*
     * ----------------------------------------------------------
     * STUDY -> SERIES -> IMAGES
     * ----------------------------------------------------------
     */

    type Instance = {
      absPath: string;
      summary: ReturnType<typeof readDicomSummary>;
    };

    const studies = new Map<
      string,
      Map<string, Instance[]>
    >();

    /*
     * Study-level metadata.
     */
    const studyMeta = new Map<
      string,
      {
        accession?: string;
        bodyPart?: string;
        date?: string;
        patientId?: string;
        patientName?: string;
      }
    >();

    /*
     * ----------------------------------------------------------
     * READ DICOM FILES
     * ----------------------------------------------------------
     */

    for (const file of candidateFiles) {
      const summary = readDicomSummary(file);

      if (!summary) {
        continue;
      }

      /*
       * Chest X-ray datasets may contain DICOM files
       * with or without a .dcm extension.
       */

      const studyKey =
        summary.studyInstanceUID ||
        summary.accessionNumber ||
        path.basename(
          path.dirname(file)
        );

      const seriesKey =
        summary.seriesInstanceUID ||
        path.basename(
          path.dirname(file)
        );

      if (!studies.has(studyKey)) {
        studies.set(
          studyKey,
          new Map<string, Instance[]>()
        );
      }

      const seriesMap =
        studies.get(studyKey)!;

      if (!seriesMap.has(seriesKey)) {
        seriesMap.set(
          seriesKey,
          []
        );
      }

      seriesMap
        .get(seriesKey)!
        .push({
          absPath: file,
          summary,
        });

      /*
       * Save metadata once.
       */
      if (!studyMeta.has(studyKey)) {
        studyMeta.set(
          studyKey,
          {
            accession:
              summary.accessionNumber,

            bodyPart:
              summary.bodyPart,

            date:
              normalizeDicomDate(
                summary.studyDate
              ),

            patientId:
              getSummaryString(
                summary,
                [
                  "patientId",
                  "patientID",
                  "PatientID",
                ]
              ),

            patientName:
              getSummaryString(
                summary,
                [
                  "patientName",
                  "patientName",
                  "PatientName",
                ]
              ),
          }
        );
      }
    }

    /*
     * ----------------------------------------------------------
     * BUILD DATASET STUDIES
     * ----------------------------------------------------------
     */

    const result: DatasetStudy[] = [];

    for (const [
      studyKey,
      seriesMap,
    ] of studies) {
      const series: DatasetSeries[] = [];

      let seriesIdx = 0;

      for (const [
        seriesKey,
        instances,
      ] of seriesMap) {
        /*
         * Sort images.
         */
        instances.sort(
          (a, b) => {
            const an =
              a.summary?.instanceNumber;

            const bn =
              b.summary?.instanceNumber;

            if (
              an !== undefined &&
              bn !== undefined &&
              an !== bn
            ) {
              return an - bn;
            }

            return naturalSort(
              a.absPath,
              b.absPath
            );
          }
        );

        /*
         * Convert DICOM images.
         */
        const images: DatasetImageRef[] =
          instances.map(
            (inst, index) => ({
              id: stableId(
                seriesKey,
                String(index)
              ),

              index,

              kind: "dicom",

              absPath:
                inst.absPath,

              width:
                inst.summary?.columns,

              height:
                inst.summary?.rows,
            })
          );

        seriesIdx++;

        series.push({
          id: stableId(
            studyKey,
            seriesKey
          ),

          label:
            instances[0]?.summary
              ?.seriesDescription ||
            `Chest X-Ray ${seriesIdx}`,

          modality: "X-Ray",

          orientation: "PA",

          sliceCount:
            images.length,

          images,
        });
      }

      if (series.length === 0) {
        continue;
      }

      const meta =
        studyMeta.get(studyKey);

      /*
       * --------------------------------------------------------
       * REPORT MATCHING
       * --------------------------------------------------------
       */

      const folderStudyKey =
        getDatasetStudyKey(
          studyKey,
          seriesMap
        );

      const reportRow =
        matchByIdentifiers(
          reportLookup,
          [
            studyKey,
            meta?.accession,
            meta?.patientId,
            folderStudyKey,
          ]
        );

      /*
       * --------------------------------------------------------
       * BUILD REPORT
       * --------------------------------------------------------
       */

      const report:
        | StudyReport
        | undefined =
        reportRow
          ? buildChestReport(
              reportRow
            )
          : undefined;

      /*
       * --------------------------------------------------------
       * STABLE STUDY ID
       * --------------------------------------------------------
       */

      const id =
        stableId(
          "CHEST",
          studyKey
        );

      result.push({
        id,

        dataset: "CHEST_XRAY",

        studyCode:
          studyCode(
            "CHEST",
            studyKey
          ),

        sourceStudyId:
          studyKey,

        patientAlias:
          `Patient ${id
            .slice(0, 6)
            .toUpperCase()}`,

        modality: "X-Ray",

        bodyRegion:
          meta?.bodyPart ||
          "Chest",

        date:
          meta?.date,

        series,

        report,

        sourceDir:
          rootDir,
      });
    }

    return {
      studies: result,
      issues,
    };
  },
};

/**
 * ------------------------------------------------------------
 * REPORT BUILDER
 * ------------------------------------------------------------
 *
 * Keeps the original report untouched and also creates
 * structured sections for the Meridian UI.
 */
function buildChestReport(
  reportRow: ReportRow
): StudyReport {
  const sections =
    parseReportSections(
      reportRow.text
    );

  const clinicalInformation =
    clean(
      sections.clinicalInformation
    ) ||
    pickColumn(
      reportRow.raw,
      [
        "clinical_information",
        "clinicalinformation",
        "clinical_info",
        "clinicalhistory",
        "clinical_history",
        "history",
        "indication",
        "reason",
        "reason_for_exam",
      ]
    ) ||
    "";

  const technique =
    clean(
      sections.technique
    ) ||
    pickColumn(
      reportRow.raw,
      [
        "technique",
        "procedure",
        "protocol",
        "view",
        "views",
      ]
    ) ||
    "";

  const findings =
    clean(
      sections.findings
    ) ||
    pickColumn(
      reportRow.raw,
      [
        "findings",
        "finding",
        "observations",
        "observation",
      ]
    ) ||
    extractSection(
      reportRow.text,
      [
        "findings",
        "findings and impression",
        "observations",
      ],
      [
        "impression",
        "conclusion",
      ]
    );

  const impression =
    clean(
      sections.impression
    ) ||
    pickColumn(
      reportRow.raw,
      [
        "impression",
        "conclusion",
        "summary",
      ]
    ) ||
    extractSection(
      reportRow.text,
      [
        "impression",
        "conclusion",
        "summary",
      ],
      []
    );

  const comparison =
    clean(
      sections.comparison
    ) ||
    pickColumn(
      reportRow.raw,
      [
        "comparison",
        "prior_comparison",
        "previous_examination",
        "prior_exam",
      ]
    ) ||
    "";

  return {
    source: "Chest X-Ray",

    /*
     * Always preserve complete original report.
     */
    text:
      reportRow.text,

    clinicalInformation,

    technique,

    findings,

    impression,

    comparison,
  };
}

/**
 * ------------------------------------------------------------
 * GENERIC REPORT SECTION EXTRACTION
 * ------------------------------------------------------------
 */
function extractSection(
  text: string,
  startHeadings: string[],
  endHeadings: string[]
): string {
  if (!text?.trim()) {
    return "";
  }

  const normalized =
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  const startPattern =
    startHeadings
      .map(
        (heading) =>
          escapeRegex(heading)
      )
      .join("|");

  if (!startPattern) {
    return "";
  }

  const startRegex =
    new RegExp(
      `(?:^|\\n)\\s*(?:${startPattern})\\s*[:\\-]?\\s*\\n?`,
      "i"
    );

  const startMatch =
    normalized.match(
      startRegex
    );

  if (
    !startMatch ||
    startMatch.index === undefined
  ) {
    return "";
  }

  const start =
    startMatch.index +
    startMatch[0].length;

  const remainder =
    normalized.slice(start);

  if (endHeadings.length === 0) {
    return remainder.trim();
  }

  const endPattern =
    endHeadings
      .map(
        (heading) =>
          escapeRegex(heading)
      )
      .join("|");

  const endRegex =
    new RegExp(
      `(?:^|\\n)\\s*(?:${endPattern})\\s*[:\\-]?\\s*`,
      "i"
    );

  const endMatch =
    remainder.match(
      endRegex
    );

  if (
    endMatch &&
    endMatch.index !== undefined
  ) {
    return remainder
      .slice(
        0,
        endMatch.index
      )
      .trim();
  }

  return remainder.trim();
}

/**
 * Escape text before putting it into a RegExp.
 */
function escapeRegex(
  value: string
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/**
 * Remove surrounding whitespace only.
 * No report content is changed.
 */
function clean(
  value?: string
): string {
  return value?.trim() || "";
}

/**
 * ------------------------------------------------------------
 * DICOM DATE
 * ------------------------------------------------------------
 */
function normalizeDicomDate(
  value?: string
): string | undefined {
  if (
    !value ||
    value.length !== 8
  ) {
    return undefined;
  }

  return (
    `${value.slice(0, 4)}-` +
    `${value.slice(4, 6)}-` +
    `${value.slice(6, 8)}`
  );
}

/**
 * ------------------------------------------------------------
 * SAFE SUMMARY FIELD
 * ------------------------------------------------------------
 */
function getSummaryString(
  summary: any,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value =
      summary?.[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return undefined;
}

/**
 * ------------------------------------------------------------
 * DATASET STUDY KEY
 * ------------------------------------------------------------
 *
 * Supports common Chest X-Ray directory layouts.
 */
function getDatasetStudyKey(
  studyKey: string,
  seriesMap: Map<string, any>
): string | undefined {
  for (const instances of seriesMap.values()) {
    const first =
      instances?.[0];

    if (!first?.absPath) {
      continue;
    }

    const normalized =
      first.absPath.replace(
        /\\/g,
        "/"
      );

    /*
     * MIMIC-style study directory.
     */
    const mimicMatch =
      normalized.match(
        /\/p\d+\/([^/]+)\/?$/i
      );

    if (mimicMatch?.[1]) {
      return mimicMatch[1];
    }

    /*
     * Common Chest X-Ray study folders.
     */
    const parts =
      normalized.split("/");

    if (parts.length >= 2) {
      const parent =
        parts[parts.length - 2];

      if (
        parent &&
        !/^ST\d+$/i.test(parent) &&
        !/^SE\d+$/i.test(parent)
      ) {
        return parent;
      }
    }
  }

  return studyKey || undefined;
}

/**
 * ------------------------------------------------------------
 * REPORT LOADING
 * ------------------------------------------------------------
 */
function loadReports(
  csvFiles: string[],
  jsonFiles: string[],
  txtFiles: string[],
  issues: AdapterIssue[]
): Map<string, ReportRow> {
  const rows: ReportRow[] = [];

  /*
   * ==========================================================
   * CSV
   * ==========================================================
   */
  for (const csv of csvFiles) {
    const content =
      readTextFileSafe(csv);

    if (!content) {
      issues.push({
        dataset: "CHEST_XRAY",
        path: csv,
        reason:
          "Unreadable CSV file",
      });

      continue;
    }

    let parsed:
      Record<string, string>[];

    try {
      parsed =
        parseCsv(content);
    } catch {
      issues.push({
        dataset: "CHEST_XRAY",
        path: csv,
        reason:
          "Malformed CSV",
      });

      continue;
    }

    for (const row of parsed) {
      const key =
        pickColumn(
          row,
          [
            "studyinstanceuid",
            "study_instance_uid",
            "study_id",
            "studyid",
            "accession",
            "accession_number",
            "subject_id",
            "subjectid",
            "patient_id",
            "patientid",
            "id",
            "image_id",
          ]
        );

      const text =
        pickColumn(
          row,
          [
            "report",
            "report_text",
            "reports",
            "findings",
            "impression",
            "text",
            "narrative",
            "reporttext",
          ]
        );

      if (key && text) {
        rows.push({
          key,
          text,
          raw: row,
        });
      }
    }
  }

  /*
   * ==========================================================
   * JSON
   * ==========================================================
   */
  for (const jsonFile of jsonFiles) {
    const content =
      readTextFileSafe(
        jsonFile
      );

    if (!content) {
      continue;
    }

    try {
      const data =
        JSON.parse(content);

      const entries =
        Array.isArray(data)
          ? data
          : Object.values(data);

      for (const entry of entries as any[]) {
        if (
          !entry ||
          typeof entry !== "object"
        ) {
          continue;
        }

        const key =
          entry.StudyInstanceUID ??
          entry.studyInstanceUID ??
          entry.study_instance_uid ??
          entry.accession_number ??
          entry.accession ??
          entry.study_id ??
          entry.studyId ??
          entry.subject_id ??
          entry.subjectId ??
          entry.patient_id ??
          entry.patientId ??
          entry.id;

        const text =
          entry.report ??
          entry.report_text ??
          entry.reportText ??
          entry.findings ??
          entry.impression ??
          entry.text ??
          entry.narrative;

        if (key && text) {
          rows.push({
            key: String(key),
            text: String(text),
            raw: entry,
          });
        }
      }
    } catch {
      issues.push({
        dataset: "CHEST_XRAY",
        path: jsonFile,
        reason:
          "Malformed JSON",
      });
    }
  }

  /*
   * ==========================================================
   * TXT
   * ==========================================================
   */
  for (const txtFile of txtFiles) {
    const content =
      readTextFileSafe(
        txtFile
      );

    if (!content?.trim()) {
      continue;
    }

    const key =
      getTxtStudyKey(
        txtFile
      );

    if (!key) {
      continue;
    }

    rows.push({
      key,

      text:
        content.trim(),

      raw: {
        sourceFile:
          txtFile,
      },
    });
  }

  return buildLookup(
    rows,
    (row) => row.key
  );
}

/**
 * ------------------------------------------------------------
 * TXT STUDY KEY
 * ------------------------------------------------------------
 */
function getTxtStudyKey(
  txtFile: string
): string | undefined {
  const normalized =
    txtFile.replace(
      /\\/g,
      "/"
    );

  /*
   * Look for common study folder names.
   */
  const parts =
    normalized.split("/");

  /*
   * Prefer the directory immediately above
   * the TXT file.
   */
  if (parts.length >= 2) {
    const parent =
      parts[parts.length - 2];

    if (
      parent &&
      parent !== "." &&
      parent !== ".."
    ) {
      return parent;
    }
  }

  /*
   * Fall back to filename without extension.
   */
  const filename =
    path.basename(
      txtFile,
      path.extname(txtFile)
    );

  return filename || undefined;
}
