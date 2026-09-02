// Ships the staging mirror to the R2 bucket the deployed Worker reads.
//
// Where this sits in the pipeline
// -------------------------------
//   npm run mirror:export  ->  .scanlab/mirror/meta/*    precomputed API bodies
//   npm run mirror:render  ->  .scanlab/mirror/pixels/*  one object per slice
//                              .scanlab/mirror/volume/*  the decimated CT stacks
//   npm run mirror:upload  ->  this script: staging dir -> R2
//
// The read side is lib/dataset/mirror.ts, which GETs these keys through the
// DATASET binding in wrangler.jsonc. So the key layout is not something this
// script invents: it is whatever path the export/render scripts wrote under the
// staging dir, and `mirrorKeys` in mirror.ts is the single place that decides
// what those paths are. This script's only job on that front is to not corrupt
// them on the way out — see `toObjectKey`.
//
// Why the S3 API rather than wrangler
// -----------------------------------
// `wrangler r2 object put` is one process per object. The mirror is tens of
// thousands of objects, which makes that tens of thousands of Node startups —
// hours of wall clock spent on spawn alone, and no way to run them in parallel
// without spawning tens of thousands of processes. R2's S3-compatible endpoint
// takes the same objects over a handful of keep-alive sockets.
//
// Why SigV4 is hand-rolled here
// -----------------------------
// The alternative is @aws-sdk/client-s3: several MB of transitive dependencies
// added to a repo whose deployed artifact has a 3 MiB compressed budget.
// Nothing in the Worker would import it, but it would still sit in
// package.json, in the lockfile, and in every `npm ci` on the Cloudflare
// builder. A single-part PUT needs one HMAC chain and one canonical string,
// and node:crypto has both — so this file has no dependencies at all.
//
// The signing helpers are exported rather than inlined for one reason: a wrong
// signature is a 403 with an opaque body, and that is the only failure mode
// here that cannot be diagnosed by reading the error. Exported, it can be
// checked against a known-good signature without a bucket to talk to.

import { createHash, createHmac } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "[mirror-upload]";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------ */

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

/**
 * R2 has no regions, but SigV4's credential scope has a region slot that is
 * part of the signing key, so writer and service have to agree on a value.
 * Cloudflare's documented value for the S3 API is "auto"; anything else derives
 * a different kSigning and fails as SignatureDoesNotMatch, not as a bad region.
 */
const REGION = "auto";

/** SHA-256 of the empty string — every HEAD this script sends has no body. */
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

/**
 * The extension decides the content type because the reader recovers it the
 * same way: `mirrorKeys.pixels` puts the extension in the key precisely so a
 * chest JPEG copied byte-for-byte and a rendered PNG reslice can share one key
 * scheme. Getting this wrong is not fatal — mirror.ts sets its own
 * Content-Type on the way out — but `wrangler r2 object get` and the R2
 * dashboard both show what was stored, and octet-stream PNGs make that
 * needlessly confusing.
 */
const CONTENT_TYPE_BY_EXT = {
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bin": "application/octet-stream",
};
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * A file `X` may be accompanied by `X.meta.json`, whose entries become
 * `x-amz-meta-*` headers on X's PUT and reappear as `customMetadata` on the
 * binding side. The sidecar is never uploaded as an object of its own.
 *
 * This exists for exactly one consumer today: the CT 3-D volume. Its body is
 * deliberately headerless raw voxels, so `dims`, `spacing` and `window` have to
 * travel beside the bytes — `serveMirroredVolume` 422s without all three.
 */
const META_SUFFIX = ".meta.json";

/** Per-object attempts, including the first. */
const MAX_ATTEMPTS = 4;

/** How often to print progress when stdout is not a TTY (a CI log). */
const PROGRESS_EVERY = 250;

const DEFAULTS = {
  dir: ".scanlab/mirror",
  bucket: "vedh-medical-imaging-dataset",
  concurrency: 32,
};

/* ---------------------------------------------------------------------------
 * Errors
 *
 * Three kinds, because the retry policy is a function of which one it is:
 *  - HttpError      R2 answered. Retryable only for 429 and 5xx.
 *  - MirrorError    something is wrong locally (unreadable sidecar, short
 *                   read). Retrying re-reads the same bad state, so never.
 *  - anything else  a thrown fetch, i.e. DNS/TLS/socket. Always retryable.
 * ------------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, statusText, body) {
    super(`HTTP ${status} ${statusText}${body ? ` — ${body}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

class MirrorError extends Error {
  constructor(message) {
    super(message);
    this.name = "MirrorError";
  }
}

/* ---------------------------------------------------------------------------
 * SigV4
 *
 * Exported so it can be signed off against a reference implementation. The
 * shape here is deliberately narrow: path-style S3, no query string, no
 * multipart, single-chunk signed payload.
 * ------------------------------------------------------------------------ */

