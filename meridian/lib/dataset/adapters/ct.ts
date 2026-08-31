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

export const ctAdapter: DatasetAdapter = {
  id: "CT",

  matchesDir: ["02_CT"],

  async scan(rootDir): Promise<AdapterResult> {
    const issues: AdapterIssue[] = [];

    if (!safeExists(rootDir)) {
      return {
        studies: [],
        issues,
      };
    }

    /*
     * Perle CT contains DICOM files with NO .dcm extension.
     */
    const candidateFiles = [...walk(rootDir)];

    /*
     * Load CSV reports.
     */
    const csvFiles = [
      ...walk(rootDir, {
        extensions: [".csv"],
      }),
    ];

    /*
     * Load JSON reports.
     */
    const jsonFiles = [
      ...walk(rootDir, {
        extensions: [".json"],
      }),
    ];

    /*
     * Load TXT reports.
     */
    const txtFiles = [
      ...walk(rootDir, {
        extensions: [".txt"],
      }),
    ];

    /*
     * Build report lookup.
     */
    const reportLookup = loadReports(
      csvFiles,
      jsonFiles,
      txtFiles,
      issues
    );

    /*
     * studyKey -> seriesKey -> DICOM instances
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
      }
    >();

    /*
     * Read every candidate file.
     */
    for (const file of candidateFiles) {
      const summary = readDicomSummary(file);

      if (!summary) {
        continue;
      }

      /*
       * Prefer DICOM StudyInstanceUID.
       *
       * If unavailable, fall back to the dataset
       * folder structure:
       *
       * PA0_ct_chest/ST0/SE2/IM0
       */
      const studyKey =
        summary.studyInstanceUID ||
        path.basename(
          path.dirname(
            path.dirname(file)
          )
        );

      /*
       * Prefer DICOM SeriesInstanceUID.
       */
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
       * Save study metadata once.
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
          }
        );
      }
    }

    /*
     * Convert grouped DICOM files into
     * DatasetStudy objects.
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
         * Sort CT slices.
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

            const asl =
              a.summary?.sliceLocation;

            const bsl =
              b.summary?.sliceLocation;

            if (
              asl !== undefined &&
              bsl !== undefined &&
              asl !== bsl
            ) {
              return asl - bsl;
            }

            return naturalSort(
              a.absPath,
              b.absPath
            );
          }
        );

        /*
         * Convert DICOM instances to viewer images.
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
            `Series ${seriesIdx}`,

          modality: "CT",

          orientation: "Axial",

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
       * Dataset folder/study identifier.
       *
       * Example:
       *
       * PA0_ct_chest
       * PA1_ct_brain
       */
      const folderStudyKey =
        getDatasetStudyKey(
          studyKey,
          seriesMap
        );

      /*
       * Match the CT report using:
       *
       * 1. StudyInstanceUID
       * 2. Accession number
       * 3. Dataset folder/study ID
       */
      const reportRow =
        matchByIdentifiers(
          reportLookup,
          [
            studyKey,
            meta?.accession,
            folderStudyKey,
          ]
        );

      /*
       * Build the structured report.
       *
       * The original report text is preserved.
       *
       * Perle CT reports are not always formatted
       * with explicit FINDINGS / CLINICAL INFORMATION
       * headings, so we use safe fallbacks.
       */
      const report:
        | StudyReport
        | undefined =
        reportRow
          ? (() => {
              const sections =
                parseReportSections(
                  reportRow.text
                );

              /*
               * Clinical information:
               *
               * First use the parser.
               * Then check explicitly named source
               * fields if the report came from CSV/JSON.
               */
              const clinicalInformation =
                cleanReportValue(
                  sections.clinicalInformation
                ) ||
                pickColumn(
                  reportRow.raw,
                  [
                    "clinical_information",
                    "clinicalinformation",
                    "clinical_info",
                    "clinical_history",
                    "clinicalhistory",
                    "history",
                    "indication",
                    "reason_for_exam",
                    "reason",
                  ]
                ) ||
                "";

              /*
               * Technique:
               *
               * First use parser.
               * Then use an explicit source field.
               */
              const technique =
                cleanReportValue(
                  sections.technique
                ) ||
                pickColumn(
                  reportRow.raw,
                  [
                    "technique",
                    "procedure",
                    "protocol",
                  ]
                ) ||
                "";

              /*
               * Findings:
               *
               * First use parser.
               *
               * If parser gives nothing, recover the
               * actual narrative from the original CT
               * report.
               */
              let findings =
                cleanReportValue(
                  sections.findings
                );

              if (!findings) {
                findings =
                  extractCtFindings(
                    reportRow.text,
                    technique,
                    sections.impression
                  );
              }

              /*
               * If the report came from a structured
               * CSV/JSON source, use its explicit
               * findings field as a final fallback.
               */
              if (!findings) {
                findings =
                  pickColumn(
                    reportRow.raw,
                    [
                      "findings",
                      "finding",
                      "observations",
                      "observation",
                    ]
                  ) ||
                  "";
              }

              /*
               * Impression:
               *
               * First use parser.
               * Then use explicit source field.
               */
              const impression =
                cleanReportValue(
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
                "";

              /*
               * Comparison.
               */
              const comparison =
                cleanReportValue(
                  sections.comparison
                ) ||
                pickColumn(
                  reportRow.raw,
                  [
                    "comparison",
                    "prior_comparison",
                    "previous_examination",
                  ]
                ) ||
                "";

              return {
                source: "Perle CT",

                /*
                 * IMPORTANT:
                 * Complete original report.
                 */
                text: reportRow.text,

                /*
                 * Structured UI fields.
                 */
                clinicalInformation,

                technique,

                findings,

                impression,

                comparison,
              };
            })()
          : undefined;

      /*
       * Stable Meridian study ID.
       */
      const id =
        stableId(
          "CT",
          studyKey
        );

      result.push({
        id,

        dataset: "CT",

        studyCode:
          studyCode(
            "CT",
            studyKey
          ),

        sourceStudyId:
          studyKey,

        patientAlias:
          `Patient ${id
            .slice(0, 6)
            .toUpperCase()}`,

        modality: "CT",

        bodyRegion:
          meta?.bodyPart,

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
 * Convert DICOM YYYYMMDD into YYYY-MM-DD.
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
 * Clean a report section without changing
 * the actual medical content.
 */
function cleanReportValue(
  value?: string
): string {
  if (!value) {
    return "";
  }

  return value.trim();
}

/**
 * Extract the dataset study identifier
 * from a Perle CT path.
 *
 * Example:
 *
 * .../ct_general/PA0_ct_chest/ST0/SE2/IM0
 *
 * returns:
 *
 * PA0_ct_chest
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

    const marker =
      "/ct_general/";

    const markerIndex =
      normalized.indexOf(
        marker
      );

    if (markerIndex >= 0) {
      const remainder =
        normalized.slice(
          markerIndex +
            marker.length
        );

      const parts =
        remainder.split("/");

      if (parts.length > 0) {
        return parts[0];
      }
    }
  }

  /*
   * If the study key itself is already
   * a dataset identifier, use it.
   */
  if (
    /^PA\d+_ct_/i.test(
      studyKey
    )
  ) {
    return studyKey;
  }

  return undefined;
}

/**
 * Load CT reports from:
 *
 * CSV
 * JSON
 * TXT
 */
function loadReports(
  csvFiles: string[],
  jsonFiles: string[],
  txtFiles: string[],
  issues: AdapterIssue[]
): Map<string, ReportRow> {
  const rows: ReportRow[] = [];

  /*
   * ============================================================
   * CSV REPORTS
   * ============================================================
   */
  for (const csv of csvFiles) {
    const content =
      readTextFileSafe(csv);

    if (!content) {
      issues.push({
        dataset: "CT",
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
        dataset: "CT",
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
            "accession",
            "accession_number",
            "study_id",
            "subject_id",
            "id",
          ]
        );

      const text =
        pickColumn(
          row,
          [
            "report",
            "findings",
            "impression",
            "text",
            "narrative",
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
   * ============================================================
   * JSON REPORTS
   * ============================================================
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
        const key =
          entry.StudyInstanceUID ??
          entry.study_instance_uid ??
          entry.accession_number ??
          entry.study_id ??
          entry.subject_id ??
          entry.id;

        const text =
          entry.report ??
          entry.findings ??
          entry.impression ??
          entry.text;

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
        dataset: "CT",
        path: jsonFile,
        reason:
          "Malformed JSON",
      });
    }
  }

  /*
   * ============================================================
   * TXT REPORTS
   * ============================================================
   *
   * Perle CT reports may be associated with:
   *
   * PA0_ct_chest
   * PA1_ct_brain
   * etc.
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

      /*
       * Preserve the complete TXT report.
       */
      text: content.trim(),

      raw: {
        sourceFile:
          txtFile,
      },
    });
  }

  /*
   * Build identifier lookup.
   */
  return buildLookup(
    rows,
    (row) => row.key
  );
}

