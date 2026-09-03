import { DatasetSeries, DatasetStudy, DATASET_SOURCE_LABEL } from "./types";
import { frameUrl, seriesImageAt, seriesImageCount } from "./series-frames";
import { parseReportSections } from "../report-utils";
import { buildPatientProfile, extractDemographics } from "../patient-profile";
import { simulateFindings } from "../simulated-findings";
import {
  Finding,
  Report,
  SeriesInfo,
  SourceReport,
  Study,
  ViewerImage,
} from "../types";


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
 * Appends a width hint to a URL that may already carry a query string.
 *
 * `imageUrlFor` produces a clean path, so the cover used to be built with a
 * bare `?w=`. A static demo asset URL already ends in `?dicom=1` or
 * `?nifti=…&f=12`, and a second `?` would make the whole thing a single opaque
 * path segment — the decoder would see no parameters and the Worker would 404.
 */
function withWidth(
  url: string,
  width: number
): string {
  return `${url}${
    url.includes("?") ? "&" : "?"
  }w=${width}`;
}

/**
 * One entry per slice, for a viewer that looks URLs up by index rather than
 * deriving them (see `imageByIndex` in AnalysisTab).
 *
 * A reconstructed plane stores its slices as a single compact run, so the
 * per-slice list is expanded here at request time instead of being written out
 * slice-by-slice into the manifest. Nothing but `index` varies for such a run —
 * the pixel size is a property of the plane, not of the individual slice.
 *
 * `url` wins over `imageUrlFor` when it is set, which is only ever the case for
 * the committed `public/demo-data` studies: those pixels are static assets the
 * browser decodes itself, because the deployed Worker has no filesystem to read
 * them from. Nothing produced by a dataset scan sets it.
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

        imageUrl:
          frameUrl(run, index) ??
          imageUrlFor(
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

    imageUrl:
      img.url ??
      imageUrlFor(
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
function isDigitChar(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Splits a technique block that has swallowed the report's own observations.
 *
 * Part of the MRI set is written as a single paragraph that opens with a
 * technique list — "Technique: Axial and sagittal T2, coronal T1, axial FLAIR.
 * In the medial aspect of the frontal lobe of the left cerebral hemisphere,
 * hypointensity on T1-weighted sequences ..." — and a section parser ends a
 * section only at the next heading. With no FINDINGS heading to stop at, the
 * whole report (measured at up to 2,360 characters) lands under Technique and
 * Findings comes out empty: an empty Findings panel in the report tab, and
 * nothing for the annotator to localise. Measured over the v4 manifest that is
 * 57 of 311 MRI studies, all of the same shape.
 *
 * The list itself ends at its first terminator — a full stop, a semicolon, or
 * the colon that introduces the description. What follows is what the
 * radiologist observed, so that is what Findings should hold. Nothing is
 * rewritten or invented: the same characters are simply attributed to the
 * section they were written for.
 *
 * Returns undefined when there is nothing substantial after the list, so a
 * genuinely technique-only report is left alone.
 */
