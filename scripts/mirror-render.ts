/**
 * ---------------------------------------------------------------------------
 * Pre-renders every pixel the deployed app can ask for into the R2 mirror tree.
 * ---------------------------------------------------------------------------
 *
 * Run with: npm run mirror:render   (after mirror:export, before mirror:upload)
 *
 * Why this exists
 * ---------------
 * `lib/dataset/mirror.ts` has the long version. The short one: a Worker isolate
 * has a hard 128 MB ceiling, and one cold slice out of the largest MRI container
 * costs ~375 MB transient across readFileSync -> toArrayBuffer -> gzip inflate ->
 * readImage. One coronal CT reslice is worse in a different shape: it reads all
 * 558 instances of CT-C48B2F into a 146 MB Float32Array. Neither can happen in a
 * request. So the pixels are rendered here, once, on the machine that has
 * `SCANLAB_DATA_ROOT`, and the Worker only streams bytes.
 *
 * The one rule that matters
 * ------------------------
 * Every byte written here comes from `renderImage` / `exportDicomVolume` — the
 * same functions `app/api/studies/[id]/images/...` and `.../volume/...` call.
 * Nothing is re-decoded, re-windowed or re-scaled by this script. A second
 * renderer would be free to drift, and a drifted reslice is a *plausible-looking
 * wrong image*, which is worse than a missing one.
 *
 * A slice is either copied byte for byte (an already-encoded JPEG/PNG in the
 * dataset) or produced by the real renderer. There is no third path, and nothing
 * here invents a slice that the index does not contain.
 *
 * What lands where
 * ----------------
 *   pixels/<studyId>/<seriesId>/<index>.<ext>        full size, main viewer
 *   pixels/<studyId>/<seriesId>/<index>@96.png       thumbnail strip
 *   pixels/<studyId>/<seriesId>/<index>@320.png      study-card cover slice
 *   volume/<studyId>/<seriesId>.bin                  8-bit scalar volume, 3-D view
 *   volume/<studyId>/<seriesId>.bin.meta.json        its dims/spacing/window
 *
 * The path relative to `--out` *is* the R2 key: `mirrorKeys` builds it, and
 * `scripts/mirror-upload.mjs` ships the tree verbatim.
 *
 * Budget
 * ------
 * Raster passthrough (all 1,510 chest/ROCOv2 frames) and all 4 CT studies are
 * always rendered — that is the approved scope. Volumetric MRI/PET studies are
 * then added, fewest slices first, alternating modalities, until `--budget-gb`
 * is reached. Whole studies only: a half-mirrored series would show the
 * "image not mirrored" tile partway through a scroll, which reads as data loss.
 *
 * Memory: one child process per volumetric study
 * ---------------------------------------------
 * The raster and CT phases run in this process. The volumetric phase does not:
 * each MRI/PET study is rendered by a child process that exits when the study is
 * done, and the parent measures what it wrote from disk.
 *
 * That is not tidiness, it is the only lever available. Peak memory here is held
 * by `lib/dataset/image-render.ts`'s module-level caches — `VOLUME_CACHE_MAX = 2`
 * decoded NIfTI volumes at up to `SCANLAB_VOLUME_MAX_MB` (384) each, plus one
 * `STACK_CACHE_MAX` DICOM stack — and those two are plain constants, not env
 * knobs. The knobs that *are* tunable, `SCANLAB_VOLUME_MAX_MB` and
 * `SCANLAB_VOLUME_MAX_EDGE`, decide how much a volume is decimated, so turning
 * them down would change the pixels this mirror serves relative to what the
 * local app serves. That is exactly the drift this script exists to prevent.
 *
 * So the caches are left alone and the process that holds them is made
 * short-lived. A run that previously died at the sixth volumetric study with
 * "Array buffer allocation failed" — after ~1.14 GB of good output — now loses at
 * most the one study that overflowed, and continues. Failures are listed at the
 * end and the study is left un-mirrored rather than half-mirrored.
 *
 * `--in-process` restores the old single-process behaviour for debugging. The
 * parent also falls back to it automatically if the very first child cannot even
 * start, so a machine where the child runner is wrong still renders.
 */

// Must stay the first import: it populates process.env from .env.local, and
// image-render reads its cache/decimation settings at module load time.
import "./load-env-local";

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { getCacheDir, getDataRoot, getZipExtractCacheDir } from "../lib/dataset/config";
import { assertWithinRoot } from "../lib/dataset/fs-utils";
import { exportDicomVolume, renderImage } from "../lib/dataset/image-render";
import { readManifest } from "../lib/dataset/manifest-store";
import { mirrorKeys } from "../lib/dataset/mirror";
import { seriesImageAt, seriesImageCount } from "../lib/dataset/series-frames";
import type { DatasetSeries, DatasetStudy, DicomVolumeRef } from "../lib/dataset/types";

/**
 * Widths the client actually requests, copied from the components that request
 * them rather than invented here.
 *
 *   96  — `THUMB_EDGE` in components/viewer/ThumbnailStrip.tsx
 *   320 — `COVER_WIDTH` in lib/dataset/to-app-study.ts, used for the card cover
 *
 * Both are optional objects. `serveMirroredPixels` falls back from `<i>@96.png`
 * to `<i>.png`, so a missing thumbnail costs transfer size, never correctness —
 * which is what makes `--no-thumbs` a safe way to halve a long render.
 */
const THUMB_EDGE = 96;
const COVER_WIDTH = 320;

