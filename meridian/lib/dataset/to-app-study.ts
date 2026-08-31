import { DatasetStudy, DATASET_SOURCE_LABEL } from "./types";
import { parseReportSections } from "../report-utils";
import {
  Report,
  SeriesInfo,
  SourceReport,
  Study,
} from "@/lib/types";

/**
 * Builds the URL the browser will actually load pixels from.
 * Resolved server-side against the manifest — never a raw filesystem path.
 */
export function imageUrlFor(
  studyId: string,
  seriesId: string,
  index: number
): string {
  return `/api/studies/${encodeURIComponent(
    studyId
  )}/images/${encodeURIComponent(seriesId)}/${index}`;
}

function numericSeed(id: string): number {
  return parseInt(id.slice(0, 8), 16) || 0;
}

/**
 * Maps the immutable dataset report into the application's
 * SourceReport representation.
 *
 * The original report text is always preserved verbatim.
 */
function toSourceReport(
  ds: DatasetStudy
): SourceReport | undefined {
  if (!ds.report) {
    return undefined;
  }

  return {
    source: ds.report.source,
    text: ds.report.text,
    clinicalInformation:
      ds.report.clinicalInformation,
    indication:
      ds.report.indication,
    technique:
      ds.report.technique,
    findings:
      ds.report.findings,
    impression:
      ds.report.impression,
    comparison:
      ds.report.comparison,
  };
}

/**
 * Creates the editable Meridian working report.
 *
 * IMPORTANT:
 *
 * The dataset adapter provides the original report text.
 * We parse that text HERE in the common transformation layer.
 *
 * This means MRI and CT both follow the same pipeline:
 *
 * Dataset report text
 *        ↓
 * parseReportSections()
 *        ↓
 * clinicalInformation
 * technique
 * findings
 * impression
 *        ↓
 * Meridian Report UI
 *
 * We never modify the original dataset report.
 */
function toWorkingReport(
  ds: DatasetStudy
): Report {
  const src = ds.report;

  if (!src) {
    return {
      status: "ai-draft",

      sections: {
        clinicalInformation: "",
        technique: "",
        findings: "",
        impression: "",
      },

      aiAssisted: false,
      version: 1,
      reviewer: null,
      approvedAt: null,
    };
  }

  /*
   * Parse the complete original report text.
   */
  const parsed =
    parseReportSections(src.text);

  /*
   * Determine whether the parser actually found
   * at least one named report section.
   */
  const hasParsedSections =
    Boolean(
      parsed.clinicalInformation?.trim() ||
      parsed.technique?.trim() ||
      parsed.findings?.trim() ||
      parsed.impression?.trim()
    );

  /*
   * If the common parser found structured sections,
   * use those sections.
   *
   * Existing adapter-provided structured values are
   * retained as fallback for individual missing fields.
   */
  if (hasParsedSections) {
    return {
      status: "in-review",

      sections: {
        clinicalInformation:
          parsed.clinicalInformation ??
          src.clinicalInformation ??
          src.indication ??
          "",

        technique:
          parsed.technique ??
          src.technique ??
          "",

        findings:
          parsed.findings ??
          src.findings ??
          "",

        impression:
          parsed.impression ??
          src.impression ??
          "",
      },

      aiAssisted: false,
      version: 1,
      reviewer: null,
      approvedAt: null,
    };
  }

  /*
   * If the adapter already supplied structured fields,
   * preserve those fields.
   *
   * Do NOT move Technique or Impression into Findings.
   */
  const hasExistingStructuredSections =
    Boolean(
      src.clinicalInformation?.trim() ||
      src.indication?.trim() ||
      src.technique?.trim() ||
      src.findings?.trim() ||
      src.impression?.trim()
    );

  if (hasExistingStructuredSections) {
    return {
      status: "in-review",

      sections: {
        clinicalInformation:
          src.clinicalInformation ??
          src.indication ??
          "",

        technique:
          src.technique ??
          "",

        findings:
          src.findings ??
          "",

        impression:
          src.impression ??
          "",
      },

      aiAssisted: false,
      version: 1,
      reviewer: null,
      approvedAt: null,
    };
  }

  /*
   * Completely unstructured free-text report.
   *
   * There is no safe section to invent, so preserve the
   * original report as Findings rather than fabricating
   * Clinical Information / Technique / Impression.
   */
  return {
    status: "in-review",

    sections: {
      clinicalInformation: "",
      technique: "",
      findings: src.text,
      impression: "",
    },

    aiAssisted: false,
    version: 1,
    reviewer: null,
    approvedAt: null,
  };
}

export function toAppStudy(
  ds: DatasetStudy
): Study {
  const series: SeriesInfo[] =
    ds.series.map((s) => ({
      id: s.id,

      label: s.label,

      sliceCount:
        s.sliceCount,

      orientation:
        s.orientation,

      images:
        s.images.map((img) => ({
          index: img.index,

          imageUrl:
            imageUrlFor(
              ds.id,
              s.id,
              img.index
            ),

          width:
            img.width,

          height:
            img.height,
        })),
    }));

  return {
    id: ds.id,

    studyId:
      ds.studyCode,

    patientAlias:
      ds.patientAlias,

    age:
      ds.age,

    sex:
      ds.sex,

    modality:
      ds.modality,

    bodyRegion:
      ds.bodyRegion,

    date:
      ds.date,

    /*
     * Priority is intentionally not inferred
     * from report content.
     */
    priority:
      "routine",

    status:
      ds.report
        ? "in-review"
        : "queued",

    aiConfidence:
      null,

    assignedRadiologist:
      null,

    series,

    findings:
      (ds.aiFindings ?? []).map(
        (f, i) => ({
          id:
            `${ds.id}-ai-${i}`,

          label:
            f.label,

          confidence:
            f.confidence,

          band:
            f.band,

          region:
            f.region,

          sliceIndex:
            f.sliceIndex,

          seriesId:
            f.seriesId,

          description:
            f.description,

          status:
            "pending" as const,
        })
      ),

    thumbnailSeed:
      numericSeed(ds.id),

    /*
     * THIS is the editable report shown
     * in the Report tab.
     */
    report:
      toWorkingReport(ds),

    /*
     * Dataset badge, e.g. Perle CT / MR-RATE.
     */
    datasetSource:
      DATASET_SOURCE_LABEL[
        ds.dataset
      ],

    /*
     * Immutable original source report.
     */
    sourceReport:
      toSourceReport(ds),

    aiStatus:
      ds.aiFindings &&
      ds.aiFindings.length > 0
        ? "complete"
        : "not-run",
  };
}