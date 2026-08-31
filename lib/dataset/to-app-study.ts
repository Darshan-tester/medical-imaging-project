import { DatasetSeries, DatasetStudy, DATASET_SOURCE_LABEL } from "./types";
import { seriesImageAt, seriesImageCount } from "./series-frames";
import { parseReportSections } from "../report-utils";
import {
  Report,
  SeriesInfo,
  SourceReport,
  Study,
  ViewerImage,
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

/**
 * One entry per slice, for a viewer that looks URLs up by index rather than
 * deriving them (see `imageByIndex` in AnalysisTab).
 *
 * A reconstructed plane stores its slices as a single compact run, so the
 * per-slice list is expanded here at request time instead of being written out
 * slice-by-slice into the manifest. Nothing but `index` varies for such a run —
 * the pixel size is a property of the plane, not of the individual slice.
 */
function viewerImagesFor(
  studyId: string,
  s: DatasetSeries
): ViewerImage[] {
  const run = s.frames;

  if (run) {
    return Array.from(
      { length: run.count },
      (_, index) => ({
        index,

        imageUrl: imageUrlFor(
          studyId,
          s.id,
          index
        ),

        width: run.width,

        height: run.height,
      })
    );
  }

  return s.images.map((img) => ({
    index: img.index,

    imageUrl: imageUrlFor(
      studyId,
      s.id,
      img.index
    ),

    width: img.width,

    height: img.height,
  }));
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

      // Boolean only — `volumes` holds absolute paths and stays server-side.
      // True means /api/studies/<id>/volume/<seriesId> will serve this series.
      volumeAvailable:
        Boolean(s.volumeId && ds.volumes?.[s.volumeId]),

      images:
        viewerImagesFor(
          ds.id,
          s
        ),
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

/**
 * ---------------------------------------------------------------------------
 * LIST PROJECTION
 * ---------------------------------------------------------------------------
 * `/api/studies` returns every indexed study at once, and the studies list
 * renders none of the per-slice detail. Sending the full `toAppStudy` shape
 * meant a volumetric dataset shipped one URL per slice for every study — for
 * the PET half alone that is ~200,000 URLs, i.e. tens of megabytes of JSON
 * re-serialized on every visit to /studies, none of which the list reads.
 *
 * This projection keeps every field the list, filters and sorting actually
 * touch (modality, status, priority, dataset badge, dates, series metadata)
 * and drops the two heavy ones: per-slice image arrays and full report text.
 * The study detail route still uses `toAppStudy`, so nothing the viewer needs
 * is lost.
 *
 * One deliberate addition: `imageUrls` gets a single downscaled URL for a
 * representative slice, so a real dataset study shows a real thumbnail on its
 * card instead of the synthetic placeholder texture. It is one request per
 * card, at thumbnail resolution.
 */
export function toAppStudySummary(
  ds: DatasetStudy
): Study {
  const full = toAppStudy(ds);

  const series: SeriesInfo[] =
    ds.series.map((s) => ({
      id: s.id,
      label: s.label,
      sliceCount: s.sliceCount,
      orientation: s.orientation,
    }));

  const cover =
    coverImageUrl(ds);

  return {
    ...full,

    series,

    /*
     * The list never renders report prose. Status is preserved above via
     * `full.status`, which is derived from whether a report was matched.
     */
    report: {
      ...full.report,
      sections: {
        clinicalInformation: "",
        technique: "",
        findings: "",
        impression: "",
      },
    },

    sourceReport:
      undefined,

    imageUrls:
      cover
        ? [cover]
        : undefined,
  };
}

/**
 * A representative slice for the study card: the middle of the first series
 * that has any images. The middle rather than slice 0 because the first slice
 * of a volumetric acquisition is usually empty air.
 */
function coverImageUrl(
  ds: DatasetStudy
): string | undefined {
  const series =
    ds.series.find(
      (s) => seriesImageCount(s) > 0
    );

  if (!series) {
    return undefined;
  }

  const middle =
    seriesImageAt(
      series,
      Math.floor(
        seriesImageCount(series) / 2
      )
    );

  if (!middle) {
    return undefined;
  }

  return `${imageUrlFor(
    ds.id,
    series.id,
    middle.index
  )}?w=${COVER_WIDTH}`;
}

const COVER_WIDTH = 320;