/** Volumetric studies are added until this much has been written. 0 = no cap. */
const DEFAULT_BUDGET_GB = 3;

/**
 * Seed for "will this study fit", used only until the first real study has been
 * measured, after which the running average takes over. Deliberately on the high
 * side: overestimating stops one study early, underestimating overshoots the
 * budget by a whole study.
 */
const SEED_BYTES_PER_SLICE = 160 * 1024;

/**
 * How many raster files `estimateStudyBytes` could not stat. A dry run on a box
 * where the dataset is reachable leaves this at 0 and its raster totals are the
 * real file sizes; anything above 0 means part of the table is the seed guess,
 * and the report has to say so instead of printing "exact".
 */
let rasterStatMisses = 0;

/**
 * `renderImage` returns a content type; an R2 key needs an extension. Only these
 * three exist in `CONTENT_TYPE_BY_EXT` on the read side, so anything else is
 * refused by name instead of being written under a lying extension.
 */
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

/**
 * Scratch directory for the write-then-rename in `RenderWriter.write`.
 *
 * Inside `--out` so the rename stays on one volume, and named with a leading dot
 * so `collectObjects` in mirror-upload.mjs skips it — a leftover scratch file
 * from a killed run must not become an R2 object. Swept at startup as well.
 */
const TEMP_DIR = ".render-tmp";

/* -------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------- */

interface Options {
  out: string;
  budgetBytes: number;
  dryRun: boolean;
  thumbs: boolean;
  force: boolean;
  only: Set<string> | undefined;
  studies: Set<string> | undefined;
  /** Render volumetric studies here instead of in one child process each. */
  inProcess: boolean;
  /** Suppress the header and the end-of-run tables. Warnings still print. */
  quiet: boolean;
}

const USAGE = `Usage: npm run mirror:render -- [options]

Renders every slice the deployed app can request into a staging tree whose
layout is exactly the R2 key layout, ready for npm run mirror:upload.

Needs SCANLAB_DATA_ROOT and a built index (npm run dataset:index). Reads the
dataset read-only; writes only under --out.

Options:
  --out <dir>       Staging directory. Default: <cache>/mirror  (same tree
                    mirror:export writes into; the two never share a key.)
  --budget-gb <n>   Stop adding volumetric studies past this size. Default ${DEFAULT_BUDGET_GB}.
                    0 renders every indexed study — that is >1 TB, so don't.
  --dry-run         Plan and report only. Renders nothing, writes nothing.
  --no-thumbs       Skip the @${THUMB_EDGE} and @${COVER_WIDTH} objects. Roughly halves the run;
                    the read side falls back to the full-size object.
  --force           Re-render slices whose output file already exists.
  --only <ids>      Comma-separated dataset ids (CHEST_XRAY,CT,MRI,PET,ROCOV2).
  --studies <ids>   Comma-separated study ids. Bypasses the budget entirely —
                    for topping up one study that was left out.
  --in-process      Render volumetric studies in this process instead of one
                    child process each. Uses far more peak memory; the default
                    exists because that is what "Array buffer allocation failed"
                    on a long run means.
  --quiet           Skip the header and the summary tables. Set on the children.
  -h, --help        Show this message.
`;

