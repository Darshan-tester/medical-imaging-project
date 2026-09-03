/**
 * ---------------------------------------------------------------------------
 * DEMO INDEX PREFLIGHT  (runs as `prebuild`, so it gates every `npm run build`)
 * ---------------------------------------------------------------------------
 * Fails the build when `public/demo-data/index.json` — the one file the deployed
 * client actually fetches — is missing, unreadable, of a version this build does
 * not understand, empty, or referencing an asset that will not be deployed.
 *
 * Why verify instead of regenerating during the build:
 *
 *   `npm run demo:index` reads only `public/demo-data`; it never touches
 *   `SCANLAB_DATA_ROOT`, so it *could* run on Cloudflare's builder. It should
 *   not. It walks ~870 MiB, parses every DICOM header, unzips eight MRI archives
 *   and reads three NIfTI volumes to produce a file that is already committed —
 *   and its output carries a `generatedAt` timestamp, so it is not byte-
 *   reproducible anyway. Generating once on the machine that holds the data,
 *   committing the result and verifying it here means the builder deploys
 *   exactly the bytes that were checked, with no dataset root and no long walk.
 *
 * The failure mode this exists to catch is silent: `lib/demo/load.ts` returns an
 * empty result when the fetch fails or the version is unrecognised, so a broken
 * index does not surface as an error — it looks like a working site with zero
 * studies. That is indistinguishable, from the outside, from the stale
 * `NEXT_PUBLIC_DATA_MODE=dataset` build variable that caused the same symptom.
 * ---------------------------------------------------------------------------
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const problems = [];
const fail = (msg, remedy) => problems.push(remedy ? `${msg}\n    → ${remedy}` : msg);

/*
 * The version and the URL are read out of `lib/demo/types.ts` rather than
 * duplicated here. They are a contract between the generator and the client, and
 * a checker carrying its own copy of a contract is a checker that goes stale.
 */
const typesPath = path.join(root, "lib", "demo", "types.ts");
let expectedVersion;
let indexUrl;
try {
  const src = fs.readFileSync(typesPath, "utf8");
  expectedVersion = Number(/DEMO_INDEX_VERSION\s*=\s*(\d+)/.exec(src)?.[1]);
  indexUrl = /DEMO_INDEX_URL\s*=\s*"([^"]+)"/.exec(src)?.[1];
} catch {
  /* handled below */
}

if (!Number.isInteger(expectedVersion) || !indexUrl) {
  console.error(
    `[demo-index-check] Could not read DEMO_INDEX_VERSION / DEMO_INDEX_URL from ${path.relative(root, typesPath)}.`
  );
  process.exit(1);
}

// `/demo-data/index.json` -> `public/demo-data/index.json`, and the `/demo-data/`
// prefix every asset reference in the index shares.
const indexFile = path.join(root, "public", ...indexUrl.split("/").filter(Boolean));
const assetPrefix = `${path.posix.dirname(indexUrl)}/`;

let index;
if (!fs.existsSync(indexFile)) {
  fail(
    `${path.relative(root, indexFile)} does not exist, so the deployed Studies page would load zero studies.`,
    "npm run demo:index"
  );
} else {
  try {
    index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch (err) {
    fail(`${path.relative(root, indexFile)} is not valid JSON: ${err.message}`, "npm run demo:index");
  }
}

if (index) {
  if (index.version !== expectedVersion) {
    fail(
      `Index version ${index.version} but this build expects ${expectedVersion}. ` +
        `lib/demo/load.ts rejects a version it does not recognise and renders an empty list.`,
      "npm run demo:index"
    );
  }

  const studies = Array.isArray(index.studies) ? index.studies : [];
  if (studies.length === 0) {
    fail("Index contains no studies.", "npm run demo:index");
  }

  /*
   * The four corpora committed under `public/demo-data`. Requiring at least one
   * of each catches a partial regeneration — `demo:index -- --only mri` writes a
   * complete-looking index, and an index that quietly lost the 4 CT or 3 X-Ray
   * studies is the kind of regression nobody notices until a demo. Extra
   * modalities (ultrasound, mammography) pass: this is a floor, not a whitelist.
   */
  const counts = {};
  for (const s of studies) counts[s.modality] = (counts[s.modality] ?? 0) + 1;
  for (const modality of ["CT", "MRI", "PET", "X-Ray"]) {
    if (!counts[modality]) fail(`No ${modality} studies in the index.`, "npm run demo:index");
  }

  // A study with no series has nothing for the viewer to open; one with no report
  // breaks the image/report pairing the index exists to carry.
  const noSeries = studies.filter((s) => !Array.isArray(s.series) || s.series.length === 0);
  const noReport = studies.filter((s) => !s.report);
  if (noSeries.length > 0) {
    fail(`${noSeries.length} study/studies have no series: ${noSeries.map((s) => s.code).join(", ")}`);
  }
  if (noReport.length > 0) {
    fail(`${noReport.length} study/studies have no report: ${noReport.map((s) => s.code).join(", ")}`);
  }

  /*
   * Deployability of every referenced asset.
   *
   * Presence on disk is the wrong test: the two oversized MRI archives are on the
   * author's disk and gitignored, so an on-disk check passes locally and 404s on
   * the Worker. `git ls-files` is the same rule `scripts/demo-index.ts` applies
   * when it decides what to put in the index, so the two agree by construction.
   * Existence is the fallback for a build from an export with no git metadata.
   */
  const referenced = new Set();
  const escaped = assetPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [, url] of JSON.stringify(index).matchAll(new RegExp(`"(${escaped}[^"]+)"`, "g"))) {
    referenced.add(url.split("?")[0]);
  }

  const git = spawnSync("git", ["ls-files", "-z", "--", "public"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  const usedGit = git.status === 0 && typeof git.stdout === "string";
  const tracked = usedGit ? new Set(git.stdout.split("\0").filter(Boolean).map((p) => `/${p.replace(/^public\//, "")}`)) : undefined;

  const undeployable = [...referenced].filter((url) =>
    tracked ? !tracked.has(url) : !fs.existsSync(path.join(root, "public", ...url.split("/").filter(Boolean)))
  );
  if (undeployable.length > 0) {
    fail(
      `${undeployable.length} of ${referenced.size} referenced assets ${usedGit ? "are not tracked by git" : "are missing from public/"}, ` +
        `so they will 404 on the Worker. First few: ${undeployable.slice(0, 3).join(", ")}`,
      "npm run demo:index"
    );
  }

  if (problems.length === 0) {
    const summary = Object.entries(counts)
      .sort()
      .map(([m, n]) => `${m} ${n}`)
      .join(", ");
    console.log(
      `[demo-index-check] ${indexUrl} v${index.version}: ${studies.length} studies (${summary}), ` +
        `${studies.length - noReport.length} with reports, ${referenced.size} assets ${usedGit ? "all tracked" : "all present"}` +
        `${index.omitted?.length ? `, ${index.omitted.length} archive(s) deliberately omitted` : ""}.`
    );
  }
}

if (problems.length > 0) {
  console.error("\n[demo-index-check] The committed demo index cannot be deployed as-is:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    "\n  This index is what /studies reads in demo mode. It is generated from the\n" +
      "  committed files under public/demo-data and needs no dataset root — run the\n" +
      "  command above on a machine with the repository, then commit the result.\n"
  );
  process.exit(1);
}