const hmac = (key, data) => createHmac("sha256", key).update(data, "utf8").digest();
const sha256Hex = (data) => createHash("sha256").update(data, "utf8").digest("hex");

/**
 * Percent-encodes one path segment per RFC 3986.
 *
 * `encodeURIComponent` is *almost* right: it leaves the unreserved set alone as
 * required, but it also leaves `! * ' ( )` raw, and those are reserved in 3986.
 * S3 encodes them, so a key containing any of them signs to a different
 * canonical URI in the two implementations and the request 403s. Rare in this
 * mirror — ids are hex — but a filename copied out of a dataset is not something
 * this script gets to assume anything about.
 *
 * Only ever called per segment, so `/` survives as a separator instead of
 * becoming %2F. And exactly once: S3 is the documented exception to SigV4's
 * double-encoding rule.
 */
export function encodeRfc3986(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `bucket/some/key.png` -> `/bucket/some/key.png`, each segment encoded. */
export function encodeObjectPath(bucket, key) {
  return `/${[bucket, ...key.split("/")].map(encodeRfc3986).join("/")}`;
}

/**
 * Canonical header value: trimmed, with internal whitespace runs collapsed.
 *
 * Applied to the value that actually goes on the wire too, not just to the
 * copy inside the canonical request. Undici sends header values verbatim, so
 * collapsing only on the signing side would mean signing a string the server
 * never sees — a 403 whose cause is two spaces in a metadata value.
 */
export function canonicalHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

/** `20260902T013200Z`. Seconds resolution, which is what SigV4 specifies. */
export function amzTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/**
 * Signs one path-style S3 request and returns the headers to send.
 *
 * `canonicalRequest` and `stringToSign` come back with them on purpose. R2
 * answers a signing mistake with `SignatureDoesNotMatch` and nothing else
 * usable, so the only way to find the mistake is to read the two strings that
 * produced the signature — which is also what makes this function testable.
 *
 * `host` is signed but deliberately not returned in `headers`: undici owns the
 * Host header and rejects an explicit one. Signing it is mandatory (S3 requires
 * host in SignedHeaders), and the value is safe to predict because the runtime
 * derives it from the same URL this function is given.
 *
 * `content-length` is intentionally *not* signed either. It is not required to
 * be, and undici sets it itself — signing a value the transport also computes
 * turns any disagreement into an opaque 403.
 */
export function signS3Request({
  method,
  bucket,
  key,
  host,
  headers = {},
  payloadSha256,
  accessKeyId,
  secretAccessKey,
  amzDate,
}) {
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = encodeObjectPath(bucket, key);

  // Lowercased and sorted, per spec. The caller's headers come first so a
  // caller cannot accidentally shadow the three this function owns.
  const toSign = new Map();
  for (const [name, value] of Object.entries(headers)) {
    toSign.set(name.toLowerCase(), canonicalHeaderValue(value));
  }
  toSign.set("host", canonicalHeaderValue(host));
  toSign.set("x-amz-content-sha256", payloadSha256);
  toSign.set("x-amz-date", amzDate);

  const names = [...toSign.keys()].sort();
  const canonicalHeaders = names.map((n) => `${n}:${toSign.get(n)}\n`).join("");
  const signedHeaders = names.join(";");

  // The empty line between the query string and the headers is the (absent)
  // query string; the one after the header block is required by the spec even
  // though every header line already ends in \n.
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join("\n");

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const sendHeaders = {};
  for (const name of names) {
    if (name === "host") continue;
    sendHeaders[name] = toSign.get(name);
  }
  sendHeaders.authorization =
    `${ALGORITHM} Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { headers: sendHeaders, canonicalRequest, stringToSign, signature, canonicalUri };
}

/* ---------------------------------------------------------------------------
 * Config
 * ------------------------------------------------------------------------ */

const CREDENTIAL_HELP = `Create an S3-compatible key pair in the Cloudflare dashboard:
  R2 > Manage API tokens > Create API token
  Permission "Object Read & Write", scoped to the bucket you are uploading to.
CF_ACCOUNT_ID is the hex id in the dashboard URL, and is also the first label of
the S3 endpoint shown on the bucket's settings page.

Then, in the shell you run this from:
  PowerShell   $env:CF_ACCOUNT_ID="..."; $env:R2_ACCESS_KEY_ID="..."; $env:R2_SECRET_ACCESS_KEY="..."
  bash         export CF_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...`;

/**
 * Same trick `scripts/dataset-index.ts` uses: this runs outside the Next.js
 * process, so nothing has loaded `.env.local` for us. Reading it here is what
 * lets the R2 keys live in the one file this repo already gitignores instead of
 * in a shell history. Real environment variables win, so CI is unaffected.
 *
 * Resolved against the repo root rather than cwd because, unlike dataset-index,
 * this script is also a plausible thing to run from another directory.
 *
 * A real environment variable wins only if it is non-empty. PowerShell 5.1 keeps
 * `$env:R2_ACCESS_KEY_ID=""` as a defined variable, and treating that as
 * authoritative would report a missing credential while `.env.local` sits there
 * holding it. `scripts/load-env-local.ts` carries the same rule for the same
 * reason.
 */
async function loadDotEnvLocal() {
  const file = resolve(repoRoot, ".env.local");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * `strict: false` is the --dry-run path: enumerating the staging dir is useful
 * before any key exists, so missing credentials are reported as `null` there
 * instead of aborting.
 */
function loadConfig({ strict }) {
  const accountId = process.env.CF_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim() || DEFAULTS.bucket;

  const missing = [
    ["CF_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    if (!strict) return { bucket, credentials: null, missing };
    const plural = missing.length === 1 ? "is not set" : "are not set";
    throw new MirrorError(
      `${missing.join(", ")} ${plural}.\n\n${CREDENTIAL_HELP}\n\n` +
        "Or run with --dry-run to check the staging directory without credentials.",
    );
  }

  // Path-style, not virtual-host style: R2's endpoint is per *account*, and the
  // bucket is the first path segment. A virtual-host URL would need a DNS name
  // that does not exist.
  const host = `${accountId}.r2.cloudflarestorage.com`;
  return {
    bucket,
    host,
    endpoint: `https://${host}`,
    credentials: { accessKeyId, secretAccessKey },
    missing: [],
  };
}