function parseList(value: string | undefined, flag: string): Set<string> {
  if (!value) throw new Error(`${flag} needs a comma-separated list.`);
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error(`${flag} needs at least one value.`);
  return new Set(items);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    out: path.join(getCacheDir(), "mirror"),
    budgetBytes: DEFAULT_BUDGET_GB * 1024 * 1024 * 1024,
    dryRun: false,
    thumbs: true,
    force: false,
    only: undefined,
    studies: undefined,
    inProcess: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--no-thumbs") {
      opts.thumbs = false;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--in-process") {
      opts.inProcess = true;
    } else if (arg === "--quiet") {
      opts.quiet = true;
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out needs a directory.");
      opts.out = path.resolve(value);
    } else if (arg === "--budget-gb") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) throw new Error("--budget-gb needs a non-negative number.");
      opts.budgetBytes = value === 0 ? Number.POSITIVE_INFINITY : value * 1024 * 1024 * 1024;
    } else if (arg === "--only") {
      opts.only = parseList(argv[++i], "--only");
    } else if (arg === "--studies") {
      opts.studies = parseList(argv[++i], "--studies");
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(arg)}. Run with --help.`);
    }
  }

  return opts;
}

/* -------------------------------------------------------------------------
 * Path safety
 * ---------------------------------------------------------------------- */

/**
 * The same dual-root check both image routes do, for the same reason.
 *
 * These paths come out of our own manifest, so this is defense in depth rather
 * than validation — but a script that walks 2,314 studies unattended is exactly
 * where a stale manifest entry pointing outside the dataset would go unnoticed.
 * `getZipExtractCacheDir()` is the second root because an archived source is
 * expanded there at index time.
 */
function assertWithinAllowedRoots(absPath: string): void {
  try {
    assertWithinRoot(getDataRoot(), absPath);
    return;
  } catch (dataRootErr) {
    try {
      assertWithinRoot(getZipExtractCacheDir(), absPath);
      return;
    } catch {
      throw dataRootErr;
    }
  }
}

/* -------------------------------------------------------------------------
 * Writer
 * ---------------------------------------------------------------------- */

type Family = "pixels/raster" | "pixels/rendered" | "pixels/thumb" | "volume/";

interface Tally {
  objects: number;
  bytes: number;
}

/**
 * Writes one object per key and keeps the byte accounting the budget runs on.
 *
 * `skipped` counts objects that already existed on disk. Their bytes still count
 * toward the total, because the budget is about the size of the tree that gets
 * uploaded, not about how much this particular run did.
 */
class RenderWriter {
  readonly counts = new Map<Family, Tally>();
  skipped = 0;
  private readonly dirs = new Set<string>();
  private tmp: string | undefined;

  constructor(private readonly opts: Options) {}

  private tally(family: Family, bytes: number): void {
    const t = this.counts.get(family) ?? { objects: 0, bytes: 0 };
    t.objects++;
    t.bytes += bytes;
    this.counts.set(family, t);
  }

  /**
   * True when this key already has bytes on disk, so the caller can skip the
   * render that would produce them.
   *
   * This is what makes a run resumable. A render of the full curated set takes
   * hours; losing all of it to one crash, or to a re-run for one extra study,
   * is not acceptable, so an existing non-empty object is trusted. `--force`
   * exists for when the renderer itself changed.
   */
  has(key: string, family: Family): boolean {
    if (this.opts.force) return false;
    const file = path.join(this.opts.out, key);
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return false;
    }
    if (size <= 0) return false;
    this.tally(family, size);
    this.skipped++;
    return true;
  }

  /**
   * Folds objects some *other* process wrote into this process's accounting.
   *
   * The volumetric phase renders each study in a child, so without this the tree
   * total printed after each study would only count what the parent wrote — which
   * is nothing — and the budget would never advance. The numbers come from a walk
   * of the finished study's directories, so they are measured file sizes, exactly
   * like the in-process path.
   */
  adopt(family: Family, t: Tally): void {
    if (t.objects === 0) return;
    const cur = this.counts.get(family) ?? { objects: 0, bytes: 0 };
    cur.objects += t.objects;
    cur.bytes += t.bytes;
    this.counts.set(family, cur);
  }

  /**
   * Writes to a scratch file and renames it into place.
   *
   * `writeFileSync` straight to the key is not safe for a script that is expected
   * to be killed: this run died once with "Array buffer allocation failed", and a
   * process killed between two write chunks leaves a *truncated* PNG on disk.
   * `has()` trusts any non-empty file, so that truncated object would be skipped
   * by every later run and then uploaded — a corrupt slice on the deployed site,
   * which is the one failure mode worse than a missing one.
   *
   * A rename is atomic within a volume, and `<out>/.render-tmp` is inside `--out`
   * to guarantee they are on the same one. `renameSync` replaces an existing
   * destination on Windows too (libuv passes MOVEFILE_REPLACE_EXISTING), so
   * `--force` needs no special case.
   */
  write(key: string, family: Family, bytes: Buffer | Uint8Array): void {
    this.tally(family, bytes.byteLength);
    if (this.opts.dryRun) return;

    const file = path.join(this.opts.out, key);
    const dir = path.dirname(file);
    if (!this.dirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.dirs.add(dir);
    }

    const tmp = this.tempFile();
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  }

  /** One reused scratch path per process, so a kill leaves at most one file. */
  private tempFile(): string {
    if (!this.tmp) {
      const dir = path.join(this.opts.out, TEMP_DIR);
      fs.mkdirSync(dir, { recursive: true });
      this.tmp = path.join(dir, `w-${process.pid}`);
    }
    return this.tmp;
  }

  /** The sidecar `mirror-upload.mjs` turns into `x-amz-meta-*` headers. */
  writeJson(key: string, family: Family, value: unknown): void {
    this.write(key, family, Buffer.from(JSON.stringify(value)));
  }

  total(): Tally {
    let objects = 0;
    let bytes = 0;
    for (const t of this.counts.values()) {
      objects += t.objects;
      bytes += t.bytes;
    }
    return { objects, bytes };
  }
}

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

/** The kind every slice of a series has, in whichever form the series was indexed. */
function seriesKind(series: DatasetSeries): string | undefined {
  return series.frames ? series.frames.kind : series.images[0]?.kind;
}

/**
 * Which slice the study card shows.
 *
 * Reproduces `coverImageUrl` in lib/dataset/to-app-study.ts — middle slice of the
 * first series that has any — because that is the one URL the studies list
 * requests for all 2,314 cards, and a miss there is 2,314 placeholder tiles.
 */
function coverTarget(study: DatasetStudy): { seriesId: string; index: number } | undefined {
  for (const series of study.series) {
    const count = seriesImageCount(series);
    if (count > 0) return { seriesId: series.id, index: Math.floor(count / 2) };
  }
  return undefined;
}

function extFor(contentType: string, absPath: string): string {
  const ext = EXT_BY_CONTENT_TYPE[contentType];
  if (!ext) {
    throw new Error(
      `Refusing to mirror ${path.basename(absPath)}: the renderer returned ${contentType}, which has no key extension ` +
        "on the read side. Add it to CONTENT_TYPE_BY_EXT in lib/dataset/mirror.ts first, or leave this source out.",
    );
  }
  return ext;
}

/**
 * Renders one series into the tree and returns how many slices it wrote.
 *
 * A `raster` series is the dataset's own JPEG/PNG. It gets exactly one object —
 * the width-less key — because the local route returns those bytes untouched
 * whatever `?w=` says, so a width-specific copy would be a byte-identical
 * duplicate. For all 1,510 raster frames that is ~225 MB of nothing.
 *
 * Everything else is decoded by the real renderer, and gets the full-size object
 * plus a @96 thumbnail. Both come from `renderImage`, one call each: there is no
 * downscale-a-Buffer path in that module, and adding one here would be the second
 * renderer this script exists to avoid.
 */
function renderSeries(
  writer: RenderWriter,
  study: DatasetStudy,
  series: DatasetSeries,
  cover: { seriesId: string; index: number } | undefined,
  opts: Options,
): number {
  const count = seriesImageCount(series);
  if (count === 0) return 0;

  const volume: DicomVolumeRef | undefined = series.volumeId ? study.volumes?.[series.volumeId] : undefined;
  if (series.volumeId && !volume) {
    throw new Error(
      `Series ${series.id} of study ${study.studyCode ?? study.id} references volume ${series.volumeId}, which is not ` +
        "in the index. Re-run `npm run dataset:index` — rendering it would need a stack this script cannot reconstruct.",
    );
  }

  const raster = seriesKind(series) === "raster";
  let wrote = 0;

  for (let index = 0; index < count; index++) {
    const ref = seriesImageAt(series, index);
    if (!ref) throw new Error(`Series ${series.id} reports ${count} slices but has no ref at index ${index}.`);
    assertWithinAllowedRoots(ref.absPath);

    const isCover = cover !== undefined && cover.seriesId === series.id && cover.index === index;

    // The extension has to be known *before* rendering, so an already-rendered
    // slice can be skipped without decoding it. It is knowable: a raster keeps
    // its source extension, and every decoded slice is encoded as PNG.
    const ext = raster ? rasterExt(ref.absPath) : "png";
    const family: Family = raster ? "pixels/raster" : "pixels/rendered";

    // Full size: what the viewer's main canvas requests.
    const fullKey = mirrorKeys.pixels(study.id, series.id, index, ext);
    if (!writer.has(fullKey, family)) {
      const rendered = renderImage(ref, { volume });
      const actual = extFor(rendered.contentType, ref.absPath);
      if (actual !== ext) {
        throw new Error(
          `${path.basename(ref.absPath)} was expected to mirror as .${ext} but the renderer produced ${rendered.contentType}. ` +
            "Writing it under the predicted key would serve it with the wrong content type.",
        );
      }
      writer.write(fullKey, family, rendered.bytes);
      wrote++;
    }

    // A raster is returned at full size whatever `?w=` says, so `@96`/`@320`
    // would be duplicates; the read side's width fallback already covers them.
    if (opts.thumbs && !raster) {
      const thumbKey = mirrorKeys.pixels(study.id, series.id, index, "png", THUMB_EDGE);
      if (!writer.has(thumbKey, "pixels/thumb")) {
        writer.write(thumbKey, "pixels/thumb", renderImage(ref, { volume, maxEdge: THUMB_EDGE }).bytes);
      }
      if (isCover) {
        const coverKey = mirrorKeys.pixels(study.id, series.id, index, "png", COVER_WIDTH);
        if (!writer.has(coverKey, "pixels/thumb")) {
          writer.write(coverKey, "pixels/thumb", renderImage(ref, { volume, maxEdge: COVER_WIDTH }).bytes);
        }
      }
    }
  }

  return wrote;
}

/**
 * A raster's mirror extension, from its source filename.
 *
 * `renderRaster` derives its content type the same way — from the path — so this
 * agrees with it by construction. Anything the read side has no content type for
 * is refused here rather than uploaded as a mislabelled PNG.
 */
function rasterExt(absPath: string): string {
  const raw = path.extname(absPath).slice(1).toLowerCase();
  const ext = raw === "jpeg" ? "jpg" : raw;
  if (!Object.values(EXT_BY_CONTENT_TYPE).includes(ext)) {
    throw new Error(
      `Cannot mirror ${path.basename(absPath)}: .${raw} is not a format the deployed reader can serve. ` +
        "The indexed dataset should only contain .jpg and .png rasters.",
    );
  }
  return ext;
}

/**
 * Exports the 8-bit scalar volume behind every reconstructed series of a study.
 *
 * Decoded once per `volumeId`, written once per *series*, because the 3-D route
 * is keyed by series id and the coronal and sagittal series of a CT study share
 * one stack. Re-decoding for the second one would mean reading all 558 instances
 * of CT-C48B2F twice for 0.3 MB of identical output.
 *
 * The three sidecar fields are the exact strings the local route puts in its
 * `X-Volume-*` headers, and `serveMirroredVolume` refuses a volume that is
 * missing any of them — without the shape the bytes are unusable, and guessing
 * would put a wrong volume on screen.
 */
function renderVolumes(writer: RenderWriter, study: DatasetStudy, opts: Options): number {
  const cache = new Map<string, { bytes: Uint8Array; meta: Record<string, string> } | undefined>();
  let wrote = 0;

  for (const series of study.series) {
    if (!series.volumeId) continue;
    const ref = study.volumes?.[series.volumeId];
    if (!ref) continue;

    const key = mirrorKeys.volume(study.id, series.id);
    const metaKey = `${key}.meta.json`;
    if (writer.has(key, "volume/") && writer.has(metaKey, "volume/")) continue;

    if (!cache.has(series.volumeId)) {
      for (const file of ref.files) assertWithinAllowedRoots(file);
      if (opts.dryRun) {
        // Cheap, honest placeholder: the real export needs the whole stack in
        // memory, which is the one thing a plan must not do.
        cache.set(series.volumeId, undefined);
      } else {
        const exported = exportDicomVolume(ref);
        cache.set(
          series.volumeId,
          exported
            ? {
                bytes: exported.bytes,
                meta: {
                  dims: exported.dims.join(","),
                  spacing: exported.spacingMm.map((v) => v.toFixed(4)).join(","),
                  window: `${Math.round(exported.windowLo)},${Math.round(exported.windowHi)}`,
                },
              }
            : undefined,
        );
      }
    }

    const exported = cache.get(series.volumeId);
    if (!exported) {
      // Not fatal, and not silent: `exportDicomVolume` returns undefined for a
      // stack whose instances are inconsistent or compressed, which is exactly
      // what the local route reports as 422. The 2-D planes still mirror fine,
      // and the client gates the 3-D toggle on `volumeAvailable`.
      if (!opts.dryRun) console.log(`  ! no 3-D volume for series ${series.id} — its stack could not be reconstructed`);
      continue;
    }

    writer.write(key, "volume/", exported.bytes);
    writer.writeJson(metaKey, "volume/", exported.meta);
    wrote++;
  }

  return wrote;
}

/* -------------------------------------------------------------------------
 * Selection
 * ---------------------------------------------------------------------- */

interface Candidate {
  study: DatasetStudy;
  slices: number;
  /** True for the always-included half of the approved scope. */
  required: boolean;
}

/**
 * Splits the index into "always mirror this" and "mirror it if it fits".
 *
 * Required: every raster study (1,500 chest + 10 ROCOv2 — a passthrough copy, no
 * decode, and they are the studies the demo is most likely to open) and all 4 CT
 * studies (3,144 reslices plus the 3-D volumes, and CT is the modality whose
 * reconstruction this project spent the most effort getting right).
 *
 * Optional: the volumetric MRI/PET studies, ordered fewest slices first and
 * alternating the two modalities. Fewest-first maximizes how many studies fit,
 * and alternating keeps both modalities present on the deployed site instead of
 * filling the budget with whichever one happens to have smaller volumes.
 */
function plan(studies: DatasetStudy[], opts: Options): { required: Candidate[]; optional: Candidate[] } {
  const required: Candidate[] = [];
  const perDataset = new Map<string, Candidate[]>();

  for (const study of studies) {
    if (opts.only && !opts.only.has(study.dataset)) continue;
    if (opts.studies && !opts.studies.has(study.id)) continue;

    let slices = 0;
    let allRaster = true;
    for (const series of study.series) {
      slices += seriesImageCount(series);
      if (seriesKind(series) !== "raster") allRaster = false;
    }
    if (slices === 0) continue;

    // `--studies` is the escape hatch for topping up one study by hand, so it
    // opts out of the budget rather than being re-ranked by it.
    const candidate: Candidate = { study, slices, required: allRaster || study.dataset === "CT" || Boolean(opts.studies) };
    if (candidate.required) {
      required.push(candidate);
      continue;
    }
    const bucket = perDataset.get(study.dataset) ?? [];
    bucket.push(candidate);
    perDataset.set(study.dataset, bucket);
  }

  // Deterministic: slice count, then study id. Two runs of the same index pick
  // the same studies, so a resumed run tops up the same set instead of starting
  // a different one.
  const buckets = [...perDataset.keys()].sort();
  for (const key of buckets) {
    perDataset.get(key)!.sort((a, b) => a.slices - b.slices || a.study.id.localeCompare(b.study.id));
  }

  const optional: Candidate[] = [];
  for (let round = 0; ; round++) {
    let added = false;
    for (const key of buckets) {
      const item = perDataset.get(key)![round];
      if (!item) continue;
      optional.push(item);
      added = true;
    }
    if (!added) break;
  }

  return { required, optional };
}

/* -------------------------------------------------------------------------
 * Estimation (dry run and budget checks only)
 * ---------------------------------------------------------------------- */

/**
 * How big a study is likely to be, without decoding anything.
 *
 * Exact for a raster study — the mirrored object *is* the source file, so a
 * `stat` is the answer. An estimate for everything else, because the only way to
 * know how many bytes a windowed 8-bit PNG of an MR slice takes is to encode it,
 * and encoding 1.2 M slices to plan a run defeats the point of planning.
 *
 * The estimate is only ever used to decide whether to *start* a study. Every
 * number this script reports as written is measured.
 */
function estimateStudyBytes(candidate: Candidate, bytesPerSlice: number, opts: Options): number {
  let total = 0;
  for (const series of candidate.study.series) {
    const count = seriesImageCount(series);
    if (count === 0) continue;

    if (seriesKind(series) === "raster") {
      for (let i = 0; i < count; i++) {
        const ref = seriesImageAt(series, i);
        if (!ref) continue;
        try {
          total += fs.statSync(ref.absPath).size;
        } catch {
          rasterStatMisses++;
          total += bytesPerSlice;
        }
      }
      continue;
    }

    total += count * bytesPerSlice;
    // A @96 PNG of an 8-bit slice is a few KB whatever the source resolution is.
    if (opts.thumbs) total += count * 6 * 1024;
  }
  return total;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function gb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* -------------------------------------------------------------------------
 * Per-study child processes
 *
 * Only the volumetric phase uses these. See the "Memory" section at the top for
 * why: the decoded-volume caches in image-render.ts are module constants, so the
 * only way to release them is to end the process that holds them.
 * ---------------------------------------------------------------------- */

/**
 * The tsx CLI this script is running under, so a child can be launched the same
 * way `npm run mirror:render` launched the parent.
 *
 * Only when this file really is TypeScript: if it has been compiled ahead of
 * time, the child must be plain node, and going through tsx would fail for a
 * reason that has nothing to do with rendering.
 *
 * Resolved by path rather than `require.resolve` because this file is loaded as
 * TypeScript — and checked for existence rather than assumed, because the
 * fallback (reuse the parent's `execArgv`, which carries a `--import` loader when
 * one was passed that way) is the only other thing that can work.
 */
function tsxCli(): string | undefined {
  const script = path.resolve(process.argv[1] ?? ".");
  if (!script.endsWith(".ts")) return undefined;

  const roots = [process.cwd(), path.dirname(path.dirname(script))];
  for (const root of roots) {
    const cli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(cli)) return cli;
  }
  return undefined;
}

/**
 * Renders one study in a child process and waits for it.
 *
 * `--studies <id>` is what makes this work without a second code path: it forces
 * the study into the child's `required` set and bypasses the budget, so the child
 * renders exactly this study and nothing else. The parent keeps the budget.
 *
 * `stdio: "inherit"` on purpose — a child's `! no 3-D volume for series ...`
 * warning and any stack trace belong in the same log as everything else. `--quiet`
 * is what keeps that from also meaning 29 copies of the summary table.
 *
 * Deliberately sequential (`spawnSync`): the point is to bound peak memory, and
 * two children at once would double it.
 */
function renderStudyInChild(studyId: string, opts: Options): { ok: boolean; detail: string } {
  // `--budget-gb 0` because `--studies` already bypasses the budget; passing the
  // parent's would only let the child print a warning about a limit it ignores.
  const args = ["--studies", studyId, "--out", opts.out, "--budget-gb", "0", "--in-process", "--quiet"];
  if (!opts.thumbs) args.push("--no-thumbs");
  if (opts.force) args.push("--force");

  const cli = tsxCli();
  const script = process.argv[1] ?? "";
  const argv = cli ? [cli, script, ...args] : [...process.execArgv, script, ...args];

  const res = spawnSync(process.execPath, argv, { stdio: "inherit", env: process.env, windowsHide: true });

  if (res.error) return { ok: false, detail: `could not start: ${res.error.message}` };
  if (res.signal) return { ok: false, detail: `killed by ${res.signal}` };
  if (res.status !== 0) return { ok: false, detail: `exit ${res.status}` };
  return { ok: true, detail: "" };
}

/** Visits every regular file under `dir`. An absent directory visits nothing. */
function walkFiles(dir: string, visit: (name: string, bytes: number) => void): void {
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) visit(entry.name, fs.statSync(abs).size);
    }
  };

  try {
    walk(dir);
  } catch {
    // Nothing rendered for this study — a failed child, or a study whose series
    // all produced no slices. Zero is the honest answer either way.
  }
}

/**
 * Folds a finished child's output into the parent's tally and returns its size.
 *
 * Sizes are stat'd, so the parent's running total and the budget it drives are
 * measured bytes, exactly as in the in-process path.
 *
 * The family split is by filename: `@` means a thumbnail, `.jpg` means a
 * passthrough raster, anything else under `pixels/` was decoded. That is exact
 * for this phase — `plan()` routes every all-raster study into `required`, which
 * never uses a child — and at worst would file a raster PNG inside a mixed study
 * under `pixels/rendered`. Only the per-family breakdown in the summary could
 * shift; the total cannot, so this is not worth a sidecar protocol.
 */
function adoptChildOutput(writer: RenderWriter, out: string, studyId: string): number {
  const tallies = new Map<Family, Tally>();
  const add = (family: Family, bytes: number): void => {
    const t = tallies.get(family) ?? { objects: 0, bytes: 0 };
    t.objects++;
    t.bytes += bytes;
    tallies.set(family, t);
  };

  walkFiles(path.join(out, "pixels", studyId), (name, bytes) => {
    add(name.includes("@") ? "pixels/thumb" : name.endsWith(".jpg") ? "pixels/raster" : "pixels/rendered", bytes);
  });
  walkFiles(path.join(out, "volume", studyId), (_name, bytes) => add("volume/", bytes));

  let total = 0;
  for (const [family, t] of tallies) {
    writer.adopt(family, t);
    total += t.bytes;
  }
  return total;
}

/**
 * Deletes scratch files left by an earlier run that was killed.
 *
 * Own-pid file excluded so this is safe to call from a child while the parent
 * has one open. Cheap: at most a handful of entries.
 */
function sweepTemp(out: string): void {
  const dir = path.join(out, TEMP_DIR);
  const mine = `w-${process.pid}`;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === mine) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        // A concurrent run still holds it. Not ours to force.
      }
    }
  } catch {
    // No scratch directory yet. Nothing to sweep.
  }
}

/* -------------------------------------------------------------------------
 * Driver
 * ---------------------------------------------------------------------- */

function renderStudy(writer: RenderWriter, candidate: Candidate, opts: Options): void {
  const { study } = candidate;
  const cover = coverTarget(study);
  // Manifest order, deliberately: the three planes of one NIfTI file are adjacent
  // in it, and `renderImage` keeps only the last two decoded volumes, so walking
  // them in order is what turns 3 decodes into 1.
  for (const series of study.series) renderSeries(writer, study, series, cover, opts);
  renderVolumes(writer, study, opts);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const manifest = readManifest();
  if (!manifest) {
    throw new Error(
      "No dataset index to render from. Run `npm run dataset:index` against SCANLAB_DATA_ROOT first — this script " +
        "reads .scanlab/manifest.json for the slice list and the dataset itself read-only.",
    );
  }

  // Fails fast and by name if the dataset root is unset or gone, rather than
  // after an hour of ENOENTs.
  const root = getDataRoot();
  if (!fs.existsSync(root)) {
    throw new Error(`SCANLAB_DATA_ROOT points at ${root}, which does not exist. Nothing can be rendered from it.`);
  }

  const { required, optional } = plan(manifest.studies, opts);
  if (!opts.quiet) {
    console.log(`Mirror render -> ${opts.out}${opts.dryRun ? "  (dry run, nothing will be written)" : ""}`);
    console.log(
      `Budget: ${opts.budgetBytes === Number.POSITIVE_INFINITY ? "unlimited" : gb(opts.budgetBytes)}   ` +
        `always-render: ${required.length} studies   candidates: ${optional.length} studies` +
        `${opts.thumbs ? "" : "   (thumbnails skipped)"}` +
        `${optional.length > 0 && !opts.inProcess ? "   (one child process per volumetric study)" : ""}`,
    );
    console.log("");
  }

  if (opts.dryRun) {
    reportPlan(required, optional, opts);
    console.log(`\nElapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return;
  }

  sweepTemp(opts.out);

  const writer = new RenderWriter(opts);
  const done = new Map<string, number>();
  const tick = (c: Candidate, n: number, of: number, note: string): void => {
    if (opts.quiet) return;
    const t = writer.total();
    console.log(
      `[${String(n).padStart(4)}/${of}] ${c.study.dataset.padEnd(10)} ${(c.study.studyCode ?? c.study.id).padEnd(14)} ` +
        `${String(c.slices).padStart(5)} slices  tree ${gb(t.bytes)}  ${note}`,
    );
  };

  required.forEach((c, i) => {
    renderStudy(writer, c, opts);
    done.set(c.study.dataset, (done.get(c.study.dataset) ?? 0) + 1);
    if (i % 50 === 0 || i === required.length - 1) tick(c, i + 1, required.length, "required");
  });

  const requiredBytes = writer.total().bytes;
  if (requiredBytes > opts.budgetBytes && !opts.quiet) {
    console.log(
      `\n! The always-render set alone is ${gb(requiredBytes)}, past the ${gb(opts.budgetBytes)} budget. It was rendered anyway —\n` +
        "  it is the approved scope. No volumetric study will be added; raise --budget-gb to add some.",
    );
  }

  let n = 0;
  let skippedForBudget = 0;
  let volBytes = 0;
  let volSlices = 0;
  const failures: string[] = [];
  /*
   * Children unless told otherwise, and it can turn itself off: if the very first
   * child fails *without writing anything*, the likely cause is that the child
   * runner is wrong for this machine rather than that the study is too big, and
   * rendering in-process is strictly better than rendering nothing.
   */
  let shard = !opts.inProcess;
  let childRuns = 0;

  for (const c of optional) {
    n++;
    const before = writer.total().bytes;
    // Measured average as soon as one volumetric study has landed; the seed only
    // ever decides the very first one.
    const perSlice = volSlices > 0 ? volBytes / volSlices : SEED_BYTES_PER_SLICE;
    const estimate = estimateStudyBytes(c, perSlice, opts);
    if (before + estimate > opts.budgetBytes) {
      skippedForBudget++;
      continue;
    }

    /*
     * A throw here is this study's problem, not the run's. The required set
     * still fails fast — a missing raster or CT instance means the index is
     * wrong and should stop everything — but a volumetric study that will not
     * decode on this machine costs that study only. Whole-study granularity is
     * what keeps that honest: the tree never holds half a series.
     */
    const renderHere = (): { ok: boolean; detail: string } => {
      try {
        renderStudy(writer, c, opts);
        return { ok: true, detail: "" };
      } catch (err) {
        return { ok: false, detail: (err instanceof Error ? err.message : String(err)).split("\n")[0] };
      }
    };

    let outcome: { ok: boolean; detail: string };
    let wrote: number;

    if (shard) {
      outcome = renderStudyInChild(c.study.id, opts);
      childRuns++;
      wrote = adoptChildOutput(writer, opts.out, c.study.id);

      if (!outcome.ok && wrote === 0 && failures.length === 0) {
        shard = false;
        console.log(
          `  ! The child process for ${c.study.studyCode ?? c.study.id} ${outcome.detail} and wrote nothing.\n` +
            "    Falling back to rendering volumetric studies in this process. That is the configuration that\n" +
            "    can exhaust memory on a long run — if it dies, re-run to resume, or pass --studies <id> per study.",
        );
        outcome = renderHere();
        wrote = writer.total().bytes - before;
      }
    } else {
      outcome = renderHere();
      wrote = writer.total().bytes - before;
    }

    if (!outcome.ok) {
      failures.push(`${c.study.studyCode ?? c.study.id} — ${outcome.detail}`);
      tick(c, n, optional.length, `FAILED (${outcome.detail}), left un-mirrored`);
      continue;
    }

    volBytes += wrote;
    volSlices += c.slices;
    done.set(c.study.dataset, (done.get(c.study.dataset) ?? 0) + 1);
    tick(c, n, optional.length, `est ${mb(estimate)}, real ${mb(wrote)}`);
  }

  report(writer, done, skippedForBudget, failures, childRuns, started, opts);
}