function splitTechniqueTail(
  technique: string
): { technique: string; findings: string } | undefined {
  const text = technique.trim();

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== ";" && ch !== ":") continue;

    // "1.5 Tesla" and "7.5 x 4 x 6 cm" are not the end of anything.
    if (ch === "." && isDigitChar(text[i - 1]) && isDigitChar(text[i + 1])) continue;

    const head = text.slice(0, i + 1).trim();
    const tail = text.slice(i + 1).trim();

    // Short tail: the report really is only a technique note. Leave it.
    return tail.length < 80 ? undefined : { technique: head, findings: tail };
  }

  return undefined;
}

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
    const parsedTechnique =
      parsed.technique ??
      src.technique ??
      "";

    const parsedFindings =
      parsed.findings ??
      src.findings ??
      "";

    const parsedImpression =
      parsed.impression ??
      src.impression ??
      "";

    /*
     * Only when the parser produced neither Findings nor Impression: see
     * splitTechniqueTail above. A report with a real Findings or Impression
     * heading is used exactly as parsed.
     */
    const salvaged =
      !parsedFindings.trim() && !parsedImpression.trim()
        ? splitTechniqueTail(parsedTechnique)
        : undefined;

    return {
      status: "in-review",

      sections: {
        clinicalInformation:
          parsed.clinicalInformation ??
          src.clinicalInformation ??
          src.indication ??
          "",

        technique:
          salvaged?.technique ??
          parsedTechnique,

        findings:
          salvaged?.findings ??
          parsedFindings,

        impression:
          parsedImpression,
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

  const working =
    toWorkingReport(ds);

  /*
   * Real model output, if a model has ever run against this study. Measured
   * over the v4 manifest that is 0 of 2,314 — but the branch stays first, so
   * the day `aiFindings` is populated it wins outright and nothing is
   * simulated over the top of it.
   */
  const realFindings: Finding[] =
    (ds.aiFindings ?? []).map(
      (f, i) => ({
        id: `${ds.id}-ai-${i}`,
        label: f.label,
        confidence: f.confidence,
        band: f.band,
        region: f.region,
        sliceIndex: f.sliceIndex,
        seriesId: f.seriesId,
        description: f.description,
        status: "pending" as const,
      })
    );

  /*
   * Otherwise: localise the findings the study's *own* report describes. The
   * text is quoted from that report; only the box and the confidence are
   * inferred from it. `aiStatus: "simulated"` is what makes the UI say so.
   *
   * An entirely negative report yields nothing, and "not-run" stands.
   */
  const findings =
    realFindings.length > 0
      ? realFindings
      : simulateFindings({
          studyId: ds.id,
          modality: ds.modality,
          series,
          reportFindings:
            working.sections.findings,
          reportImpression:
            working.sections.impression,
        });

  const aiStatus: Study["aiStatus"] =
    realFindings.length > 0
      ? "complete"
      : findings.length > 0
        ? "simulated"
        : "not-run";

  /*
   * Read from the verbatim report rather than the parsed sections, because the
   * ROCOV2 captions that carry an age are a single unstructured sentence and may
   * land in any of them.
   */
  const quoted = extractDemographics(ds.report?.text);

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

    findings,

    thumbnailSeed:
      numericSeed(ds.id),

    /*
     * THIS is the editable report shown
     * in the Report tab.
     */
    report:
      working,

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

    aiStatus,

    /*
     * Demographics for the report's patient column. `age`/`sex` above stay
     * exactly as the dataset left them — undefined for every one of these
     * studies — so nothing reading `study.age` sees a generated number. The
     * generated values live here, each badged with where it came from.
     *
     * `quoted` is the exception that is not generated at all: a few of these
     * reports state the patient's age or sex in their own text, and quoting it
     * is not fabrication. It is passed in as `source`, shown unbadged, and it
     * keeps the panel from contradicting a sentence printed beside it.
     */
    patientProfile:
      buildPatientProfile({
        studyId: ds.id,
        displayName:
          ds.patientAlias,
        modality: ds.modality,
        bodyRegion:
          ds.bodyRegion,
        age: ds.age ?? quoted.age,
        sex: ds.sex ?? quoted.sex,
        // Real measured weight where the dataset states one (PET's
        // `metadata.json`). Height is never stated, so BMI/BSA still come out
        // badged as generated — the panel shows which is which.
        weightKg: ds.weightKg,
        supplied: "source",
      }),
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

    /*
     * The card renders `findings.length` and nothing else about them, so the
     * quoted report sentence in each `description` is dead weight here — about
     * 390 KB of it across 2,314 studies once findings are simulated for every
     * study with a report. The count, and therefore the card, is unchanged.
     */
    findings:
      full.findings.map((f) => ({
        ...f,
        description: "",
      })),

    /*
     * Demographics belong to the report's patient column, which only the detail
     * route serves. Measured at 1.1 MB across the list, for fields no card or
     * table reads — the studies list already shows a dash for age and sex, and
     * `/api/studies/<id>` carries the full profile.
     */
    patientProfile:
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

  return withWidth(
    middle.url ??
      imageUrlFor(
        ds.id,
        series.id,
        middle.index
      ),
    COVER_WIDTH
  );
}

const COVER_WIDTH = 320;