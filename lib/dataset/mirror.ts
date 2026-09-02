/**
 * ---------------------------------------------------------------------------
 * SERVER-ONLY. The read side of the R2 dataset mirror.
 * ---------------------------------------------------------------------------
 *
 * Why this module exists
 * ----------------------
 * On Windows the app reads `D:\ScanLab_Datasets` through `SCANLAB_DATA_ROOT`
 * and renders pixels on demand. On Cloudflare Workers neither half of that is
 * possible, and not for want of configuration:
 *
 *  - There is no filesystem, so `readManifest()` returns `undefined` (its
 *    ENOENT is swallowed) and every dataset surface degrades to "No dataset
 *    index has been built yet."
 *  - Even with the files somewhere reachable, on-demand rendering does not fit.
 *    A Worker isolate has a hard 128 MB ceiling (Cloudflare error 1102) shared
 *    across the requests it is handling. One cold slice out of the largest MRI
 *    container (512x512x256 uint16) costs roughly 375 MB transient across
 *    `readFileSync` -> `toArrayBuffer` copy -> gzip inflate -> `readImage`
 *    copy, settling at ~134 MB retained. One coronal CT reslice is worse in a
 *    different way: `buildDicomStack` reads all 558 instances of CT-C48B2F
 *    into a 146 MB Float32Array, which on Workers would be 558 sequential R2
 *    GETs to answer a single PNG.
 *  - And the manifest itself is 5.5 MB of JSON. Parsing it per request is well
 *    past the 10 ms CPU budget of the Workers Free plan.
 *
 * So the deployed app does not render and does not parse. Every response it
 * serves was computed once on the machine that already has the data, and is
 * stored in R2 under a key derived from the request. This module is the lookup.
 *
 * What that buys beyond correctness: `dicom-parser`, `nifti-reader-js` and
 * `pngjs` stop being reachable from the Worker entrypoint, which is what keeps
 * the bundle under the compressed-size limit.
 *
 * Invariants
 * ----------
 *  - No binding present => `getMirror()` returns undefined => every caller
 *    falls through to its existing filesystem path, byte for byte. This module
 *    can only ever add a code path, never alter the local one.
 *  - Keys are derived from request parameters only. No absolute path from the
 *    manifest is ever part of a key, so `absPath` still cannot reach the
 *    client (see the SERVER-ONLY note in config.ts).
 *  - Study and series ids are 16-char lowercase hex (`stableId`), and slice
 *    indices are integers, so keys need no escaping. `assertKeySegment` holds
 *    that assumption to the wall rather than trusting it.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";

/**
 * The parts of R2's binding API this module uses, declared structurally.
 *
 * Deliberately not `R2Bucket` from `@cloudflare/workers-types`: that package is
 * not a dependency of this project, and the two functions used here are stable
 * enough that a 6-line interface is cheaper than pulling an ambient type
 * package into a program that also compiles for Node.
 */
export interface MirrorObject {
  body: ReadableStream | null;
  size: number;
  httpEtag: string;
  /**
   * R2 surfaces whatever `x-amz-meta-*` headers the uploader set. Used only by
   * the 3-D volume route, whose shape and voxel spacing have to travel with the
   * bytes — see `serveMirroredVolume`.
   */
  customMetadata?: Record<string, string>;
}

export interface MirrorBucket {
  get(key: string): Promise<MirrorObject | null>;
  head(key: string): Promise<{ size: number } | null>;
}

/**
 * Resolved once per isolate. `undefined` means "not running on Workers, or the
 * DATASET binding is absent" — both of which mean "use the filesystem".
 *
 * `null` is not used as a sentinel here because `false` distinguishes "looked
 * and found nothing" from "not looked yet" without a second variable.
 */
let resolved: { bucket: MirrorBucket | undefined } | undefined;

export function getMirror(): MirrorBucket | undefined {
  if (resolved) return resolved.bucket;
  resolved = { bucket: lookupBucket() };
  return resolved.bucket;
}

