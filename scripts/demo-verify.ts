/**
 * ---------------------------------------------------------------------------
 * DEMO INDEX VERIFICATION — `npm run demo:verify`
 * ---------------------------------------------------------------------------
 * `dataset:verify` answers "is `.scanlab/manifest.json` internally consistent
 * with the disk it was built from". This answers the deployed question, which is
 * a different one: will the studies in `public/demo-data/index.json` actually
 * render for someone visiting the Cloudflare Worker, and is what they see traceable
 * to the committed source data rather than generated.
 *
 * Three checks earn this file its place:
 *
 *   1. Every asset URL in the index is resolved back to a repository path and
 *      looked up in `git ls-files`. An asset that exists on this machine but is
 *      not committed is exactly the failure the two oversized MRI archives
 *      caused: the study lists fine and every slice 404s once deployed.
 *   2. Every referenced asset is measured against Cloudflare's 25 MiB per-asset
 *      limit, because an asset over it is silently not uploaded.
 *   3. The studies are pushed through the real `toAppStudy`, so the numbers
 *      printed here are the ones the UI will show — study count, report
 *      presence, findings per study, and which patient-panel fields came from
 *      the source data versus being generated and badged as such.
 *
 * Read-only. Never writes, never touches `.scanlab/`, and does not need
 * `SCANLAB_DATA_ROOT`.
 * ---------------------------------------------------------------------------
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { DatasetStudy } from "../lib/dataset/types";
import { demoIndexToDatasetStudies } from "../lib/demo/expand";
import { DEMO_INDEX_VERSION, DemoIndex } from "../lib/demo/types";
import { Study } from "../lib/types";

function findRepoRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "public"))) {
    return cwd;
  }
  return path.resolve(__dirname, "..");
}

const REPO_ROOT = findRepoRoot();
const INDEX_FILE = path.join(REPO_ROOT, "public", "demo-data", "index.json");
const CF_ASSET_LIMIT_BYTES = 25 * 1024 * 1024;

const problems: string[] = [];
function fail(message: string): void {
  problems.push(message);
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function loadIndex(): DemoIndex {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`public/demo-data/index.json does not exist. Run \`npm run demo:index\` first.`);
  }
  // Every report.json in this corpus is written with a BOM; the index is written
  // by us and is not, but stripping is free and makes this robust either way.
  const text = fs.readFileSync(INDEX_FILE, "utf-8").replace(/^﻿/, "");
  const raw = JSON.parse(text) as DemoIndex;
  if (raw.version !== DEMO_INDEX_VERSION) {
    throw new Error(
      `index.json is version ${raw.version}, this build reads version ${DEMO_INDEX_VERSION}. Re-run \`npm run demo:index\`.`
    );
  }
  return raw;
}

/**
 * Every path under `public/` that git knows about — i.e. every file that will
 * exist once deployed.
 */
function trackedPublicFiles(): Set<string> | undefined {
  const run = spawnSync("git", ["ls-files", "-z", "--", "public"], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !run.stdout) return undefined;

  const set = new Set<string>();
  for (const rel of run.stdout.toString("utf-8").split("\0")) {
    if (rel) set.add(path.resolve(REPO_ROOT, rel));
  }
  return set;
}

