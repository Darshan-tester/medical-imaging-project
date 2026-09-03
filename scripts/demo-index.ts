/**
 * Run with: npm run demo:index
 *
 * Writes `public/demo-data/index.json` — the committed index of the real studies
 * that live in this repository under `public/demo-data`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `.scanlab/manifest.json` cannot be deployed. It is gitignored, it holds
 * absolute Windows paths, and the API routes that serve pixels from it call
 * `fs`. The deployed Cloudflare Worker has no filesystem and no
 * `SCANLAB_DATA_ROOT`, so on the deployed site those routes have nothing to
 * read. The result was a UI that fell back to `lib/mock-data.ts` and showed
 * invented MRD-* studies while ~721 MB of real, committed CT / MRI / PET /
 * chest X-ray data sat unused in `public/`.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a second dataset system. Every study below comes out of the real
 * adapters in `lib/dataset/adapters`, unmodified:
 *
 *   CT     → `ctAdapter.scan()`
 *   MRI    → `mriAdapter.scan()`   (reads the committed ZIPs itself)
 *   PET    → `petAdapter.scan()`
 *   X-Ray  → `buildSeriesFromFiles()` from the adapters' own shared module
 *
 * All this script does afterwards is rewrite each series' server-side `absPath`
 * as the public URL of the same bytes, and measure — using the server's own
 * `readNiftiGeometry` and `computeVolumeWindow` — the geometry and display
 * window the browser would otherwise need `fs` and an affine solver for.
 * `lib/demo/expand.ts` turns the result straight back into `DatasetStudy[]`.
 *
 * The image/report pairing is never rebuilt. CT reports come from the adapter;
 * MRI, PET and X-Ray reports are read verbatim out of the `report.json` that is
 * committed in the same folder as the images, which IS the pairing.
 *
 * Writes exactly one file: `public/demo-data/index.json`. Nothing is downloaded,
 * no dataset is rebuilt, and no image bytes are copied, re-encoded or moved.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import * as nifti from "nifti-reader-js";

import { computeVolumeWindow, readNiftiGeometry } from "../lib/dataset/image-render";
import { niftiTypedArray } from "../lib/dataset/nifti-voxels";
import { buildSeriesFromFiles, studyCode } from "../lib/dataset/adapters/shared";
import { stableId } from "../lib/dataset/fs-utils";
import { seriesImageRefs } from "../lib/dataset/series-frames";
import {
  DatasetSeries,
  DatasetStudy,
  StudyReport,
} from "../lib/dataset/types";
import {
  DEMO_INDEX_VERSION,
  DemoIndex,
  DemoOmission,
  DemoPlane,
  DemoPlaneGeometry,
  DemoSeries,
  DemoStudy,
  DemoVolume,
  DemoZipRange,
} from "../lib/demo/types";

/**
 * The repository root.
 *
 * `process.cwd()` when that looks like this package — which is what `npm run`
 * guarantees — and the directory above this file otherwise. The cwd is preferred
 * so the script still finds the repository when it is executed from compiled
 * output that does not sit in `scripts/`.
 */
function findRepoRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "public"))) {
    return cwd;
  }
  return path.resolve(__dirname, "..");
}

const REPO_ROOT = findRepoRoot();
const DEMO_ROOT = path.join(REPO_ROOT, "public", "demo-data");
const OUT_FILE = path.join(DEMO_ROOT, "index.json");

/**
 * The two MRI archives that were deliberately removed from Git: at 46.3 MiB and
 * 35.8 MiB they exceed Cloudflare Workers' 25 MiB per-asset limit, so a build
 * containing them cannot deploy. Their `report.json` is still committed, and
 * they are recorded in the index's `omitted` list with the reason rather than
 * being listed as studies with nothing to open.
 */
const CF_ASSET_LIMIT_BYTES = 25 * 1024 * 1024;

