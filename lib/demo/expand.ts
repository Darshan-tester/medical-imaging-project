/**
 * ---------------------------------------------------------------------------
 * DEMO INDEX → NORMALIZED DATASET MODEL
 * ---------------------------------------------------------------------------
 * The one function that matters in the demo path, and the reason it is not a
 * second dataset system: it turns `public/demo-data/index.json` back into the
 * exact `DatasetStudy[]` that `.scanlab/manifest.json` holds. From that point on
 * the committed studies travel the existing pipeline — `toAppStudy`,
 * `parseReportSections`, `buildPatientProfile`, `simulateFindings`, the viewer,
 * the filters — with nothing branching on where they came from.
 *
 * Two fields carry the whole difference:
 *
 *   - `absPath` is `""`. There is no filesystem in the Worker, and nothing in the
 *     demo path ever reads it. It stays present because it is required by the
 *     shared type, and empty because a fake path would be a lie that some future
 *     server-side reader could act on.
 *   - `url` / `urlTemplate` are set. `viewerImagesFor` in `to-app-study.ts`
 *     prefers them over `/api/studies/...`, which is what routes these pixels to
 *     the static asset the browser decodes itself.
 *
 * `volumes` and `volumeId` are deliberately never set, so `volumeAvailable`
 * computes false and the viewer's 3-D toggle stays hidden: volume rendering is a
 * server route reading DICOM stacks off disk, which the deployed Worker cannot
 * do. The server-side CT/3-D path is untouched by any of this.
 *
 * Client-safe: no `fs`, no `path`.
 * ---------------------------------------------------------------------------
 */

import {
  DatasetImageRef,
  DatasetSeries,
  DatasetStudy,
  SeriesFrameRun,
} from "../dataset/types";
import { volumeRegistryKey } from "./registry";
import {
  DEMO_FRAME_PARAM,
  DEMO_NIFTI_PARAM,
  DEMO_PLANE_CODE,
  DEMO_PLANE_PARAM,
  DemoIndex,
  DemoSeries,
  DemoStudy,
} from "./types";

/**
 * Slice URL for one frame of a committed volume, with `{index}` left in place
 * for `SeriesFrameRun.urlTemplate` to substitute per slice.
 *
 * The archive case needs no special marker: the byte range lives in the registry
 * beside the geometry, because both are properties of the volume rather than of
 * the request.
 */
function niftiFrameTemplate(studyId: string, s: DemoSeries, url: string): string {
  const key = volumeRegistryKey(studyId, s.vol ?? "");
  const plane = DEMO_PLANE_CODE[s.plane ?? "Axial"];
  const sep = url.includes("?") ? "&" : "?";
  return (
    `${url}${sep}${DEMO_NIFTI_PARAM}=${key}` +
    `&${DEMO_PLANE_PARAM}=${plane}` +
    `&${DEMO_FRAME_PARAM}={index}`
  );
}

function toDatasetSeries(study: DemoStudy, s: DemoSeries): DatasetSeries {
  const base: Omit<DatasetSeries, "images" | "frames"> = {
    id: s.id,
    label: s.label,
    modality: study.modality,
    orientation: s.orientation,
    sliceCount: s.n,
  };

  /*
   * One file per slice: the paths differ, so each ref has to be written out —
   * exactly the case `DatasetSeries.images` exists for.
   */
  if (s.files) {
    const images: DatasetImageRef[] = s.files.map((url, index) => ({
      id: `${s.id}-${index}`,
      index,
      kind: s.kind,
      absPath: "",
      url,
      orientation: s.orientation,
      width: s.w,
      height: s.h,
    }));
    return { ...base, images };
  }

  /*
   * Every slice is a frame of one container at a different index: the compact
   * form, so a 512-slice plane is one object rather than 512.
   */
  const volume = study.volumes?.[s.vol ?? ""];
  if (!volume) {
    // A series naming a volume the index does not contain. Nothing can be
    // rendered from it, and `dataset:verify`'s "declared N slices but has 0
    // refs" check is the right place for it to surface.
    return { ...base, images: [] };
  }

  const frames: SeriesFrameRun = {
    kind: s.kind,
    absPath: "",
    count: s.n,
    orientation: s.orientation,
    width: s.w,
    height: s.h,
    urlTemplate: niftiFrameTemplate(study.id, s, volume.url),
  };

  return { ...base, images: [], frames };
}

/**
 * Provenance string for the verify report, in public-URL form.
 *
 * `DatasetStudy.sourceDir` is documented as never being shown verbatim in the
 * UI; here it happens to be safe to show anyway, because a deployed demo study's
 * location genuinely is a public URL and not a path on anyone's machine.
 */
function sourceDirFor(study: DemoStudy): string {
  const first = study.series[0];
  const url = first?.files?.[0] ?? study.volumes?.[first?.vol ?? ""]?.url;
  if (!url) return "/demo-data";
  const cut = url.lastIndexOf("/");
  return cut > 0 ? url.slice(0, cut) : url;
}

export function demoStudyToDataset(study: DemoStudy): DatasetStudy {
  return {
    id: study.id,
    dataset: study.dataset,
    studyCode: study.code,
    sourceStudyId: study.srcId,
    patientAlias: study.alias,
    age: study.age,
    sex: study.sex,
    weightKg: study.weightKg,
    modality: study.modality,
    bodyRegion: study.bodyRegion,
    date: study.date,
    series: study.series.map((s) => toDatasetSeries(study, s)),
    report: study.report,
    sourceDir: sourceDirFor(study),
  };
}

export function demoIndexToDatasetStudies(index: DemoIndex): DatasetStudy[] {
  return index.studies.map(demoStudyToDataset);
}