/**
 * The dry-run answer to the only question that matters before an hours-long run:
 * how many studies actually fit, per modality.
 *
 * Raster totals are exact (they are file sizes). Volumetric totals are the seed
 * estimate, and are labelled as such — the real number arrives during the run,
 * where every printed figure is measured.
 */
function reportPlan(required: Candidate[], optional: Candidate[], opts: Options): void {
  const rows = new Map<string, { studies: number; slices: number; bytes: number; fits: number }>();
  const add = (dataset: string, slices: number, bytes: number, fits: boolean): void => {
    const r = rows.get(dataset) ?? { studies: 0, slices: 0, bytes: 0, fits: 0 };
    r.studies++;
    r.slices += slices;
    if (fits) {
      r.bytes += bytes;
      r.fits++;
    }
    rows.set(dataset, r);
  };

  let running = 0;
  for (const c of required) {
    const bytes = estimateStudyBytes(c, SEED_BYTES_PER_SLICE, opts);
    running += bytes;
    add(c.study.dataset, c.slices, bytes, true);
  }
  const requiredBytes = running;

  for (const c of optional) {
    const bytes = estimateStudyBytes(c, SEED_BYTES_PER_SLICE, opts);
    const fits = running + bytes <= opts.budgetBytes;
    if (fits) running += bytes;
    add(c.study.dataset, c.slices, bytes, fits);
  }

  const names = [...rows.keys()].sort();
  console.log(`${"DATASET".padEnd(10)}  INDEXED   FITS     SLICES        SIZE`);
  for (const name of names) {
    const r = rows.get(name)!;
    console.log(
      `${name.padEnd(10)}  ${String(r.studies).padStart(7)}  ${String(r.fits).padStart(5)}  ${String(r.slices).padStart(9)}  ${mb(r.bytes).padStart(10)}`,
    );
  }
  console.log("-".repeat(52));
  console.log(
    `Always-render set: ${gb(requiredBytes)} ` +
      (rasterStatMisses === 0
        ? "(raster sizes exact, CT estimated)"
        : `(CT estimated, and ${rasterStatMisses} raster files could not be read — those are the ${mb(SEED_BYTES_PER_SLICE)}/slice seed, not real sizes)`),
  );
  console.log(`Planned tree:      ${gb(running)} of ${opts.budgetBytes === Number.POSITIVE_INFINITY ? "unlimited" : gb(opts.budgetBytes)}`);
  console.log(`Volumetric studies that fit: ${names.reduce((n, k) => n + (k === "MRI" || k === "PET" ? rows.get(k)!.fits : 0), 0)}`);
  console.log("Volumetric sizes are the seed estimate; the run replaces it with measured bytes as it goes.");
}