function log(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/** Public URL of a file under `public/`. Backslashes normalized for Windows. */
function publicUrl(absPath: string): string {
  const rel = path.relative(path.join(REPO_ROOT, "public"), absPath);
  return `/${rel.split(path.sep).join("/")}`;
}

function isUnderPublic(absPath: string): boolean {
  const rel = path.relative(path.join(REPO_ROOT, "public"), absPath);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * ---------------------------------------------------------------------------
 * "IS THIS ASSET ACTUALLY GOING TO BE THERE?"
 * ---------------------------------------------------------------------------
 * Being under `public/` is not enough. The deployed Worker serves what the build
 * contains, and the build contains what the repository tracks — so the honest
 * test is `git ls-files`, not `fs.existsSync`.
 *
 * This matters concretely: `IQT6Z5U6WE.zip` (46.3 MiB) and `KNCH35VQQ5.zip`
 * (35.8 MiB) are still present in the working tree but gitignored, because they
 * exceed Cloudflare Workers' 25 MiB per-asset limit. A generator that trusted the
 * filesystem would index all ten MRI studies here and produce two whose every
 * slice 404s on the deployed site. Instead they are recorded in `omitted`, with
 * their measured size as the reason.
 *
 * One `git ls-files` call, not one per file — a CT study alone has 559 slices.
 */
let trackedAssets: Set<string> | undefined;
let trackedAssetsLoaded = false;

function loadTrackedAssets(): void {
  trackedAssetsLoaded = true;
  const run = spawnSync("git", ["ls-files", "-z", "--", "public"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !run.stdout) {
    log("  ! git ls-files failed — falling back to on-disk presence, which cannot");
    log("    tell a committed asset from an ignored one. Verify the index before deploying.");
    return;
  }
  const set = new Set<string>();
  for (const rel of run.stdout.toString("utf-8").split("\0")) {
    if (rel) set.add(path.resolve(REPO_ROOT, rel));
  }
  trackedAssets = set;
}

/** True when this file is under `public/` *and* tracked, i.e. it will exist once deployed. */
function isCommittedAsset(absPath: string): boolean {
  if (!isUnderPublic(absPath)) return false;
  if (!trackedAssetsLoaded) loadTrackedAssets();
  if (!trackedAssets) return fs.existsSync(absPath);
  return trackedAssets.has(path.resolve(absPath));
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Every committed `report.json` in this repository was written with a UTF-8 BOM,
 * which `JSON.parse` rejects outright. Stripping it here rather than in
 * `fs-utils.readTextFileSafe` keeps the CT `.txt` report path — which works —
 * completely untouched.
 */
function readJsonFile(absPath: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(absPath, "utf-8").replace(/^﻿/, "");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// REPORTS — read verbatim from the committed report.json beside the images
// ---------------------------------------------------------------------------

/**
 * MRI and X-Ray `report.json` are already sectioned by the dataset itself
 * (`clinical_information`, `technique`, `findings`, `impression`), and MRI also
 * carries the whole thing as `report`. Both are passed through unchanged: `text`
 * is the verbatim original, and the named sections are the dataset's own.
 */
function sectionedReport(json: Record<string, unknown>, source: string): StudyReport | undefined {
  const findings = str(json.findings);
  const impression = str(json.impression);
  const technique = str(json.technique);
  const clinical = str(json.clinical_information);
  const full = str(json.report);

  // `text` must always hold something, because it is what `parseReportSections`
  // and `extractDemographics` read. With no `report` field, the sections
  // themselves are the report, joined under their own dataset-given headings.
  const text =
    full ??
    [
      clinical ? `Clinical Information: ${clinical}` : undefined,
      technique ? `Technique: ${technique}` : undefined,
      findings ? `Findings: ${findings}` : undefined,
      impression ? `Impression: ${impression}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");

  if (!text) return undefined;
  return { source, text, clinicalInformation: clinical, technique, findings, impression };
}

/**
 * PET reports are two prose fields — `Image description` (what the scan showed)
 * and `Report Diagnosis` (the radiologist's conclusion). Mapping those to
 * Findings and Impression is a faithful relabelling of the dataset's own
 * structure; no wording is altered, summarized or added.
 *
 * `text` is the two fields joined as plain prose rather than under invented
 * FINDINGS:/IMPRESSION: headings, so `parseReportSections` finds no headings,
 * falls through, and the structured fields above are what the UI shows.
 */
function petReport(json: Record<string, unknown>, source: string): StudyReport | undefined {
  const description = str(json["Image description"]);
  const diagnosis = str(json["Report Diagnosis"]);
  const text = [description, diagnosis].filter(Boolean).join("\n\n");
  if (!text) return undefined;
  return { source, text, findings: description, impression: diagnosis };
}

// ---------------------------------------------------------------------------
// ZIP MEMBER RANGES
// ---------------------------------------------------------------------------

/**
 * Byte range of one member's payload inside a ZIP archive.
 *
 * Every entry in the ten committed MRI archives was measured to use method 0
 * (STORED): the `.nii.gz` sits in the archive uncompressed and verbatim, so a
 * `Range` request returns exactly the member's own bytes and the browser needs no
 * zip inflate step. A DEFLATED entry is rejected rather than mis-served — the
 * decoder would be handed a compressed stream and produce noise.
 *
 * The data offset is read from the member's LOCAL header rather than computed
 * from the central directory, because the two are allowed to carry different
 * extra fields and only the local one describes the actual byte layout.
 */
function zipMemberRanges(zipPath: string): Map<string, DemoZipRange> {
  const out = new Map<string, DemoZipRange>();
  const fd = fs.openSync(zipPath, "r");
  try {
    for (const entry of new AdmZip(zipPath).getEntries()) {
      if (entry.isDirectory) continue;
      if (entry.header.method !== 0) continue; // not STORED — see above

      const local = Buffer.alloc(30);
      fs.readSync(fd, local, 0, 30, entry.header.offset);
      if (local.readUInt32LE(0) !== 0x04034b50) continue; // not a local file header

      const nameLen = local.readUInt16LE(26);
      const extraLen = local.readUInt16LE(28);
      out.set(entry.entryName.split("\\").join("/"), {
        off: entry.header.offset + 30 + nameLen + extraLen,
        len: entry.header.size,
      });
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

/** One archive's ranges, plus the URL its members are served from. */
interface ZipHost {
  url: string;
  bytes: number;
  ranges: Map<string, DemoZipRange>;
}

/**
 * Maps an extracted NIfTI path back to the committed archive it came from.
 *
 * `ensureExtracted` unpacks an archive into the cache preserving its internal
 * paths, so `<cache>/<key>/4IJW45J4TC/img/X.nii.gz` came from the entry
 * `4IJW45J4TC/img/X.nii.gz`. Matching on that suffix is what lets the MRI
 * adapter run completely unmodified — it reports cache paths, and nothing has to
 * tell it about `public/`.
 */
function findInZips(absPath: string, hosts: ZipHost[]): { host: ZipHost; range: DemoZipRange } | undefined {
  const normalized = absPath.split(path.sep).join("/");
  for (const host of hosts) {
    for (const [entryName, range] of host.ranges) {
      if (normalized.endsWith(`/${entryName}`)) return { host, range };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// VOLUME MEASUREMENT
// ---------------------------------------------------------------------------

interface NiftiHeaderFields {
  datatypeCode: number;
  scl_slope: number;
  scl_inter: number;
}

/**
 * Everything the browser needs to render any plane of one NIfTI volume, measured
 * here so it never has to be measured there.
 *
 * The geometry comes from `readNiftiGeometry` and the window from
 * `computeVolumeWindow` — the same two functions the server-side renderer uses,
 * imported rather than reimplemented. That is what guarantees a client-decoded
 * demo slice and a server-rendered indexed slice of the same volume look
 * identical, and it is why no modality preset or invented window setting exists
 * on either path.
 */
function measureVolume(absPath: string, url: string, zip?: DemoZipRange): DemoVolume | undefined {
  const geo = readNiftiGeometry(absPath);
  if (!geo) return undefined;

  let buf: ArrayBuffer = (() => {
    const b = fs.readFileSync(absPath);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  })();
  if (nifti.isCompressed(buf)) buf = nifti.decompress(buf) as ArrayBuffer;
  if (!nifti.isNIFTI(buf)) return undefined;

  const header = nifti.readHeader(buf) as unknown as NiftiHeaderFields | null;
  if (!header) return undefined;

  const data = niftiTypedArray(header.datatypeCode, nifti.readImage(header as never, buf));
  const slope = header.scl_slope || 1;
  const inter = header.scl_inter || 0;

  const planes: Partial<Record<DemoPlane, DemoPlaneGeometry>> = {};
  for (const plane of ["Axial", "Coronal", "Sagittal"] as DemoPlane[]) {
    const p = geo.planes[plane];
    // Matches `buildNiftiVolumeSeries`: a volume one voxel thick in a direction
    // has no reconstructable view along it, and is dropped rather than faked.
    if (!p || p.sliceCount < 2) continue;
    planes[plane] = {
      n: p.sliceCount,
      w: p.width,
      ht: p.height,
      t: [p.through.axis, p.through.flip],
      h: [p.horizontal.axis, p.horizontal.flip],
      v: [p.vertical.axis, p.vertical.flip],
    };
  }

  return {
    url,
    zip,
    dims: geo.dims,
    datatype: header.datatypeCode,
    slope,
    inter,
    win: computeVolumeWindow(data, slope, inter),
    planes,
  };
}

/** Volume keys go into slice URLs, so they are restricted to characters that need no escaping. */
function volumeKey(absPath: string, taken: Set<string>): string {
  const stem = path.basename(absPath).replace(/\.nii(\.gz)?$/i, "");
  const base = stem.replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "") || "vol";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

// ---------------------------------------------------------------------------
// DatasetStudy → DemoStudy
// ---------------------------------------------------------------------------

interface ConvertContext {
  /** Archives whose members are served by byte range — MRI only. */
  zips: ZipHost[];
  skipped: string[];
  /** Studies present on disk that cannot be deployed, with the measured reason. */
  omitted: DemoOmission[];
}

/**
 * Rewrites one adapter-produced series in terms of public URLs.
 *
 * Undefined means nothing in this series is reachable from `public/` — which is
 * the correct outcome for a series the adapter found under a path that was never
 * committed, and is reported rather than silently dropped.
 */
function convertSeries(
  study: DatasetStudy,
  series: DatasetSeries,
  volumes: Record<string, DemoVolume>,
  volumeKeys: Map<string, string>,
  takenKeys: Set<string>,
  ctx: ConvertContext
): DemoSeries | undefined {
  const base = {
    id: series.id,
    label: series.label,
    orientation: series.orientation,
    n: series.sliceCount,
  };

  const run = series.frames;

  /*
   * One volumetric container, walked once per plane. Three series of one MRI
   * volume share a single `volumes` entry — the geometry is a property of the
   * volume, so measuring it per plane would decode the same file three times.
   */
  if (run && run.kind === "nifti") {
    let key = volumeKeys.get(run.absPath);
    if (!key) {
      const inZip = findInZips(run.absPath, ctx.zips);
      const url = inZip ? inZip.host.url : isCommittedAsset(run.absPath) ? publicUrl(run.absPath) : undefined;
      if (!url) {
        ctx.skipped.push(`${study.studyCode}: ${series.label} — volume is not a committed asset`);
        return undefined;
      }

      const measured = measureVolume(run.absPath, url, inZip?.range);
      if (!measured) {
        ctx.skipped.push(`${study.studyCode}: ${series.label} — NIfTI header could not be read`);
        return undefined;
      }

      key = volumeKey(run.absPath, takenKeys);
      volumeKeys.set(run.absPath, key);
      volumes[key] = measured;
    }

    const plane = (run.orientation ?? "Axial") as DemoPlane;
    if (!volumes[key].planes[plane]) {
      ctx.skipped.push(`${study.studyCode}: ${series.label} — volume has no ${plane.toLowerCase()} extent`);
      return undefined;
    }

    return { ...base, kind: "nifti", vol: key, plane, w: run.width, h: run.height };
  }

  /*
   * A reconstructed plane of a DICOM stack cannot travel this path.
   *
   * `dicom-volume` series are MPR views the server builds by reading the whole
   * stack — 443 instances for one of the committed chest CTs — and resampling it.
   * `seriesImageRefs` therefore reports the same representative instance for every
   * frame in the run, because the per-frame pixels do not exist as files. Written
   * out as URLs that becomes 256 copies of one axial image behind a label reading
   * "Coronal MPR": the viewer would scroll through it showing the acquired plane
   * and calling it a reconstruction.
   *
   * The acquired series beside it is real, complete and every committed instance
   * of it is indexed, so the honest outcome is to carry that and leave the
   * reconstructions to the server route that can actually compute them.
   */
  if (run?.kind === "dicom-volume" || series.images[0]?.kind === "dicom-volume") {
    ctx.skipped.push(
      `${study.studyCode}: ${series.label} — reconstructed DICOM plane, needs the whole stack server-side`
    );
    return undefined;
  }

  /*
   * One file per slice. `seriesImageRefs` is a generator, so a long CT series is
   * walked without materializing every ref at once.
   */
  const files: string[] = [];
  let width: number | undefined;
  let height: number | undefined;
  for (const ref of seriesImageRefs(series)) {
    if (!isCommittedAsset(ref.absPath)) {
      ctx.skipped.push(`${study.studyCode}: ${series.label} — slice ${ref.index} is not a committed asset`);
      return undefined;
    }
    // `?dcm=1` tells the client decoder to parse and window this asset itself;
    // a raster asset needs no marker because the browser can display it.
    const marker = ref.kind === "dicom" || ref.kind === "dicom-volume" ? "?dcm=1" : "";
    files.push(`${publicUrl(ref.absPath)}${marker}`);
    width ??= ref.width;
    height ??= ref.height;
  }

  if (files.length === 0) {
    ctx.skipped.push(`${study.studyCode}: ${series.label} — no resolvable slices`);
    return undefined;
  }

  const kind = series.images[0]?.kind ?? run?.kind ?? "raster";
  return { ...base, n: files.length, kind, files, w: width, h: height };
}

function convertStudy(study: DatasetStudy, ctx: ConvertContext): DemoStudy | undefined {
  const volumes: Record<string, DemoVolume> = {};
  const volumeKeys = new Map<string, string>();
  const takenKeys = new Set<string>();

  const series: DemoSeries[] = [];
  for (const s of study.series) {
    const converted = convertSeries(study, s, volumes, volumeKeys, takenKeys, ctx);
    if (converted) series.push(converted);
  }

  if (series.length === 0) {
    ctx.skipped.push(`${study.studyCode}: no series could be resolved to committed assets`);
    return undefined;
  }

  return {
    id: study.id,
    dataset: study.dataset,
    code: study.studyCode,
    srcId: study.sourceStudyId,
    alias: study.patientAlias,
    modality: study.modality,
    bodyRegion: study.bodyRegion,
    date: study.date,
    age: study.age,
    sex: study.sex,
    weightKg: study.weightKg,
    series,
    volumes: Object.keys(volumes).length > 0 ? volumes : undefined,
    report: study.report,
  };
}

// ---------------------------------------------------------------------------
// PER-DATASET COLLECTION
// ---------------------------------------------------------------------------

/**
 * CT, scanned by the unmodified `ctAdapter` through a link named `ct_general`.
 *
 * `getDatasetStudyKey`/`getTxtStudyKey` in `lib/dataset/adapters/ct.ts` only
 * derive the `PA0_ct_chest`-style report key when the scanned path contains
 * `/ct_general/` or `/inspection/` — that is how the Perle CT layout is
 * recognized. Scanning `public/demo-data/ct` directly therefore produced the
 * right four studies with empty reports. A junction gives the adapter the path
 * shape it expects without touching a byte of `ct.ts` or of the data, which is
 * what "do not modify or rebuild the image/report pairing" requires.
 */
async function collectCt(): Promise<DatasetStudy[]> {
  const ctDir = path.join(DEMO_ROOT, "ct");
  if (!fs.existsSync(ctDir)) return [];

  const linkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scanlab-demo-ct-"));
  const link = path.join(linkRoot, "ct_general");
  try {
    // "junction" is the only symlink type Windows allows without elevation; it
    // is ignored on POSIX, where a plain symlink is created instead.
    fs.symlinkSync(ctDir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    log(`  ! CT: could not create the ct_general link (${(err as Error).message}) — skipping CT`);
    return [];
  }

  try {
    const { ctAdapter } = await import("../lib/dataset/adapters/ct");
    const result = await ctAdapter.scan(link);
    for (const issue of result.issues) log(`  ! CT: ${issue.reason}`);
    // Re-point every ref at the real committed path: the adapter reports paths
    // through the temporary link, which will not exist by the time anything
    // reads this index.
    for (const study of result.studies) resolveLinkPaths(study, link, ctDir);
    return result.studies;
  } finally {
    try {
      fs.unlinkSync(link);
      fs.rmdirSync(linkRoot);
    } catch {
      /* a leftover temp link is harmless */
    }
  }
}

/** Rewrites `<link>/...` paths as `<real>/...` in place. */
function resolveLinkPaths(study: DatasetStudy, link: string, real: string): void {
  const swap = (p: string) => (p.startsWith(link) ? path.join(real, path.relative(link, p)) : p);
  for (const series of study.series) {
    for (const img of series.images) img.absPath = swap(img.absPath);
    if (series.frames) series.frames.absPath = swap(series.frames.absPath);
  }
  study.sourceDir = swap(study.sourceDir);
}

/**
 * MRI, scanned by the unmodified `mriAdapter`, which reads the committed ZIPs
 * itself. The report is attached from the `report.json` committed beside each
 * archive — the folder is the pairing.
 */
async function collectMri(ctx: ConvertContext): Promise<DatasetStudy[]> {
  const mriDir = path.join(DEMO_ROOT, "mri");
  if (!fs.existsSync(mriDir)) return [];

  /*
   * Only committed archives become servable hosts. An oversized one is left out
   * and recorded, so the studies inside it never reach the index — better an
   * honest omission than a study whose every slice 404s on the deployed site.
   */
  const undeployable = new Set<string>();
  for (const code of fs.readdirSync(mriDir).sort()) {
    const zipPath = path.join(mriDir, code, `${code}.zip`);
    if (!fs.existsSync(zipPath)) {
      undeployable.add(code);
      ctx.omitted.push({ srcId: code, dataset: "MRI", reason: "No image archive is committed for this study." });
      continue;
    }

    const bytes = fs.statSync(zipPath).size;
    if (!isCommittedAsset(zipPath)) {
      undeployable.add(code);
      ctx.omitted.push({
        srcId: code,
        dataset: "MRI",
        reason:
          bytes > CF_ASSET_LIMIT_BYTES
            ? `Image archive is ${mib(bytes)}, above the ${mib(CF_ASSET_LIMIT_BYTES)} per-asset limit for deployed static assets, so it is not committed.`
            : "Image archive is present locally but not committed, so it is not deployed.",
      });
      continue;
    }

    ctx.zips.push({ url: publicUrl(zipPath), bytes, ranges: zipMemberRanges(zipPath) });
  }

  const { mriAdapter } = await import("../lib/dataset/adapters/mri");
  const result = await mriAdapter.scan(mriDir);
  for (const issue of result.issues) log(`  ! MRI: ${issue.reason}`);

  const studies = result.studies.filter((s) => !undeployable.has(s.sourceStudyId));
  for (const study of studies) {
    const json = readJsonFile(path.join(mriDir, study.sourceStudyId, "report.json"));
    if (json) study.report = sectionedReport(json, "MR-RATE");
  }
  return studies;
}

/**
 * PET, scanned by the unmodified `petAdapter`.
 *
 * `metadata.json` carries a real `Sex`, `Age` and `Weight_kg` for these subjects,
 * so those are used as source values — the one place in the demo index where
 * demographics are not left for the badged fallback in `lib/patient-profile.ts`.
 * Body weight in particular is not decoration here: PET SUV is normalized by it.
 *
 * The join needs care. The adapter's `sourceStudyId` is the image id taken from
 * the NIfTI filename (`983777-000001`), while the folder is named after the
 * subject (`sub-983777-000001`), so `path.join(petDir, sourceStudyId)` does not
 * exist. `metadata.json` states both ids, which makes it the join.
 */
async function collectPet(): Promise<DatasetStudy[]> {
  const petDir = path.join(DEMO_ROOT, "pet");
  if (!fs.existsSync(petDir)) return [];

  const metaByStudyKey = new Map<string, { dir: string; meta: Record<string, unknown> }>();
  for (const dir of fs.readdirSync(petDir).sort()) {
    if (!fs.statSync(path.join(petDir, dir)).isDirectory()) continue;
    const meta = readJsonFile(path.join(petDir, dir, "metadata.json"));
    if (!meta) continue;
    const entry = { dir, meta };
    metaByStudyKey.set(dir, entry);
    const imageId = str(meta.Image_ID);
    if (imageId) metaByStudyKey.set(imageId, entry);
    const subjectId = str(meta.Subject_ID);
    if (subjectId) metaByStudyKey.set(subjectId, entry);
  }

  const { petAdapter } = await import("../lib/dataset/adapters/pet");
  const result = await petAdapter.scan(petDir);
  for (const issue of result.issues) log(`  ! PET: ${issue.reason}`);

  for (const study of result.studies) {
    const found = metaByStudyKey.get(study.sourceStudyId);
    if (!found) {
      log(`  ! PET: no metadata folder matches ${study.sourceStudyId} — report and demographics unavailable`);
      continue;
    }

    const dir = path.join(petDir, found.dir);
    const report = readJsonFile(path.join(dir, "report.json"));
    if (report) study.report = petReport(report, "PET");

    const meta = found.meta;
    const age = Number(str(meta.Age));
    if (Number.isFinite(age) && age > 0 && age < 130) study.age = Math.round(age);
    const sex = str(meta.Sex)?.toUpperCase();
    if (sex === "M" || sex === "F") study.sex = sex;
    const weight = Number(str(meta.Weight_kg));
    if (Number.isFinite(weight) && weight > 0 && weight < 500) study.weightKg = weight;
    // `metadata.json` also carries a `Disease` ("Renal Cancer"). It is
    // deliberately not read: `bodyRegion` is an anatomical label, and moving a
    // diagnosis into it would present a diagnosis as a scanned region.
  }
  return result.studies;
}

/**
 * X-Ray: one committed PNG plus the `report.json` beside it.
 *
 * Built here rather than by `chestXrayAdapter` for a reason worth stating.
 * `loadReportsAndGroups` treats a report JSON as a *map* of id → report
 * (`Object.entries(data).map(([k, v]) => ({ id: k, ... }))`), so a per-study file
 * whose top level is a single report object gets mis-keyed: `clinical_information`
 * and `study_uid` become study ids. Combined with the UTF-8 BOM every committed
 * `report.json` carries, the adapter reports "Malformed JSON" for all three and
 * indexes zero studies.
 *
 * Patching the adapter's report reader would put the CT `.txt` report path — the
 * one that works — at risk for no gain, because the committed pairing here IS the
 * folder: the PNG and its report sit together, named after the same study. So the
 * report is read verbatim, and the series itself is still built by the adapters'
 * own `buildSeriesFromFiles`, with the same id, code and alias derivation the
 * adapter uses so a study keeps its identity either way.
 */
function collectChestXray(): DatasetStudy[] {
  const dir = path.join(DEMO_ROOT, "chest-xray");
  if (!fs.existsSync(dir)) return [];

  const studies: DatasetStudy[] = [];
  for (const groupId of fs.readdirSync(dir).sort()) {
    const studyDir = path.join(dir, groupId);
    if (!fs.statSync(studyDir).isDirectory()) continue;

    const files = fs
      .readdirSync(studyDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort()
      .map((f) => path.join(studyDir, f));
    if (files.length === 0) continue;

    const series = buildSeriesFromFiles({
      seriesId: stableId("CHEST_XRAY", groupId, "series-0"),
      label: "X-Ray",
      modality: "X-Ray",
      // The dataset states no projection, and guessing AP vs PA vs Lateral from
      // a filename would be a claim about acquisition that nothing supports.
      orientation: "Unknown",
      files,
    });
    if (series.images.length === 0) continue;

    const json = readJsonFile(path.join(studyDir, "report.json"));
    const id = stableId("CHEST_XRAY", groupId);
    studies.push({
      id,
      // ROCOv2 rather than CHEST_XRAY: `study_uid` in every one of these reports
      // is a `ROCOv2_2023_train_*` row id, and one of the three is a lateral
      // spine radiograph. Badging them "Chest X-Ray" would assert a region the
      // data does not state and that this study contradicts.
      dataset: "ROCOV2",
      studyCode: studyCode("CXR", groupId),
      sourceStudyId: groupId,
      patientAlias: `Patient ${id.slice(0, 6).toUpperCase()}`,
      modality: "X-Ray",
      // Left unset on purpose — see above.
      series: [series],
      report: json ? sectionedReport(json, "ROCOv2") : undefined,
      sourceDir: studyDir,
    });
  }
  return studies;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

/** Deterministic order, so re-running the generator produces no diff churn. */
function byModalityThenCode(a: DemoStudy, b: DemoStudy): number {
  const order: Record<string, number> = { CT: 0, MRI: 1, PET: 2, "X-Ray": 3, Ultrasound: 4, Mammography: 5 };
  const m = (order[a.modality] ?? 9) - (order[b.modality] ?? 9);
  return m !== 0 ? m : a.code.localeCompare(b.code);
}

type Group = "ct" | "mri" | "pet" | "xray";
const GROUPS: Group[] = ["ct", "mri", "pet", "xray"];
const GROUP_DIR: Record<Group, string> = { ct: "ct", mri: "mri", pet: "pet", xray: "chest-xray" };

/**
 * ---------------------------------------------------------------------------
 * PER-DATASET PARTS
 * ---------------------------------------------------------------------------
 * Indexing all four datasets in one pass means walking 1,347 CT instances and
 * inflating every committed MRI volume to measure its display window — minutes of
 * work, all of it thrown away if the run is interrupted. So each dataset is built
 * and cached separately under `.scanlab/demo-parts/` (gitignored, like the rest of
 * `.scanlab`), and `index.json` is the merge of the four.
 *
 *   npm run demo:index                  build any missing part, then merge
 *   npm run demo:index -- --only mri    rebuild just MRI, then merge
 *   npm run demo:index -- --force       rebuild everything
 *
 * `index.json` is only written once every dataset present on disk has a part, so
 * a partial run can never quietly replace the committed index with a subset.
 */
interface DemoPart {
  group: Group;
  generatedAt: string;
  studies: DemoStudy[];
  omitted: DemoOmission[];
}

const PARTS_DIR = path.join(REPO_ROOT, ".scanlab", "demo-parts");

function partPath(group: Group): string {
  return path.join(PARTS_DIR, `${group}.json`);
}

function readPart(group: Group): DemoPart | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(partPath(group), "utf-8")) as DemoPart;
    return Array.isArray(parsed.studies) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writePart(part: DemoPart): void {
  fs.mkdirSync(PARTS_DIR, { recursive: true });
  fs.writeFileSync(partPath(part.group), JSON.stringify(part), "utf-8");
}

async function collectGroup(group: Group, ctx: ConvertContext): Promise<DatasetStudy[]> {
  switch (group) {
    case "ct":
      return collectCt();
    case "mri":
      return collectMri(ctx);
    case "pet":
      return collectPet();
    case "xray":
      return collectChestXray();
  }
}

async function buildPart(group: Group): Promise<DemoPart> {
  // One context per group: `ctx.zips` is only meaningful to the group that
  // registered it, and MRI is the only group with archives.
  const ctx: ConvertContext = { zips: [], skipped: [], omitted: [] };
  const raw = await collectGroup(group, ctx);

  const studies: DemoStudy[] = [];
  for (const study of raw) {
    const converted = convertStudy(study, ctx);
    if (converted) studies.push(converted);
  }

  for (const note of ctx.skipped) log(`    - skipped ${note}`);
  for (const o of ctx.omitted) log(`    - omitted ${o.srcId}: ${o.reason}`);
  log(`    ${studies.length} studies`);

  return { group, generatedAt: new Date().toISOString(), studies, omitted: ctx.omitted };
}

function argList(flag: string): Group[] | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const raw = (process.argv[i + 1] ?? "").split(",").map((s) => s.trim().toLowerCase());
  const picked = raw.filter((s): s is Group => (GROUPS as string[]).includes(s));
  return picked.length > 0 ? picked : undefined;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DEMO_ROOT)) {
    log(`No demo data at ${DEMO_ROOT} — nothing to index.`);
    return;
  }

  const force = process.argv.includes("--force");
  const only = argList("--only");
  const present = GROUPS.filter((g) => fs.existsSync(path.join(DEMO_ROOT, GROUP_DIR[g])));

  log(`Indexing the committed demo datasets in ${publicUrl(DEMO_ROOT)}`);
  log(`  datasets on disk: ${present.join(", ") || "none"}`);

  for (const group of present) {
    if (only && !only.includes(group)) continue;
    if (!force && !only && readPart(group)) {
      log(`  ${group}: cached (--force to rebuild)`);
      continue;
    }
    log(`  ${group}: building…`);
    writePart(await buildPart(group));
  }

  const parts = new Map<Group, DemoPart>();
  for (const group of present) {
    const part = readPart(group);
    if (part) parts.set(group, part);
  }

  const missing = present.filter((g) => !parts.has(g));
  if (missing.length > 0) {
    log("");
    log(`Not writing index.json: no part yet for ${missing.join(", ")}.`);
    log(`Run: npm run demo:index -- --only ${missing.join(",")}`);
    return;
  }

  const studies = [...parts.values()].flatMap((p) => p.studies).sort(byModalityThenCode);
  const omitted = [...parts.values()].flatMap((p) => p.omitted);

  // Imported here rather than at the top so the module that reads
  // `SCANLAB_DATA_ROOT` is only touched once this script is actually running.
  const { MANIFEST_BUILDER_VERSION } = await import("../lib/dataset/manifest-store");

  const index: DemoIndex = {
    version: DEMO_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    builderVersion: MANIFEST_BUILDER_VERSION,
    studies,
    omitted,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(index)}\n`, "utf-8");

  const counts = new Map<string, number>();
  let slices = 0;
  for (const s of studies) {
    counts.set(s.modality, (counts.get(s.modality) ?? 0) + 1);
    for (const series of s.series) slices += series.n;
  }

  log("");
  log(`Wrote ${publicUrl(OUT_FILE)} — ${mib(fs.statSync(OUT_FILE).size)}`);
  log(`  ${studies.length} studies: ${[...counts].map(([m, n]) => `${n} ${m}`).join(", ")}`);
  log(`  ${slices} slices, ${studies.filter((s) => s.report).length} with a report, ${omitted.length} omitted`);
}

main().catch((err: unknown) => {
  console.error(`demo:index failed: ${(err as Error).message}`);
  process.exit(1);
});