/**
 * Extract findings from a Perle CT report.
 *
 * Supported structures:
 *
 * 1. Explicit FINDINGS heading:
 *
 *    FINDINGS:
 *    ...
 *    IMPRESSION:
 *    ...
 *
 * 2. Perle-style report:
 *
 *    TECHNIQUE:
 *    ...
 *    actual CT observations
 *    ...
 *    IMPRESSION:
 *    ...
 *
 * The function only extracts existing text.
 * It does NOT generate or fabricate findings.
 */
function extractCtFindings(
  text: string,
  technique: string,
  impression?: string
): string {
  if (!text?.trim()) {
    return "";
  }

  const normalized =
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

  /*
   * ------------------------------------------------------------
   * CASE 1:
   * Explicit FINDINGS / OBSERVATIONS heading.
   * ------------------------------------------------------------
   */
  const findingsMatch =
    normalized.match(
      /(?:^|\n)\s*(?:FINDINGS?|OBSERVATIONS?)\s*[:\-]?\s*\n?/i
    );

  if (
    findingsMatch &&
    findingsMatch.index !== undefined
  ) {
    const start =
      findingsMatch.index +
      findingsMatch[0].length;

    const remaining =
      normalized.slice(start);

    const impressionMatch =
      remaining.match(
        /(?:^|\n)\s*(?:IMPRESSION|CONCLUSION|SUMMARY)\s*[:\-]?\s*/i
      );

    const value =
      impressionMatch &&
      impressionMatch.index !== undefined
        ? remaining.slice(
            0,
            impressionMatch.index
          )
        : remaining;

    return value.trim();
  }

  /*
   * ------------------------------------------------------------
   * CASE 2:
   * Perle report has TECHNIQUE followed by findings,
   * then IMPRESSION.
   * ------------------------------------------------------------
   */
  const techniqueMatch =
    normalized.match(
      /(?:^|\n)\s*TECHNIQUE\s*[:\-]?\s*/i
    );

  const impressionMatch =
    normalized.match(
      /(?:^|\n)\s*(?:IMPRESSION|CONCLUSION|SUMMARY)\s*[:\-]?\s*/i
    );

  if (
    techniqueMatch &&
    techniqueMatch.index !== undefined &&
    impressionMatch &&
    impressionMatch.index !== undefined &&
    impressionMatch.index >
      techniqueMatch.index
  ) {
    let findingsStart =
      techniqueMatch.index +
      techniqueMatch[0].length;

    const beforeImpression =
      normalized.slice(
        0,
        impressionMatch.index
      );

    /*
     * Remove the known technique text from the
     * beginning of the region.
     */
    if (technique?.trim()) {
      const afterTechnique =
        beforeImpression.slice(
          findingsStart
        );

      const leadingWhitespace =
        afterTechnique.length -
        afterTechnique.trimStart().length;

      const trimmedTechnique =
        technique.trim();

      const candidate =
        afterTechnique
          .trimStart();

      if (
        candidate.startsWith(
          trimmedTechnique
        )
      ) {
        findingsStart +=
          leadingWhitespace +
          trimmedTechnique.length;
      }
    }

    const findings =
      normalized
        .slice(
          findingsStart,
          impressionMatch.index
        )
        .trim();

    /*
     * Return only if meaningful content exists.
     */
    if (findings) {
      return findings;
    }
  }

  /*
   * ------------------------------------------------------------
   * CASE 3:
   * Parser supplied an impression but there is no
   * explicit section boundary that we can safely use.
   *
   * Do not guess.
   * ------------------------------------------------------------
   */
  if (impression?.trim()) {
    return "";
  }

  return "";
}

/**
 * Extract:
 *
 * PA0_ct_chest
 * PA1_ct_brain
 *
 * from a Perle CT report path.
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
   * Preferred structure:
   *
   * .../ct_general/PA0_ct_chest/report.txt
   */
  const marker =
    "/ct_general/";

  const markerIndex =
    normalized.indexOf(
      marker
    );

  if (markerIndex >= 0) {
    const remainder =
      normalized.slice(
        markerIndex +
          marker.length
      );

    const parts =
      remainder.split("/");

    if (
      parts.length > 0 &&
      /^PA\d+_ct_/i.test(
        parts[0]
      )
    ) {
      return parts[0];
    }
  }

  /*
   * Inspection reports:
   *
   * .../inspection/PA0_ct_chest/report.txt
   */
  const inspectionMarker =
    "/inspection/";

  const inspectionIndex =
    normalized.indexOf(
      inspectionMarker
    );

  if (inspectionIndex >= 0) {
    const remainder =
      normalized.slice(
        inspectionIndex +
          inspectionMarker.length
      );

    const parts =
      remainder.split("/");

    if (
      parts.length > 0 &&
      /^PA\d+_ct_/i.test(
        parts[0]
      )
    ) {
      return parts[0];
    }
  }

  return undefined;
}