const FAMILIES: Family[] = ["pixels/raster", "pixels/rendered", "pixels/thumb", "volume/"];

function report(
  writer: RenderWriter,
  done: Map<string, number>,
  skippedForBudget: number,
  failures: string[],
  childRuns: number,
  started: number,
  opts: Options,
): void {
  if (opts.quiet) return;

  const width = Math.max(...FAMILIES.map((f) => f.length));
  console.log("");
  console.log(`${"KEY FAMILY".padEnd(width)}  OBJECTS        BYTES`);
  for (const family of FAMILIES) {
    const t = writer.counts.get(family);
    if (!t) continue;
    console.log(`${family.padEnd(width)}  ${String(t.objects).padStart(7)}  ${mb(t.bytes).padStart(11)}`);
  }
  const total = writer.total();
  console.log("-".repeat(width + 24));
  console.log(`${"TOTAL".padEnd(width)}  ${String(total.objects).padStart(7)}  ${gb(total.bytes).padStart(11)}`);

  console.log("");
  for (const dataset of [...done.keys()].sort()) console.log(`Studies mirrored, ${dataset.padEnd(10)} ${done.get(dataset)}`);
  if (skippedForBudget) {
    console.log(`Left out for budget:  ${skippedForBudget} volumetric studies`);
    console.log("  Their metadata and reports are still deployed; their slices show the \"image not mirrored\" tile.");
  }
  if (writer.skipped) {
    console.log(
      `Already on disk:      ${writer.skipped} objects (re-run with --force to redo them)` +
        // Each child keeps its own count and exits, so the parent only sees skips
        // from the phases it rendered itself. Saying so beats printing a number
        // that looks like it covers the whole tree.
        (childRuns > 0 ? "   [raster/CT phase only; per-study children keep their own count]" : ""),
    );
  }
  if (failures.length) {
    console.log("");
    console.log(`! ${failures.length} volumetric ${failures.length === 1 ? "study" : "studies"} could not be rendered:`);
    for (const f of failures) console.log(`    ${f}`);
    console.log(
      "  Each was rendered in its own process, so the rest of the tree is unaffected and nothing partial was\n" +
        "  written. Re-running resumes and retries them; a study that fails again is one this machine cannot\n" +
        "  decode, and its slices will show the \"image not mirrored\" tile while its report still works.",
    );
  }
  console.log(`Elapsed:              ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);

  console.log("");
  console.log(`Next: npm run mirror:upload -- --dir ${opts.out}`);
}

try {
  main();
} catch (err) {
  // A child renders one study and is always launched with --quiet, so say which
  // it was: "Mirror render failed" from a child would otherwise read as the whole
  // run dying, when the parent goes on to report it and continue.
  const studies = process.argv.includes("--quiet") ? process.argv[process.argv.indexOf("--studies") + 1] : undefined;
  const banner = studies ? `Rendering study ${studies} failed:` : "Mirror render failed:";
  console.error(`\n${banner}\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
