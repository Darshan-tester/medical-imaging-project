/**
 * ---------------------------------------------------------------------------
 * Precomputes every JSON API response body into the R2 mirror staging tree.
 * ---------------------------------------------------------------------------
 *
 * Run with: npm run mirror:export   (then npm run mirror:render, mirror:upload)
 *
 * Why this exists
 * ---------------
 * `lib/dataset/mirror.ts` documents the runtime side. The short version: a
 * Cloudflare Worker has no filesystem, so `readManifest()` returns undefined
 * there and every dataset surface degrades to "No dataset index has been built
 * yet". Shipping the manifest instead would not help — it is 5.5 MB, and
 * `JSON.parse` of it alone exceeds the Workers Free plan's 10 ms CPU budget for
 * a request.
 *
 * So the deployed app answers from bodies computed here, on the machine that
 * actually has `.scanlab/manifest.json`, and streams them without parsing.
 *
 * The one rule that matters
 * ------------------------
 * Every body is produced by calling the *same* function the local route calls —
 * `toAppStudy`, `toAppStudySummary`, `countByDataset`, `getManifestStatus`,
 * `matchUpload`. Nothing is re-derived here. That is deliberate: a second
 * implementation of the projection would be free to drift, and the failure mode
 * of drift is a deployed site showing different metadata for a study than the
 * local one does, which is indistinguishable from fabricated data at a glance.
 *
 * Reports come straight out of the manifest, verbatim, for all 2,314 studies —
 * including studies whose pixels are left out of the mirror. A report is a few
 * hundred bytes; there is no reason for any of them to be missing.
 *
 * What this script refuses to do
 * ------------------------------
 * Absolute paths never reach a mirrored body. The projections already strip
 * them, but "already" is an assumption with a 5.5 MB blast radius, so
 * `assertNoLocalPaths` re-checks every serialised body for `absPath`,
 * `scanRoot`, a drive-letter path, or the dataset root's name, and aborts the
 * whole export on a hit rather than uploading a leak. See the SERVER-ONLY note
 * in lib/dataset/config.ts.
 */

// Must stay the first import: SCANLAB_CACHE_DIR decides which .scanlab tree is
// read and written, and it lives in .env.local.
import "./load-env-local";

import fs from "fs";
import path from "path";

import { getCacheDir } from "../lib/dataset/config";
import { countByDataset } from "../lib/dataset/counts";
import { MANIFEST_BUILDER_VERSION, getManifestStatus, readManifest } from "../lib/dataset/manifest-store";
import { mirrorKeys } from "../lib/dataset/mirror";
import { toAppStudy, toAppStudySummary } from "../lib/dataset/to-app-study";
import { matchUpload, readUploadIndex, studyCodeFromFileName } from "../lib/dataset/upload-match";
import { DATASET_SOURCE_LABEL, DatasetSourceId } from "../lib/dataset/types";

/* -------------------------------------------------------------------------
 * Upload-match key scheme
 *
 * `/api/uploads/match` is the one route whose mirrored form is not simply a
 * copy of a route body. Locally it calls `matchUpload(sha256, fileName)`, which
 * reads the 3.3 KB upload index *and* resolves the study code against the 5.5 MB
 * manifest — two filesystem reads, one of them far too expensive to parse per
 * request even if Workers had a disk.
 *
 * So the *outcomes* are precomputed instead of the index, sharded one object per
 * lookup key, which turns a match into a single small GET and no parsing of
 * anything large. The keys come from `mirrorKeys` like every other family; the
 * regexes below are the stricter, meaning-carrying check that the segments really
 * are a content hash and a study code before either becomes part of a key.
 * ---------------------------------------------------------------------- */

const SHA256_RE = /^[0-9a-f]{64}$/;
const STUDY_CODE_RE = /^[A-Z][A-Z0-9]{1,7}-[0-9A-F]{6}$/;

/* -------------------------------------------------------------------------
 * CLI
 * ---------------------------------------------------------------------- */

interface Options {
  out: string;
  dryRun: boolean;
  prune: boolean;
}