function lookupBucket(): MirrorBucket | undefined {
  try {
    /*
     * In sync mode this reads a symbol off `globalThis` that the generated
     * Worker entrypoint sets. Off Workers the symbol is absent and the call
     * throws a long "did you call initOpenNextCloudflareForDev" message — which
     * is the expected, correct outcome on the user's Windows box, so it is
     * swallowed rather than logged. Memoized by the caller, so the throw
     * happens at most once per process.
     *
     * Imported from the deep subpath rather than the package root on purpose:
     * the root barrel also re-exports `config.js` (`defineCloudflareConfig`),
     * whereas `cloudflare-context.js` has nothing but `import type` at module
     * scope. Nothing extra is pulled onto the module graph of a route.
     */
    const env = getCloudflareContext({ async: false }).env as unknown as Record<string, unknown>;
    const candidate = env?.[MIRROR_BINDING];
    return isBucket(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Name of the R2 bucket binding in wrangler.jsonc. */
export const MIRROR_BINDING = "DATASET";

function isBucket(v: unknown): v is MirrorBucket {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MirrorBucket).get === "function" &&
    typeof (v as MirrorBucket).head === "function"
  );
}

/* -------------------------------------------------------------------------
 * Key scheme
 *
 * One key per response the app can produce, so a request is a single R2 GET
 * with no parsing and no branching. `mirrorKeys` is the only place that knows
 * the layout; the export script imports the same functions, which is what stops
 * writer and reader from drifting apart.
 * ---------------------------------------------------------------------- */

export const mirrorKeys = {
  /** Body of `/api/datasets`. */
  datasets: () => "meta/datasets.json",

  /** Body of `/api/datasets/status`. */
  datasetsStatus: () => "meta/datasets-status.json",

  /** Body of `/api/studies` — every indexed study, summary projection. */
  studies: () => "meta/studies.json",

  /** Body of `/api/studies/<id>`. */
  study: (studyId: string) => `meta/study/${assertKeySegment(studyId)}.json`,

  /** Body of `/api/studies/<id>/report`. */
  report: (studyId: string) => `meta/report/${assertKeySegment(studyId)}.json`,

  /** The upload hash index, for `/api/uploads/match`. */
  uploadIndex: () => "meta/upload-index.json",

  /*
   * `/api/uploads/match` is the one route whose mirrored form is not a copy of a
   * route body. Locally it calls `matchUpload`, which reads the 3.3 KB export
   * pack index *and* resolves the study code against the 5.5 MB manifest. So the
   * export precomputes the *outcomes* instead, one small object per lookup key,
   * and the route does at most two GETs and no large parse.
   *
   * Both segment kinds are already constrained by regexes in upload-match.ts —
   * sha256 is lowercase hex, a study code is `[A-Z][A-Z0-9]{1,7}-[0-9A-F]{6}` —
   * so `assertKeySegment` is a backstop rather than the guarantee.
   */
  uploadMatchByHash: (sha256: string) => `meta/upload-match/by-hash/${assertKeySegment(sha256)}.json`,
  uploadMatchByCode: (studyCode: string) => `meta/upload-match/by-code/${assertKeySegment(studyCode)}.json`,

  /**
   * The decimated 8-bit scalar volume behind the CT 3-D view, as produced by
   * `exportDicomVolume`. Only the four indexed CT stacks have one.
   *
   * `dims`, `spacingMm` and the window travel as R2 custom metadata rather than
   * in the body, because the body format is deliberately headerless — see the
   * docblock on the volume route.
   */
  volume: (studyId: string, seriesId: string) =>
    `volume/${assertKeySegment(studyId)}/${assertKeySegment(seriesId)}.bin`,

  /**
   * Pixels for one slice. `width` is the `?w=` the UI asked for — omitted for a
   * full-size render, which is the only case the viewer's main canvas uses.
   *
   * The extension is part of the key rather than side-channel metadata so the
   * content type can be recovered from the key alone: chest X-ray and ROCOv2
   * frames are copied out of the dataset byte for byte and stay JPEG/PNG, while
   * every reslice is written as PNG.
   */
  pixels: (studyId: string, seriesId: string, index: number, ext: string, width?: number) =>
    `pixels/${assertKeySegment(studyId)}/${assertKeySegment(seriesId)}/${assertIndex(index)}${
      width ? `@${assertIndex(width)}` : ""
    }.${assertExt(ext)}`,

  /**
   * Directory-ish prefix for one slice, without the extension. The read side
   * does not know whether a given slice was copied as a JPEG or rendered to
   * PNG, so it probes the candidate extensions in `PIXEL_EXTENSIONS` order.
   */
  pixelsPrefix: (studyId: string, seriesId: string, index: number, width?: number) =>
    `pixels/${assertKeySegment(studyId)}/${assertKeySegment(seriesId)}/${assertIndex(index)}${
      width ? `@${assertIndex(width)}` : ""
    }.`,
};

/**
 * Probed in this order. PNG first because it is the overwhelming majority
 * (every reslice) and because probing costs a GET.
 */
export const PIXEL_EXTENSIONS = ["png", "jpg", "jpeg"] as const;

export const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function assertKeySegment(v: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new Error(`Refusing to build an R2 key from ${JSON.stringify(v)}: unexpected characters.`);
  }
  return v;
}