/* ---------------------------------------------------------------------------
 * Arguments
 * ------------------------------------------------------------------------ */

const USAGE = `${TAG} upload a staging mirror directory to Cloudflare R2.

  node scripts/mirror-upload.mjs [options]
  npm run mirror:upload -- [options]     (the -- is what gets flags past npm)

  --dir <path>       Directory to upload (default ${DEFAULTS.dir}).
                     Relative paths resolve against the repo root.
  --concurrency <n>  Uploads in flight (default ${DEFAULTS.concurrency}).
  --force            Re-upload every object, even ones already in the bucket at
                     the same size. Use after changing an object's *contents*
                     without changing its length.
  --dry-run          List what would be uploaded, then exit 0. Needs no
                     credentials. Uploads nothing.
  -h, --help         This text.

Environment:
  CF_ACCOUNT_ID         Cloudflare account id; the R2 endpoint is
                        https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID      R2 API token access key id.
  R2_SECRET_ACCESS_KEY  R2 API token secret.
  R2_BUCKET             Bucket name (default ${DEFAULTS.bucket}).

Read from .env.local if present, so the keys can live there instead of in a
shell. Real environment variables take precedence.`;

/**
 * Unknown flags are a hard error rather than a warning. This script's whole
 * risk profile is "issues tens of thousands of writes"; a typo'd `--forse` that
 * silently means "not forced" is cheap, but a typo'd `--dry-runn` that silently
 * means "actually upload" is not.
 */