const USAGE = `Usage: npm run mirror:export -- [options]

Writes the precomputed JSON bodies of every dataset API route into a staging
tree whose layout is exactly the R2 key layout, ready for npm run mirror:upload.

Options:
  --out <dir>     Staging directory. Default: <cache>/mirror  (SCANLAB_CACHE_DIR
                  moves <cache>; it defaults to ./.scanlab)
  --dry-run       Build and validate every body, report the totals, write nothing.
  --no-prune      Keep meta/ objects from an earlier export that this run did not
                  write. Default is to delete them, so a study dropped from the
                  index stops being reachable on the deployed site.
  -h, --help      Show this message.
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = { out: path.join(getCacheDir(), "mirror"), dryRun: false, prune: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--no-prune") {
      opts.prune = false;
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out needs a directory.");
      opts.out = path.resolve(value);
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(arg)}. Run with --help.`);
    }
  }

  return opts;
}

/* -------------------------------------------------------------------------
 * Leak check
 * ---------------------------------------------------------------------- */

/**
 * Patterns that must never appear in a body that is about to be made public.
 *
 * Checked against the *serialised* JSON, not the object graph, because that is
 * what actually gets uploaded — a path hiding in an unexpected field, or inside
 * a string that some projection built by concatenation, still shows up here.
 *
 * `JSON.stringify` escapes a Windows separator, so `D:\ScanLab_Datasets` is the
 * eight characters `D:\\Scan...` in the text; both the escaped and the raw form
 * are matched so this keeps working if a body is ever written some other way.
 */
