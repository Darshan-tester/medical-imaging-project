/**
 * ---------------------------------------------------------------------------
 * SERIES IMAGE ACCESS
 * ---------------------------------------------------------------------------
 * A `DatasetSeries` stores its slices one of two ways:
 *
 *   - `images`  — one explicit ref per slice, because each slice is its own
 *                 file (a JPEG, a single-instance DICOM). The paths differ, so
 *                 nothing can be derived and every ref has to be written down.
 *   - `frames`  — one `SeriesFrameRun` for the whole series, because every
 *                 slice is a frame of the *same* container and differs only by
 *                 index (a NIfTI plane, a reconstructed DICOM stack plane).
 *
 * Everything downstream should go through this module instead of touching
 * either field, so a series reads the same whichever form it was indexed in.
 *
 * No `fs`, no `path`, no imports beyond the type definitions — safe to use from
 * API routes, scripts and the study normalizer alike.
 * ---------------------------------------------------------------------------
 */

import { DatasetImageRef, DatasetSeries, SeriesFrameRun } from "./types";

/**
 * Ref id for one frame of a compact run.
 *
 * `seriesId` is itself a content hash, so appending the index is enough to be
 * unique and stable across re-indexing runs — which is all this id has to be.
 * It is used as part of the render cache key and the image route's ETag, never
 * shown to a user and never sent to the browser.
 */
export function frameRefId(seriesId: string, index: number): string {
  return `${seriesId}-${index}`;
}

/**
 * Public URL for one frame of a compact run, or undefined for a run that has no
 * static URL at all (everything a dataset scan produced).
 *
 * `{index}` in the template is the frame number — see `SeriesFrameRun.urlTemplate`.
 */
export function frameUrl(run: SeriesFrameRun, index: number): string | undefined {
  return run.urlTemplate?.replace("{index}", String(index));
}

/** How many slices this series actually has refs for, in either representation. */
export function seriesImageCount(series: DatasetSeries): number {
  return series.frames ? series.frames.count : series.images.length;
}

/**
 * The ref for one slice, materialized on demand for a compact run.
 *
 * Returns undefined for an out-of-range index rather than throwing, so an API
 * route can turn a bad URL into a 404 without a try/catch.
 */
export function seriesImageAt(series: DatasetSeries, index: number): DatasetImageRef | undefined {
  const run = series.frames;
  if (!run) return series.images.find((img) => img.index === index);

  if (!Number.isInteger(index) || index < 0 || index >= run.count) return undefined;
  return {
    id: frameRefId(series.id, index),
    index,
    kind: run.kind,
    absPath: run.absPath,
    frameIndex: index,
    orientation: run.orientation,
    width: run.width,
    height: run.height,
    // Only set for the committed public/demo-data studies; undefined for
    // everything a dataset scan produced, which keeps the materialized ref
    // byte-identical to what it was before `urlTemplate` existed.
    url: frameUrl(run, index),
  };
}

/**
 * Every ref in the series, in slice order.
 *
 * A generator so a 500-slice reconstructed plane can be walked without ever
 * having 500 ref objects alive at once — the reason the compact form exists.
 */
export function* seriesImageRefs(series: DatasetSeries): Generator<DatasetImageRef, void, undefined> {
  if (!series.frames) {
    for (const img of series.images) yield img;
    return;
  }
  for (let index = 0; index < series.frames.count; index++) {
    const ref = seriesImageAt(series, index);
    if (ref) yield ref;
  }
}

/**
 * The distinct on-disk containers backing this series — one entry for a compact
 * run, one per slice otherwise.
 *
 * This is what an existence check wants: stat-ing the same NIfTI file once per
 * slice would be several hundred identical syscalls per series.
 */
export function seriesSourcePaths(series: DatasetSeries): string[] {
  if (series.frames) return [series.frames.absPath];
  const seen = new Set<string>();
  for (const img of series.images) seen.add(img.absPath);
  return [...seen];
}

/**
 * True when the series carries no resolvable slice at all, despite claiming
 * `sliceCount` — the "declared N slices but has 0 refs" inconsistency that
 * `dataset:verify` reports.
 */
export function seriesHasNoImages(series: DatasetSeries): boolean {
  return seriesImageCount(series) === 0;
}