export function parseArgs(argv) {
  const options = { ...DEFAULTS, force: false, dryRun: false, help: false };

  const takeValue = (flag, inline, next) => {
    const value = inline ?? next;
    if (value === undefined || value.startsWith("--")) {
      throw new MirrorError(`${flag} needs a value.`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    switch (flag) {
      case "--dir":
        options.dir = takeValue(flag, inline, argv[eq === -1 ? ++i : i]);
        break;
      case "--concurrency": {
        const raw = takeValue(flag, inline, argv[eq === -1 ? ++i : i]);
        const n = Number(raw);
        // Capped because each slot is one undici socket to a single origin;
        // past a few hundred the bottleneck moves from R2 to local sockets and
        // 429s start costing more than the parallelism gains.
        if (!Number.isInteger(n) || n < 1 || n > 512) {
          throw new MirrorError(`--concurrency must be an integer from 1 to 512, got ${JSON.stringify(raw)}.`);
        }
        options.concurrency = n;
        break;
      }
      case "--force":
        options.force = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new MirrorError(`Unknown argument ${JSON.stringify(arg)}.\n\n${USAGE}`);
    }
  }

  return options;
}

/* ---------------------------------------------------------------------------
 * Walking the staging directory
 * ------------------------------------------------------------------------ */

export function contentTypeFor(name) {
  return CONTENT_TYPE_BY_EXT[extname(name).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

/**
 * Relative path -> R2 key, with forward slashes on every platform.
 *
 * This is the one line where Windows could quietly ruin the whole mirror.
 * `path.relative` returns `pixels\ab12\cd34\0.png` here, and R2 would accept
 * that as a key — a single flat object with backslashes in its name. Nothing
 * would error; the reader asks for `pixels/ab12/cd34/0.png` (see
 * `mirrorKeys.pixels`), gets a miss, and every slice renders as the "image not
 * mirrored" tile. So the separator is normalised, and then asserted.
 */
export function toObjectKey(root, absPath) {
  const key = relative(root, absPath).split(sep).join("/");
  // `!key` is the root path itself. The walker cannot produce it — it only ever
  // passes files found *inside* the root — but an empty key would sign and send
  // `PUT /<bucket>/`, a bucket-level request, so it is refused here rather than
  // left to the caller's discipline.
  if (!key || key.includes("\\") || key.startsWith("/") || key.includes("..")) {
    throw new MirrorError(`Refusing to upload ${absPath}: it produced the unusable key ${JSON.stringify(key)}.`);
  }
  return key;
}

/**
 * Reads `X.meta.json` into the `x-amz-meta-*` values for X.
 *
 * Strict about types on purpose. A header can only carry a string, so an array
 * `[128,128,128]` would go out as `128,128,128` and read back as a plausible
 * `dims` — while an object would go out as `[object Object]`. Numbers and
 * booleans have one unambiguous rendering, so those are coerced; anything
 * structured is refused with the file named, because a wrong `dims` puts a
 * wrongly-shaped volume on screen rather than failing.
 */
async function readMetadataSidecar(file) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new MirrorError(`${file} is not readable JSON: ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MirrorError(`${file} must contain a flat JSON object of string values.`);
  }

  const metadata = {};
  for (const [rawName, rawValue] of Object.entries(parsed)) {
    // Lowercased because HTTP header names are case-insensitive and R2 hands
    // the binding back a lowercased key. `serveMirroredVolume` reads
    // `meta.dims`, so a sidecar written with `"Dims"` would arrive as `dims`
    // anyway — doing it here makes that explicit instead of accidental.
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      throw new MirrorError(`${file}: ${JSON.stringify(rawName)} is not usable in an x-amz-meta-* header name.`);
    }
    if (rawValue !== null && typeof rawValue === "object") {
      throw new MirrorError(
        `${file}: ${JSON.stringify(rawName)} must be a string, number or boolean — got ${Array.isArray(rawValue) ? "an array" : "an object"}.`,
      );
    }
    const value = canonicalHeaderValue(rawValue ?? "");
    // Non-ASCII in a header value is either rejected by undici or silently
    // mangled by an intermediary, and either way the signature no longer
    // matches the bytes on the wire.
    if (!/^[\x20-\x7E]*$/.test(value)) {
      throw new MirrorError(`${file}: value of ${JSON.stringify(rawName)} has characters that cannot go in an HTTP header.`);
    }
    metadata[name] = value;
  }
  return metadata;
}

/**
 * Enumerates every object to upload, depth-first, sorted, with its size,
 * content type and any sidecar metadata already resolved.
 *
 * Sidecars are matched per directory rather than through a global index,
 * because "sibling of X" is the whole contract — that keeps an orphaned
 * `X.meta.json` (X deleted, or a render that died between the two writes)
 * detectable exactly where it happens, and it is worth reporting: the volume
 * route 422s without its metadata.
 */
export async function collectObjects(root) {
  const objects = [];
  const warnings = [];
  await collectDir(root, root, objects, warnings);
  return { objects, warnings };
}

async function collectDir(dir, root, objects, warnings) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const subdirs = [];
  const files = [];
  const sidecars = new Map();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // A dot-directory under the staging tree is scratch space, not keys:
      // mirror-render.ts writes each object to `.render-tmp/w-<pid>` and renames
      // it into place, so a run that was killed can leave one truncated file
      // there. Uploading it would publish a corrupt object under a key nothing
      // reads. Reported rather than skipped in silence — a stale one means a
      // render died.
      if (entry.name.startsWith(".")) {
        warnings.push(`skipped ${join(dir, entry.name)}/ — a dot-directory is render scratch space, not mirror keys.`);
        continue;
      }
      subdirs.push(entry.name);
    } else if (!entry.isFile()) {
      // Sockets, FIFOs, dangling links. Never expected under a staging dir
      // this project generates, so say so rather than skipping in silence.
      warnings.push(`skipped ${join(dir, entry.name)} — not a regular file.`);
    } else if (entry.name.endsWith(META_SUFFIX)) {
      sidecars.set(entry.name, join(dir, entry.name));
    } else {
      files.push(entry.name);
    }
  }

  // Sizes come from stat because readdir cannot supply them. Issued together
  // per directory: a series directory holds hundreds of slices, and awaiting
  // each stat in turn is what makes a naive walk of this tree take minutes.
  const stats = await Promise.all(files.map((name) => stat(join(dir, name))));

  for (const [i, name] of files.entries()) {
    const absPath = join(dir, name);
    const sidecar = sidecars.get(`${name}${META_SUFFIX}`);
    if (sidecar) sidecars.delete(`${name}${META_SUFFIX}`);
    objects.push({
      absPath,
      key: toObjectKey(root, absPath),
      size: stats[i].size,
      contentType: contentTypeFor(name),
      metadata: sidecar ? await readMetadataSidecar(sidecar) : {},
      hasMetadata: Boolean(sidecar),
    });
  }

  for (const orphan of sidecars.values()) {
    warnings.push(`${orphan} has no sibling object — it was not uploaded, and nothing carries its metadata.`);
  }

  for (const name of subdirs) await collectDir(join(dir, name), root, objects, warnings);
}

/* ---------------------------------------------------------------------------
 * Transfer
 * ------------------------------------------------------------------------ */

/**
 * Reads a file into a Buffer while hashing it, in one pass.
 *
 * A signed single-part PUT needs the payload hash *before* the body goes out,
 * and the body has to be a Buffer: a stream body makes undici use chunked
 * transfer encoding, which SigV4 treats as an entirely different (aws-chunked)
 * signing scheme. Hashing during the same read that fills the buffer is what
 * makes the two provably describe the same bytes — hash it separately and a
 * file rewritten in between produces a signature for bytes that were never
 * sent, which R2 reports only as an opaque mismatch.
 *
 * The size check is the other half of that. `--dry-run` and the resume HEAD
 * both work off the stat size; if the read comes up short, the digest matches
 * the truncated bytes perfectly and R2 stores a truncated object without
 * complaint. Refusing here is the difference between a failure and a corrupt
 * mirror.
 */
async function readAndHash(absPath, expectedSize) {
  const hash = createHash("sha256");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of createReadStream(absPath)) {
    hash.update(chunk);
    chunks.push(chunk);
    bytes += chunk.length;
  }
  if (bytes !== expectedSize) {
    throw new MirrorError(
      `${absPath} read ${bytes} bytes but its directory entry said ${expectedSize}. ` +
        "Is a mirror:export / mirror:render still writing? Re-run once it has finished.",
    );
  }
  return {
    body: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, bytes),
    sha256: hash.digest("hex"),
  };
}

/* ---------------------------------------------------------------------------
 * Integrity
 * ------------------------------------------------------------------------ */

/** An 8-byte PNG signature and its IEND chunk type; JPEG's SOI and EOI. */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TAIL = Buffer.from("IEND", "ascii");
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_TAIL = Buffer.from([0xff, 0xd9]);

/**
 * How far back from the end the closing marker may sit.
 *
 * Wide enough that a legitimate file with a trailer after its final marker — an
 * appended thumbnail, an encoder's padding — still passes, because a raster
 * object is a byte-for-byte copy of a dataset file and a *false* refusal is the
 * one failure this check cannot recover from: re-rendering would copy the same
 * bytes and fail again. Truncation cannot hide in here regardless. The marker is
 * the last thing an encoder writes, and JPEG byte-stuffs `FF` inside scan data,
 * so an unfinished file does not end in one by accident.
 */
const TRAILER_WINDOW = 4096;

/**
 * Refuses a half-written image, using the buffer that is already in hand.
 *
 * `mirror-render` writes to `.render-tmp/w-<pid>` and renames into place, so an
 * interrupted render now leaves either a whole object or none. Runs from before
 * that existed had no such guarantee, and a short file survives every later
 * check: the render's `has()` skips any non-empty file, and `readAndHash` above
 * only proves the bytes on the wire are the bytes on disk — which a truncated
 * file satisfies perfectly.
 *
 * So this is the last gate. Publishing a truncated slice puts a half-drawn image
 * of a real patient's scan on the deployed viewer, and nothing downstream can
 * tell; refusing costs one object and prints the command that fixes it.
 *
 * The trailer is looked for in the last few KB rather than exactly at the end,
 * because a raster object is a byte-for-byte copy of a dataset file and some
 * encoders leave padding after the final marker. Truncation still cannot pass —
 * the marker is the last thing an encoder writes.
 *
 * Only these two containers. `.bin` volumes and JSON bodies have no trailer, and
 * a heuristic for them would trade a real guarantee for a guess.
 */
export function assertIntactImage(object, body) {
  const dot = object.key.lastIndexOf(".");
  const ext = dot === -1 ? "" : object.key.slice(dot + 1).toLowerCase();
  const png = ext === "png";
  if (!png && ext !== "jpg" && ext !== "jpeg") return;

  const head = png ? PNG_HEAD : JPEG_HEAD;
  const tail = png ? PNG_TAIL : JPEG_TAIL;
  const starts = body.length >= head.length && body.subarray(0, head.length).equals(head);
  const ends = body.subarray(Math.max(0, body.length - TRAILER_WINDOW)).includes(tail);
  if (starts && ends) return;

  const what = starts ? "has no closing marker at its end" : `does not start like a ${png ? "PNG" : "JPEG"}`;
  throw new MirrorError(
    `${object.key} ${what} — ${body.length} bytes on disk, so it is not a complete image.\n` +
      "       A render killed before atomic writes existed can leave a file like this, and nothing re-reads it.\n" +
      `       Fix it with:  npm run mirror:render -- --studies ${object.key.split("/")[1] ?? "<studyId>"} --force`,
  );
}

/** R2's errors are short XML documents; the useful part is always near the front. */
async function errorBody(res) {
  try {
    return (await res.text()).trim().replace(/\s+/g, " ").slice(0, 800);
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Exponential, with jitter. The jitter is not decoration: 32 workers that hit
 * the same rate limit at the same moment would otherwise all come back at the
 * same moment and be limited again in lockstep.
 */
function backoffMs(attempt) {
  const base = Math.min(400 * 2 ** (attempt - 1), 8000);
  return base + Math.random() * base * 0.5;
}

/**
 * 429 and 5xx are worth another attempt; every other 4xx is a fact about the
 * request that will not change on its own — a bad signature, a missing bucket,
 * metadata R2 rejects — and retrying it three more times only delays the
 * message that says what is wrong. A thrown fetch never reached R2 at all
 * (DNS, TLS, socket reset), so those are retried.
 */
function isRetryable(error) {
  if (error instanceof MirrorError) return false;
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return true;
}

async function withRetries(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
      await sleep(backoffMs(attempt));
    }
  }
}

function objectUrl(config, key) {
  return `${config.endpoint}${encodeObjectPath(config.bucket, key)}`;
}

/**
 * The URL is built from the same encoder as the canonical URI, not from
 * `new URL(base + key)`. If the two disagreed by one character the request
 * would be signed for a path other than the one it is sent to.
 */
function signedFetchArgs(config, { method, key, headers, payloadSha256 }) {
  const signed = signS3Request({
    method,
    bucket: config.bucket,
    key,
    host: config.host,
    headers,
    payloadSha256,
    accessKeyId: config.credentials.accessKeyId,
    secretAccessKey: config.credentials.secretAccessKey,
    amzDate: amzTimestamp(),
  });
  return { url: objectUrl(config, key), signed };
}

/**
 * `null` means "not in the bucket". Anything else is its stored length.
 *
 * Signed fresh on every call, which matters because these run inside
 * `withRetries`: a SigV4 signature is only accepted within 15 minutes of its
 * x-amz-date, and a queue of 50,000 objects plus backoff can outlive a
 * signature computed once up front.
 */
async function headObject(config, key) {
  const { url, signed } = signedFetchArgs(config, {
    method: "HEAD",
    key,
    headers: {},
    payloadSha256: EMPTY_PAYLOAD_SHA256,
  });
  const res = await fetch(url, { method: "HEAD", headers: signed.headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(res.status, res.statusText, await errorBody(res));
  const length = Number(res.headers.get("content-length"));
  return { size: Number.isFinite(length) ? length : -1 };
}

async function putObject(config, object, body, payloadSha256) {
  const headers = { "content-type": object.contentType };
  for (const [name, value] of Object.entries(object.metadata)) {
    headers[`x-amz-meta-${name}`] = value;
  }

  const { url, signed } = signedFetchArgs(config, {
    method: "PUT",
    key: object.key,
    headers,
    payloadSha256,
  });
  const res = await fetch(url, { method: "PUT", headers: signed.headers, body });
  if (!res.ok) throw new HttpError(res.status, res.statusText, await errorBody(res));

  // A successful PUT returns an empty body. Reading it anyway releases the
  // socket back to undici's pool immediately, which is the difference between
  // reusing 32 connections and opening one per object.
  await res.arrayBuffer().catch(() => {});
}

/* ---------------------------------------------------------------------------
 * Progress
 * ------------------------------------------------------------------------ */

function formatBytes(n) {
  // Rounded rather than passed through, because this formats a transfer *rate*
  // as well as byte counts. A rate is fractional, and an unrounded one prints as
  // "91.74311926605505 B/s" — which on a TTY also makes the line jump around in
  // width from frame to frame.
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * One updating line on a TTY, a line every PROGRESS_EVERY objects otherwise.
 * The second mode exists because `\r` in a CI log produces one enormous line
 * that no log viewer will render.
 *
 * Rate is measured over uploaded bytes only, while the completion fraction
 * counts skipped bytes as done. That asymmetry is deliberate: on a resumed run
 * most objects are skipped in milliseconds, and folding those bytes into the
 * rate would print a transfer speed of several GB/s and an ETA of zero right
 * up until the first real upload.
 */
function createProgress({ totalObjects, totalBytes }) {
  const startedAt = Date.now();
  const tty = Boolean(process.stdout.isTTY);
  let done = 0;
  let uploadedBytes = 0;
  let skippedBytes = 0;
  let lastPrintAt = 0;
  let lastWidth = 0;

  const render = () => {
    const elapsed = Date.now() - startedAt;
    const bytesDone = uploadedBytes + skippedBytes;
    const rate = elapsed > 0 ? uploadedBytes / (elapsed / 1000) : 0;
    const remaining = Math.max(totalBytes - bytesDone, 0);
    const eta = rate > 0 ? formatDuration((remaining / rate) * 1000) : "unknown";
    return (
      `${TAG} ${done}/${totalObjects} objects  ` +
      `${formatBytes(bytesDone)}/${formatBytes(totalBytes)}  ` +
      `${formatBytes(rate)}/s  ETA ${eta}`
    );
  };

  const print = (force) => {
    const now = Date.now();
    if (tty) {
      if (!force && now - lastPrintAt < 100) return;
      const text = render();
      // Pad to the previous width so a shrinking line does not leave the tail
      // of the old one behind.
      process.stdout.write(`\r${text.padEnd(lastWidth)}`);
      lastWidth = text.length;
    } else {
      if (!force && done % PROGRESS_EVERY !== 0) return;
      process.stdout.write(`${render()}\n`);
    }
    lastPrintAt = now;
  };

  return {
    startedAt,
    uploaded(bytes) {
      done++;
      uploadedBytes += bytes;
      print(false);
    },
    skipped(bytes) {
      done++;
      skippedBytes += bytes;
      print(false);
    },
    failed() {
      done++;
      print(true);
    },
    finish() {
      if (tty && lastWidth) process.stdout.write(`\r${"".padEnd(lastWidth)}\r`);
      return { uploadedBytes, skippedBytes, elapsed: Date.now() - startedAt };
    },
  };
}

/* ---------------------------------------------------------------------------
 * The pool
 * ------------------------------------------------------------------------ */

/**
 * N workers pulling from one shared cursor, rather than N slices of the list.
 * Object sizes here span four orders of magnitude (a 300-byte report JSON next
 * to a 3 MB reslice), so fixed slices would leave most workers idle waiting for
 * whichever one drew the heavy directory.
 *
 * `items[cursor++]` looks like a race and is not: the read and the increment
 * happen in one synchronous step, and nothing between them yields.
 */
async function runPool(items, concurrency, handler) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      await handler(items[cursor++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * HEAD-then-PUT for one object, or a skip.
 *
 * Length is the whole resume test. R2 would also hand back an ETag, but for a
 * single-part PUT that is the MD5 of the body, and computing MD5 for every
 * local file to compare would cost a full re-read of the staging directory —
 * which is most of the work this skip is meant to avoid. Length catches the case
 * that actually happens (an interrupted run) and misses only a rewrite that
 * kept the byte count identical, which is what --force is for.
 *
 * The retry wraps the read as well as the requests, so a retried attempt
 * re-reads the file and re-hashes it rather than re-sending a payload whose
 * hash was computed minutes earlier.
 */
async function transferOne(config, object, force) {
  return withRetries(async () => {
    if (!force) {
      const existing = await headObject(config, object.key);
      if (existing && existing.size === object.size) return "skipped";
    }
    const { body, sha256 } = await readAndHash(object.absPath, object.size);
    assertIntactImage(object, body);
    await putObject(config, object, body, sha256);
    return "uploaded";
  });
}

async function uploadAll(config, objects, options) {
  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
  const progress = createProgress({ totalObjects: objects.length, totalBytes });
  const failures = [];
  let uploaded = 0;
  let skipped = 0;

  // The handler swallows its own errors on purpose. Letting one rejection out
  // would settle Promise.all while the other workers keep uploading, and the
  // summary would then be written over a run that is still in flight.
  await runPool(objects, options.concurrency, async (object) => {
    try {
      if ((await transferOne(config, object, options.force)) === "skipped") {
        skipped++;
        progress.skipped(object.size);
      } else {
        uploaded++;
        progress.uploaded(object.size);
      }
    } catch (error) {
      failures.push({
        key: object.key,
        status: error instanceof HttpError ? error.status : undefined,
        message: error.message,
      });
      progress.failed();
    }
  });

  return { uploaded, skipped, failures, totalBytes, ...progress.finish() };
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------ */

function printDryRun(objects, config) {
  const keyWidth = Math.min(Math.max(...objects.map((o) => o.key.length), 3), 72);
  for (const object of objects) {
    const meta = object.hasMetadata ? `  meta: ${Object.keys(object.metadata).join(",")}` : "";
    console.log(
      `  ${object.key.padEnd(keyWidth)}  ${formatBytes(object.size).padStart(10)}  ${object.contentType}${meta}`,
    );
  }

  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
  console.log(`${TAG} would upload ${objects.length} objects, ${formatBytes(totalBytes)} to bucket ${config.bucket}.`);
}

/**
 * Prints the exact canonical request and string-to-sign for one real object.
 *
 * A SignatureDoesNotMatch from R2 says nothing about *what* differed, so the
 * only way to debug one is to read these two strings and compare them against
 * the AWS spec line by line. The object is read and hashed for real so the
 * preview is the request that would actually go out, not an approximation of it.
 */
async function printSignaturePreview(config, object) {
  const { sha256 } = await readAndHash(object.absPath, object.size);
  const headers = { "content-type": object.contentType };
  for (const [name, value] of Object.entries(object.metadata)) {
    headers[`x-amz-meta-${name}`] = value;
  }

  const signed = signS3Request({
    method: "PUT",
    bucket: config.bucket,
    key: object.key,
    host: config.host,
    headers,
    payloadSha256: sha256,
    accessKeyId: config.credentials.accessKeyId,
    secretAccessKey: config.credentials.secretAccessKey,
    amzDate: amzTimestamp(),
  });

  console.log(`\n${TAG} signature preview for ${object.key}`);
  console.log(`  PUT ${objectUrl(config, object.key)}`);
  console.log("\n--- canonical request ---");
  console.log(signed.canonicalRequest);
  console.log("--- string to sign ---");
  console.log(signed.stringToSign);
  console.log("--- authorization ---");
  console.log(signed.headers.authorization);
  console.log();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  await loadDotEnvLocal();
  const config = loadConfig({ strict: !options.dryRun });

  const dir = resolve(repoRoot, options.dir);
  const dirStat = await stat(dir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new MirrorError(
      `${dir} is not a directory.\n` +
        "Build the staging mirror first (`npm run mirror:export`, `npm run mirror:render`), or point --dir at it.",
    );
  }

  const { objects, warnings } = await collectObjects(dir);
  for (const warning of warnings) console.warn(`${TAG} WARNING: ${warning}`);

  if (!objects.length) {
    console.log(`${TAG} ${dir} contains no files — nothing to upload.`);
    return 0;
  }

  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);

  if (options.dryRun) {
    printDryRun(objects, config);
    if (config.credentials) {
      await printSignaturePreview(config, objects[0]);
    } else {
      console.log(`${TAG} ${config.missing.join(", ")} not set, so no signature preview — listing only.`);
    }
    return 0;
  }

  console.log(
    `${TAG} ${objects.length} objects, ${formatBytes(totalBytes)} -> ` +
      `${config.endpoint}/${config.bucket} (concurrency ${options.concurrency}${options.force ? ", forced" : ""})`,
  );

  const result = await uploadAll(config, objects, options);

  console.log(
    `${TAG} done in ${formatDuration(result.elapsed)} — ` +
      `uploaded ${result.uploaded} (${formatBytes(result.uploadedBytes)}), ` +
      `skipped ${result.skipped} (${formatBytes(result.skippedBytes)}), ` +
      `failed ${result.failures.length}, ` +
      `${formatBytes(result.totalBytes)} in the staging dir.`,
  );

  if (result.failures.length) {
    const shown = result.failures.slice(0, 10);
    console.error(`${TAG} ${result.failures.length} failed. First ${shown.length}:`);
    for (const failure of shown) {
      console.error(`  ${String(failure.status ?? "ERR").padStart(3)}  ${failure.key}\n       ${failure.message}`);
    }
    // Named here because these two are the ones whose cause is not in the
    // message: R2 reports both as a bare code with no explanation. Printed only
    // when one actually occurred — appending a signing hint to a "file shrank
    // mid-run" failure sends the reader after the wrong problem.
    const statuses = new Set(result.failures.map((f) => f.status));
    if (statuses.has(403)) {
      console.error(
        `${TAG} a 403 on every object means the token, the bucket scope, or a clock more than 15 minutes out. ` +
          "`--dry-run` prints the canonical request for the first object.",
      );
    }
    if (statuses.has(400)) {
      console.error(`${TAG} a 400 on the volume objects means R2 rejected the sidecar metadata.`);
    }
    return 1;
  }

  return 0;
}

/**
 * Only runs main() when this file *is* the program. Everything above is
 * importable, which is what allows the signing to be checked against a
 * reference implementation without a bucket, an account, or a key pair.
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return resolve(realpathSync(entry)) === resolve(realpathSync(self));
  } catch {
    return resolve(entry) === resolve(self);
  }
})();

if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (error) {
    // MirrorError messages are written for the person running this; a stack
    // trace on top of them is noise. Anything else gets the stack, because an
    // unexpected throw is a bug in this script.
    console.error(`${TAG} ${error instanceof MirrorError ? error.message : (error.stack ?? error.message)}`);
    process.exitCode = 1;
  }
}