/** `/demo-data/ct/PA0/IM0?dcm=1` → the absolute path of that file in `public/`. */
function assetPath(url: string): string {
  const clean = url.split("?")[0];
  const rel = decodeURIComponent(clean.replace(/^\//, ""));
  return path.join(REPO_ROOT, "public", rel);
}

/**
 * Every distinct file the index points at, with one study code per file for the
 * error message.
 *
 * Taken from the raw index rather than the expanded studies because a volumetric
 * series expands to one URL per frame of a single container — 512 URLs for one
 * file, which would make this check 512 times more work for the same answer.
 */
function referencedAssets(index: DemoIndex): Map<string, string> {
  const assets = new Map<string, string>();

  for (const study of index.studies) {
    for (const series of study.series) {
      for (const url of series.files ?? []) {
        const abs = assetPath(url);
        if (!assets.has(abs)) assets.set(abs, study.code);
      }
    }
    for (const volume of Object.values(study.volumes ?? {})) {
      const abs = assetPath(volume.url);
      if (!assets.has(abs)) assets.set(abs, study.code);
    }
  }

  return assets;
}

interface ModalityRow {
  studies: number;
  series: number;
  slices: number;
  withReport: number;
  withFindings: number;
  findings: number;
}

function emptyRow(): ModalityRow {
  return { studies: 0, series: 0, slices: 0, withReport: 0, withFindings: 0, findings: 0 };
}

/** The nine fields the patient panel shows, in the order it shows them. */
const PANEL_FIELDS = ["name", "age", "sex", "heightCm", "weightKg", "bmi", "bsaM2", "history", "notes"] as const;

/**
 * Fields the panel must have a value for. History and notes are excluded on
 * purpose: these datasets carry neither, the panel renders "Not available" for
 * them, and an absent history is a legitimate state rather than a gap.
 */
const REQUIRED_PANEL_FIELDS = new Set(["name", "age", "sex", "heightCm", "weightKg", "bmi", "bsaM2"]);

function sliceCount(study: Study): number {
  return study.series.reduce((n, s) => n + s.sliceCount, 0);
}

function checkStudy(ds: DatasetStudy, app: Study, row: ModalityRow): void {
  row.studies += 1;
  row.series += app.series.length;
  row.slices += sliceCount(app);
  if (app.sourceReport) row.withReport += 1;
  row.findings += app.findings.length;
  if (app.findings.length > 0) row.withFindings += 1;

  if (/^MRD-/.test(app.studyId)) {
    fail(`${app.studyId} looks like a seeded placeholder ID — the demo index must contain only real studies.`);
  }
  if (app.series.length === 0) {
    fail(`${app.studyId}: no series survived indexing, so the study cannot open.`);
  }
  for (const s of ds.series) {
    const refs = s.frames ? s.frames.count : s.images.length;
    if (s.sliceCount > 0 && refs === 0) {
      fail(`${app.studyId}: series "${s.label}" declares ${s.sliceCount} slices but has 0 image refs.`);
    }
  }
  if (!app.patientProfile) {
    fail(`${app.studyId}: no patient profile, so the report's patient column would be empty.`);
  }
}

function checkAssets(index: DemoIndex): void {
  const assets = referencedAssets(index);
  const tracked = trackedPublicFiles();

  let missing = 0;
  let untracked = 0;
  let oversize = 0;
  let bytes = 0;

  for (const [abs, code] of assets) {
    if (!fs.existsSync(abs)) {
      missing += 1;
      if (missing <= 5) fail(`${code}: referenced asset is not on disk — ${path.relative(REPO_ROOT, abs)}`);
      continue;
    }

    const size = fs.statSync(abs).size;
    bytes += size;

    if (size > CF_ASSET_LIMIT_BYTES) {
      oversize += 1;
      fail(`${code}: ${path.relative(REPO_ROOT, abs)} is ${mib(size)}, over the ${mib(CF_ASSET_LIMIT_BYTES)} per-asset limit.`);
    }

    if (tracked && !tracked.has(path.resolve(abs))) {
      untracked += 1;
      if (untracked <= 5) {
        fail(`${code}: ${path.relative(REPO_ROOT, abs)} is not committed, so it will 404 once deployed.`);
      }
    }
  }

  if (!tracked) {
    console.log("  ! git ls-files failed — deployability could not be checked, only on-disk presence.");
  }
  if (missing > 5) fail(`…and ${missing - 5} more referenced assets are not on disk.`);
  if (untracked > 5) fail(`…and ${untracked - 5} more referenced assets are not committed.`);

  console.log(
    `Assets: ${assets.size} distinct files, ${mib(bytes)} total, ${missing} missing, ${untracked} uncommitted, ${oversize} over the size limit`
  );
}

function printModalityTable(rows: Map<string, ModalityRow>): void {
  const width = Math.max(...[...rows.keys()].map((k) => k.length), 8);
  console.log(`${"MODALITY".padEnd(width)}  STUDIES  SERIES   SLICES  REPORTS  WITH FINDINGS  FINDINGS`);

  const total = emptyRow();
  for (const [modality, r] of [...rows].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `${modality.padEnd(width)}  ${String(r.studies).padStart(7)}  ${String(r.series).padStart(6)}  ` +
        `${String(r.slices).padStart(7)}  ${String(r.withReport).padStart(7)}  ${String(r.withFindings).padStart(13)}  ${String(r.findings).padStart(8)}`
    );
    total.studies += r.studies;
    total.series += r.series;
    total.slices += r.slices;
    total.withReport += r.withReport;
    total.withFindings += r.withFindings;
    total.findings += r.findings;
  }

  console.log("-".repeat(width + 58));
  console.log(
    `${"TOTAL".padEnd(width)}  ${String(total.studies).padStart(7)}  ${String(total.series).padStart(6)}  ` +
      `${String(total.slices).padStart(7)}  ${String(total.withReport).padStart(7)}  ${String(total.withFindings).padStart(13)}  ${String(total.findings).padStart(8)}`
  );

  if (total.withReport < total.studies) {
    fail(`${total.studies - total.withReport} studies have no report, so their report tab would be empty.`);
  }
}

/**
 * How the nine patient-panel fields are populated across the corpus, split by
 * the badge each value carries.
 *
 * This is the check that matters for "no invented metadata": a field counted
 * under `source` is quoted from the committed dataset, and one counted under
 * `simulated` or `derived` is generated and says so on screen. A field missing
 * from every study would show as "Not available" rather than as a number.
 */
function printPanelCoverage(studies: Study[]): void {
  console.log("\nPatient panel fields (badge each value carries in the UI):");

  for (const field of PANEL_FIELDS) {
    const bySource = new Map<string, number>();
    let present = 0;

    for (const study of studies) {
      const entry = study.patientProfile?.[field];
      if (!entry) continue;
      present += 1;
      bySource.set(entry.source, (bySource.get(entry.source) ?? 0) + 1);
    }

    const breakdown = [...bySource].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s}`).join(", ");
    console.log(`  ${field.padEnd(10)} ${String(present).padStart(3)}/${studies.length}${breakdown ? `  (${breakdown})` : ""}`);

    if (present < studies.length && REQUIRED_PANEL_FIELDS.has(field)) {
      fail(`Patient panel: ${field} is absent for ${studies.length - present} studies.`);
    }
  }
}

/** One line per study, so the actual list is inspectable rather than just counted. */
function printStudyList(studies: Study[]): void {
  console.log("\nStudies as the list will show them:");
  for (const s of studies) {
    const cover = s.imageUrls?.[0] ?? "no cover";
    console.log(
      `  ${s.studyId.padEnd(16)} ${s.modality.padEnd(7)} ${(s.datasetSource ?? "?").padEnd(11)} ` +
        `${String(sliceCount(s)).padStart(5)} slices  ${s.findings.length} findings (${s.aiStatus})  ${cover}`
    );
  }
}

async function main(): Promise<void> {
  const index = loadIndex();
  const datasetStudies = demoIndexToDatasetStudies(index);

  console.log(`public/demo-data/index.json — version ${index.version}, builder ${index.builderVersion}`);
  console.log(`Generated ${index.generatedAt}\n`);

  // The real conversion, so every number below is the one the UI computes.
  const { toAppStudy, toAppStudySummary } = await import("../lib/dataset/to-app-study");

  const rows = new Map<string, ModalityRow>();
  const apps: Study[] = [];
  const summaries: Study[] = [];

  for (const ds of datasetStudies) {
    const app = toAppStudy(ds);
    apps.push(app);
    summaries.push(toAppStudySummary(ds));

    const row = rows.get(app.modality) ?? emptyRow();
    checkStudy(ds, app, row);
    rows.set(app.modality, row);
  }

  printModalityTable(rows);
  checkAssets(index);
  printPanelCoverage(apps);
  printStudyList(summaries);

  if (index.omitted.length > 0) {
    console.log(`\nOmitted from the deployed build (${index.omitted.length}):`);
    for (const o of index.omitted) console.log(`  - ${o.srcId} (${o.dataset}): ${o.reason}`);
  }

  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 25)) console.log(`  - ${p}`);
    if (problems.length > 25) console.log(`  ...and ${problems.length - 25} more.`);
    console.log("");
    process.exit(1);
  }

  console.log("\nNo problems found.\n");
}

main().catch((err: unknown) => {
  console.error(`\ndemo:verify failed: ${(err as Error).message}\n`);
  process.exit(1);
});