function assertIndex(v: number): number {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`Refusing to build an R2 key from index ${v}: expected a non-negative integer.`);
  }
  return v;
}

function assertExt(v: string): string {
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPE_BY_EXT, v)) {
    throw new Error(`Unsupported mirror image extension ${JSON.stringify(v)}.`);
  }
  return v;
}

/* -------------------------------------------------------------------------
 * Serving
 * ---------------------------------------------------------------------- */

/**
 * Long, because a mirrored object is immutable in practice: re-exporting after a
 * re-index rewrites the key's *contents*, and the ETag comes from R2 itself, so
 * a conditional request still revalidates correctly. The local route keeps its
 * own shorter `max-age=60` — there, a re-index really can change pixels behind
 * a URL within one browsing session.
 */
const MIRROR_CACHE_CONTROL = "public, max-age=3600, must-revalidate";

/**
 * Streams a precomputed JSON response body straight out of R2.
 *
 * Returns `undefined` when there is no mirror or the key is absent, which the
 * callers treat as "fall through to the filesystem". The body is passed through
 * as a stream and never parsed — that is the whole point, since parsing is what
 * does not fit in the Free plan's 10 ms CPU budget.
 */
export async function serveMirroredJson(key: string, req?: Request): Promise<Response | undefined> {
  const bucket = getMirror();
  if (!bucket) return undefined;

  const object = await bucket.get(key).catch(() => null);
  if (!object) return undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": MIRROR_CACHE_CONTROL,
    ETag: object.httpEtag,
    "X-Mirror": "hit",
  };

  if (req?.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

/**
 * Reads and parses one small mirrored object.
 *
 * The counterpart to `serveMirroredJson`, for the one caller that has to *use* a
 * mirrored value rather than pass it through: `/api/uploads/match` needs the
 * matched study to build its response. Parsing is acceptable here and nowhere
 * else because these objects are a few hundred bytes — the thing that does not
 * fit the CPU budget is the 5.5 MB manifest, not a single match outcome.
 *
 * `undefined` means no mirror, no such object, or unparseable content; every
 * caller must already have a sensible answer for "not found", so a malformed
 * object is deliberately not distinguished from a missing one.
 */
export async function readMirroredJson<T>(key: string): Promise<T | undefined> {
  const bucket = getMirror();
  if (!bucket) return undefined;

  const object = await bucket.get(key).catch(() => null);
  if (!object || !object.body) return undefined;

  try {
    return (await new Response(object.body).json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Streams one mirrored slice.
 *
 * The extension is not known from the request — a chest frame is the dataset's
 * own JPEG copied byte for byte, while a reslice is a PNG this project rendered
 * — so the candidates are probed in `PIXEL_EXTENSIONS` order. That is up to
 * three R2 GETs in the worst case, but only for a miss; PNG is checked first and
 * covers every rendered slice.
 *
 * A `?w=` request falls back to the width-less object when no width-specific one
 * exists, which is what makes the raster half of the mirror affordable: the local
 * route ignores `maxEdge` for a source JPEG and returns the original bytes, so
 * storing a second identical copy under `<index>@320.jpg` for all 1,500 chest
 * studies would add ~225 MB of duplicates to say nothing new. Rendered slices are
 * unaffected — their width-specific object exists and is found first.
 *
 * A miss is *not* a fallthrough. The filesystem path cannot succeed on Workers
 * either, and a study that was left out of the mirror is a known, expected state
 * for this deployment — so it gets an explicit "not mirrored" tile rather than a
 * broken image. See `notMirroredTile`.
 */
export async function serveMirroredPixels(
  studyId: string,
  seriesId: string,
  index: number,
  width: number | undefined,
  req: Request,
): Promise<Response | undefined> {
  const bucket = getMirror();
  if (!bucket) return undefined;

  // `undefined` last: a width-specific render is preferred when it exists, and
  // the original is the honest answer when it does not.
  const widths = width === undefined ? [undefined] : [width, undefined];

  for (const w of widths) {
    for (const ext of PIXEL_EXTENSIONS) {
      const key = mirrorKeys.pixels(studyId, seriesId, index, ext, w);
      const object = await bucket.get(key).catch(() => null);
      if (!object) continue;

      const headers: Record<string, string> = {
        "Content-Type": CONTENT_TYPE_BY_EXT[ext],
        "Cache-Control": MIRROR_CACHE_CONTROL,
        ETag: object.httpEtag,
        "X-Mirror": "hit",
      };
      if (req.headers.get("if-none-match") === object.httpEtag) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { status: 200, headers });
    }
  }

  return notMirroredTile();
}

/**
 * The placeholder for a slice that exists in the index but whose pixels were not
 * included in the mirror.
 *
 * SVG rather than a stored PNG for three reasons: it needs no image library in
 * the Worker (`pngjs` is exactly what this design removes from the bundle), it
 * needs no object in R2, and it can say in words what happened instead of being
 * an ambiguous grey square. It is flat colour and text — deliberately nothing
 * that could be mistaken for anatomy.
 *
 * Status is 200 so the viewer's layout is preserved, and `no-store` means the
 * tile disappears as soon as the study is added to the mirror rather than
 * sticking around in a browser cache. `X-Mirror: miss` is the machine-readable
 * half, for checking coverage with curl.
 */
export function notMirroredTile(): Response {
  return new Response(NOT_MIRRORED_SVG, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Mirror": "miss",
    },
  });
}

const NOT_MIRRORED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Image not mirrored to this deployment">
  <rect width="512" height="512" fill="#0b1220"/>
  <rect x="8" y="8" width="496" height="496" fill="none" stroke="#1e293b" stroke-width="2" stroke-dasharray="10 8"/>
  <g fill="#64748b" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="middle">
    <text x="256" y="248" font-size="22">image not mirrored</text>
    <text x="256" y="282" font-size="15" fill="#475569">this study is indexed, pixels are not deployed</text>
  </g>
</svg>`;

/**
 * Streams the mirrored 3-D volume for one reconstructed series.
 *
 * `exportDicomVolume` reads every instance of the stack — 558 files for
 * CT-C48B2F — into a 146 MB Float32Array, so it cannot run on Workers at all.
 * The exported result, on the other hand, is decimated to <=128 cubed and lands
 * around 0.3 MB, which makes it the cheapest thing in the whole mirror.
 *
 * Returns `undefined` for no mirror or no object, so the local route keeps its
 * own on-demand path and its own 404 for a series that has no stack. There is no
 * placeholder here: a missing 3-D volume is already a state the client handles
 * (the toggle is gated on `SeriesInfo.volumeAvailable`).
 */
export async function serveMirroredVolume(
  studyId: string,
  seriesId: string,
  req: Request,
): Promise<Response | undefined> {
  const bucket = getMirror();
  if (!bucket) return undefined;

  const object = await bucket.get(mirrorKeys.volume(studyId, seriesId)).catch(() => null);
  if (!object) return undefined;

  const meta = object.customMetadata ?? {};
  const dims = meta.dims;
  const spacing = meta.spacing;
  const window = meta.window;

  // Without the shape the bytes are unusable, and guessing it would put a wrong
  // volume on screen. Fail loudly instead.
  if (!dims || !spacing || !window) {
    return new Response(
      JSON.stringify({ error: "Mirrored volume is missing its X-Volume-* metadata — re-run `npm run mirror:render`" }),
      { status: 422, headers: { "Content-Type": "application/json", "X-Mirror": "hit" } },
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Volume-Dims": dims,
    "X-Volume-Spacing": spacing,
    "X-Volume-Window": window,
    "Cache-Control": MIRROR_CACHE_CONTROL,
    ETag: object.httpEtag,
    "X-Mirror": "hit",
  };

  if (req.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { status: 200, headers });
}


