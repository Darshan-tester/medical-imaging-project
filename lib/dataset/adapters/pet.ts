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
} from "../image-render";
import {
  AdapterIssue,
  AdapterResult,
  DatasetAdapter,
  DatasetImageRef,
  DatasetSeries,
  DatasetStudy,
  NormalizedModality,
} from "../types";
import { buildNiftiVolumeSeries, naturalSort, studyCode } from "./shared";

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

interface VolumeGroup {
  /** BIDS subject+session key, e.g. "sub-983777-000001_ses-01". */
  studyKey: string;
  /** Report identifier used by report_en.csv ("Image ID"), e.g. "983777-000001". */
  imageId?: string;
  files: string[];
}

/**
 * PETWB-REP ships more than one volume per session:
 *
 *   derivatives/sub-983777-000001/
 *     sub-983777-000001_ses-01_desc-pet_suv.nii.gz        <- the PET SUV volume
 *     sub-983777-000001_ses-01_desc-resampled_ct.nii.gz   <- the attenuation CT
 *
 * These are two series of ONE acquisition, not two studies. Grouping them by
 * subject+session fixes two real defects at once: the PET study count was
 * doubled, and the CT volume was being presented as if it were a PET study.
 */
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

  const groups = new Map<string, VolumeGroup>();

  for (const file of niftiFiles) {
    const stem = niftiStem(file);
    const studyKey = extractSessionKey(stem);

    let group = groups.get(studyKey);

    if (!group) {
      group = {
        studyKey,
        imageId: extractPetImageId(studyKey),
        files: [],
      };

      groups.set(studyKey, group);
    }

    group.files.push(file);
  }

  const result: DatasetStudy[] = [];

  for (const group of groups.values()) {
    group.files.sort(naturalSort);

    const series: DatasetSeries[] = [];

    let hasPetVolume = false;

    group.files.forEach((absPath, vi) => {
      const descriptor = volumeDescriptor(
        niftiStem(absPath),
        group.studyKey
      );

      /*
       * Each NIfTI file is a whole volume, so it is walked once per
       * anatomical plane using the axis mapping in its own affine.
       * Planes the volume cannot support are skipped, never fabricated.
       */
      const built = buildNiftiVolumeSeries({
        seriesIdSeed: stableId(
          "PET",
          group.studyKey,
          String(vi)
        ),

        label: descriptor.label,

        modality: descriptor.modality,

        absPath,
      });

      if (built.length === 0) {
        issues.push({
          dataset: "PET",
          path: absPath,
          reason:
            "Could not read NIfTI header (invalid or corrupt file), so no plane could be reconstructed from this volume",
        });

        return;
      }

      if (descriptor.modality === "PET") {
        hasPetVolume = true;
      }

      series.push(...built);
    });

    if (series.length === 0) {
      continue;
    }

    /*
     * Match using multiple identifiers.
     *
     * Primary:
     *   983777-000001          (report_en.csv "Image ID")
     *
     * Secondary:
     *   sub-983777-000001_ses-01
     *   the individual volume stems
     */
    const reportRow =
      matchByIdentifiers(
        reportLookup,
        [
          group.imageId,
          group.studyKey,
          ...group.files.map(niftiStem),
        ].filter(
          (value): value is string =>
            Boolean(value)
        )
      );

    const id = stableId(
      "PET",
      "nifti",
      group.studyKey
    );

    const seed =
      group.imageId || group.studyKey;

    result.push({
      id,

      dataset: "PET",

      studyCode: studyCode(
        "PET",
        seed
      ),

      sourceStudyId: seed,

      patientAlias:
        `Patient ${id
          .slice(0, 6)
          .toUpperCase()}`,

      /*
       * A session that somehow contains no PET volume is reported as what it
       * actually is rather than being mislabelled PET.
       */
      modality: hasPetVolume
        ? "PET"
        : series[0].modality,

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

/** "sub-983777-000001_ses-01_desc-pet_suv.nii.gz" -> "sub-983777-000001_ses-01_desc-pet_suv" */
function niftiStem(file: string): string {
  return path
    .basename(file)
    .replace(
      /\.nii(\.gz)?$/i,
      ""
    );
}

/**
 * Collapse a BIDS-style derivative filename to its subject+session key so every
 * volume of one acquisition lands in one study.
 *
 *   sub-983777-000001_ses-01_desc-pet_suv      -> sub-983777-000001_ses-01
 *   sub-983777-000001_ses-01_desc-resampled_ct -> sub-983777-000001_ses-01
 *
 * Anything that is not BIDS-shaped keeps its own stem as the key, so unrelated
 * PET volumes are never merged together.
 */
function extractSessionKey(stem: string): string {
  const match = stem.match(
    /^(sub-[^_]+(?:_ses-[^_]+)?)/i
  );

  return match?.[1] ?? stem;
}

/**
 * Decide what one volume within a session actually is, from its BIDS `desc-`
 * entity. The attenuation CT must be labelled and typed as CT — presenting it
 * as PET would misrepresent the pixel data.
 *
 *   ..._desc-pet_suv       -> { label: "PET SUV",       modality: "PET" }
 *   ..._desc-resampled_ct  -> { label: "Resampled CT",  modality: "CT"  }
 */
function volumeDescriptor(
  stem: string,
  studyKey: string
): { label: string; modality: NormalizedModality } {
  const descMatch = stem.match(/_desc-(.+)$/i);

  const raw =
    descMatch?.[1] ??
    stem
      .slice(studyKey.length)
      .replace(/^[-_]+/, "");

  const tokens = raw
    .split(/[-_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const isCt = tokens.some(
    (t) => t.toLowerCase() === "ct"
  );

  const label =
    tokens.length > 0
      ? tokens
          .map((t) =>
            t.length <= 3
              ? t.toUpperCase()
              : t.charAt(0).toUpperCase() +
                t.slice(1)
          )
          .join(" ")
      : isCt
        ? "CT"
        : "PET";

  return {
    label,
    modality: isCt ? "CT" : "PET",
  };
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