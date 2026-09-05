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
 * `volumes` and `volumeId` are deliberately never set: those name server-side
 * DICOM stacks behind absolute paths, and the deployed Worker has no filesystem
 * to read them from. The server-side CT/3-D route is untouched by any of this.
 *
 * `clientVolume` is set instead, and by two different routes. A NIfTI series says
 * the browser can build the 3-D field out of the volume it already inflated to cut
 * the 2-D planes. A DICOM series of at least `DEMO_MIN_STACK_SLICES` files says it
 * can build one by reading an evenly spaced sample of those files. Either way the
 * viewer's 3-D toggle becomes reachable for the committed CT, MRI and PET studies
 * with no route, no backend and no second asset.
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
  DEMO_MIN_STACK_SLICES,
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

    /*
     * A run of these is a volume, so the 3-D view is reachable — but by reading a
     * sample of the files rather than out of something already in memory, since
     * each one is a separate 500 KB instance. `loadDemoCtVolume8` is the half that
     * decides how many. Gated on both the kind and the count so a committed chest
     * X-ray, which is one `raster` image, is excluded twice over.
     */
    const clientVolume = s.kind === "dicom" && s.files.length >= DEMO_MIN_STACK_SLICES;
    return { ...base, images, clientVolume };
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

  /*
   * The browser inflates this whole container to cut any one plane out of it, so
   * the 3-D view is reachable from the volume it already has — see
   * `loadDemoVolume8`. Guarded on the kind rather than on the presence of frames
   * because only NIfTI is a volume; a multi-frame raster would not be.
   */
  return { ...base, images: [], frames, clientVolume: s.kind === "nifti" };
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