const LEAK_PATTERNS: [RegExp, string][] = [
  [/"absPath"/, "an absPath field"],
  [/"scanRoot"/, "a scanRoot field"],
  [/ScanLab_Datasets/i, "the dataset root's name"],
  [/[A-Za-z]:\\\\/, "a Windows drive-letter path"],
  [/[A-Za-z]:\//, "a drive-letter path with forward slashes"],
  [/\/sessions\//, "a session mount path"],
];

function assertNoLocalPaths(key: string, json: string): void {
  for (const [pattern, what] of LEAK_PATTERNS) {
    const hit = pattern.exec(json);
    if (!hit) continue;
    const at = Math.max(0, hit.index - 60);
    throw new Error(
      `Refusing to export ${key}: it contains ${what}.\n` +
        `  ...${json.slice(at, hit.index + 90)}...\n` +
        "  A filesystem path must never reach the client. Fix the projection in lib/dataset/, not this check.",
    );
  }
}

/* -------------------------------------------------------------------------
 * Writer
 * ---------------------------------------------------------------------- */

/** One entry per key family, for the summary. Order here is the order printed. */
const FAMILIES = ["meta/datasets", "meta/studies.json", "meta/study/", "meta/report/", "meta/upload-match/", "meta/other"] as const;
type Family = (typeof FAMILIES)[number];

function familyOf(key: string): Family {
  if (key.startsWith("meta/study/")) return "meta/study/";
  if (key.startsWith("meta/report/")) return "meta/report/";
  if (key.startsWith("meta/upload-match/")) return "meta/upload-match/";
  if (key === "meta/studies.json") return "meta/studies.json";
  if (key.startsWith("meta/datasets")) return "meta/datasets";
  return "meta/other";
}

class MirrorWriter {
  readonly counts = new Map<Family, { objects: number; bytes: number }>();
  readonly written = new Set<string>();
  private readonly dirs = new Set<string>();

  constructor(private readonly opts: Options) {}

  /**
   * `NextResponse.json(x)` serialises with a plain `JSON.stringify(x)`, so the
   * mirrored object has to be exactly that — no pretty-printing, no added
   * envelope, no reordered keys. A byte-identical body is what makes the
   * mirrored response indistinguishable from the local one.
   */
  write(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    assertNoLocalPaths(key, json);

    const bytes = Buffer.byteLength(json);
    const family = familyOf(key);
    const tally = this.counts.get(family) ?? { objects: 0, bytes: 0 };
    tally.objects++;
    tally.bytes += bytes;
    this.counts.set(family, tally);
    this.written.add(key);

    if (this.opts.dryRun) return;

    const file = path.join(this.opts.out, key);
    const dir = path.dirname(file);
    if (!this.dirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.dirs.add(dir);
    }
    fs.writeFileSync(file, json);
  }

  total(): { objects: number; bytes: number } {
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
 * Export
 * ---------------------------------------------------------------------- */

function exportMeta(writer: MirrorWriter): { studies: number; reports: number } {
  const manifest = readManifest();
  if (!manifest) {
    throw new Error(
      "No dataset index to export. Run `npm run dataset:index` against SCANLAB_DATA_ROOT first — " +
        "this script reads .scanlab/manifest.json and never touches the dataset itself.",
    );
  }

  if (manifest.builderVersion !== MANIFEST_BUILDER_VERSION) {
    console.warn(
      `! The index was built by version ${manifest.builderVersion}, but this code is at ${MANIFEST_BUILDER_VERSION}.\n` +
        "  Exporting it anyway — the deployed site will then show exactly what the local one shows, stale labels\n" +
        "  included. Re-run `npm run dataset:index` first if that is not what you want.",
    );
  }

  /*
   * `/api/datasets/status` reports the index the app is actually serving, so a
   * stale or missing index shows as a banner rather than looking like "this
   * dataset has no reports". Exported verbatim: rewriting `stale` to `current`
   * here would be lying to the deployed UI.
   */
  writer.write(mirrorKeys.datasetsStatus(), getManifestStatus());

  const perDataset = countByDataset(manifest.studies);
  const ids = Object.keys(perDataset) as DatasetSourceId[];
  writer.write(
    mirrorKeys.datasets(),
    ids.map((id) => ({ dataset: id, label: DATASET_SOURCE_LABEL[id], ...perDataset[id] })),
  );

  // The list projection, all studies, manifest order — `/api/studies` does not
  // sort or filter, and the client does its own sorting.
  writer.write(
    mirrorKeys.studies(),
    manifest.studies.map(toAppStudySummary),
  );

  let reports = 0;
  for (const ds of manifest.studies) {
    // Written and released one at a time: `toAppStudy` expands a series' frame
    // run into one URL per slice, which for the largest MRI study is ~9,600
    // strings. Accumulating 2,314 of those before writing is how this script
    // would run out of heap.
    writer.write(mirrorKeys.study(ds.id), toAppStudy(ds));

    if (ds.report) {
      reports++;
      writer.write(mirrorKeys.report(ds.id), { available: true, report: ds.report });
    } else {
      writer.write(mirrorKeys.report(ds.id), { available: false });
    }
  }

  return { studies: manifest.studies.length, reports };
}

/**
 * Precomputes the outcome of every upload lookup that can succeed.
 *
 * Produced by calling the real `matchUpload`, for the same reason the rest of
 * this script calls the real projections: a reimplementation of the match rules
 * could attach one patient's report to another patient's image, which is the
 * exact failure the report matcher was fixed to avoid.
 *
 * Two shard families, matching the two lookups in `matchUpload`:
 *
 *   by-hash/<sha256>  content match, carries the pack's `sourceLabel`
 *   by-code/<CODE>    filename match, for a file that was renamed or converted
 *
 * A code shard exists for every indexed study, not only the packed ones — the
 * filename path resolves through the manifest and never touches the pack, so it
 * works for any study whose code appears in the uploaded filename.
 *
 * Anything not found by either lookup is `unmatched` at runtime, with the same
 * wording `matchUpload` uses. That branch needs no object.
 */
function exportUploadMatches(writer: MirrorWriter): { hashes: number; codes: number; skipped: string[] } {
  const manifest = readManifest();
  const index = readUploadIndex();
  const skipped: string[] = [];
  let hashes = 0;
  let codes = 0;

  if (index) {
    // Kept as a plain object for debugging coverage — 3.3 KB, and it is the only
    // way to see which slices a pack actually contains without re-running it.
    writer.write(mirrorKeys.uploadIndex(), index);

    for (const entry of index.entries) {
      const sha = entry.sha256?.toLowerCase();
      if (!sha || !SHA256_RE.test(sha)) {
        skipped.push(`upload index entry with unusable sha256 ${JSON.stringify(entry.sha256)}`);
        continue;
      }
      // The real function, with the real filename, so a content hit carries the
      // same `sourceLabel` the local route would return.
      writer.write(mirrorKeys.uploadMatchByHash(sha), matchUpload(sha, entry.fileName ?? ""));
      hashes++;
    }
  } else {
    console.log("- No export pack index (.scanlab/upload-index.json). Skipping by-hash shards; run `npm run demo:pack` to create one.");
  }

  for (const ds of manifest?.studies ?? []) {
    const code = ds.studyCode;
    if (!code || !STUDY_CODE_RE.test(code)) {
      skipped.push(`study ${ds.id} has an unusable studyCode ${JSON.stringify(code)}`);
      continue;
    }
    /*
     * Routed through `studyCodeFromFileName` on the way in so the shard key is
     * derived by the same regex the runtime uses. If the two ever disagree the
     * mismatch surfaces here, at export time, instead of as a silent miss.
     */
    const viaFileName = studyCodeFromFileName(`${code}.png`);
    if (viaFileName !== code) {
      skipped.push(`study code ${code} is not recoverable from a filename by studyCodeFromFileName`);
      continue;
    }
    writer.write(mirrorKeys.uploadMatchByCode(code), matchUpload("", `${code}.png`));
    codes++;
  }

  return { hashes, codes, skipped };
}

/* -------------------------------------------------------------------------
 * Prune
 * ---------------------------------------------------------------------- */

/**
 * Deletes `meta/` objects left over from an earlier export.
 *
 * Without this, a study dropped from the index keeps its `meta/study/<id>.json`
 * in the staging tree, the uploader ships it again, and the deployed site keeps
 * serving a study the current index no longer contains.
 *
 * Scoped to `<out>/meta` and to files this script is responsible for. `pixels/`
 * and `volume/` belong to mirror-render and are never touched here — a render
 * run takes hours and must not be invalidated by a two-second metadata export.
 */
function prune(out: string, written: Set<string>): string[] {
  const root = path.join(out, "meta");
  if (!fs.existsSync(root)) return [];

  const removed: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
        continue;
      }
      const key = path.relative(out, abs).split(path.sep).join("/");
      if (written.has(key)) continue;
      fs.unlinkSync(abs);
      removed.push(key);
    }
  };
  walk(root);
  return removed;
}

/* -------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------- */

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();

  console.log(`Mirror export -> ${opts.out}${opts.dryRun ? "  (dry run, nothing will be written)" : ""}`);

  const writer = new MirrorWriter(opts);
  const meta = exportMeta(writer);
  const uploads = exportUploadMatches(writer);

  const removed = opts.prune && !opts.dryRun ? prune(opts.out, writer.written) : [];

  const nameWidth = Math.max(...FAMILIES.map((f) => f.length));
  console.log("");
  console.log(`${"KEY FAMILY".padEnd(nameWidth)}  OBJECTS      BYTES`);
  for (const family of FAMILIES) {
    const tally = writer.counts.get(family);
    if (!tally) continue;
    console.log(`${family.padEnd(nameWidth)}  ${String(tally.objects).padStart(7)}  ${mb(tally.bytes).padStart(9)}`);
  }
  const total = writer.total();
  console.log("-".repeat(nameWidth + 20));
  console.log(`${"TOTAL".padEnd(nameWidth)}  ${String(total.objects).padStart(7)}  ${mb(total.bytes).padStart(9)}`);

  console.log("");
  console.log(`Studies exported:      ${meta.studies}`);
  console.log(`Real reports exported: ${meta.reports}${meta.reports === meta.studies ? " (every study)" : ` of ${meta.studies}`}`);
  console.log(`Upload-match shards:   ${uploads.hashes} by hash, ${uploads.codes} by study code`);
  if (removed.length) console.log(`Pruned stale objects:  ${removed.length} (${removed.slice(0, 3).join(", ")}${removed.length > 3 ? ", ..." : ""})`);
  for (const s of uploads.skipped.slice(0, 10)) console.log(`! skipped: ${s}`);
  if (uploads.skipped.length > 10) console.log(`! ...and ${uploads.skipped.length - 10} more skips.`);
  console.log(`Elapsed:               ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!opts.dryRun) {
    console.log("");
    console.log("Next: npm run mirror:render   (pixels; needs SCANLAB_DATA_ROOT)");
    console.log("      npm run mirror:upload   (ships this tree to R2)");
  }
}

try {
  main();
} catch (err) {
  console.error(`\nMirror export failed:\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
