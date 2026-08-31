/**
 * Run with: npm run dataset:index
 * Requires SCANLAB_DATA_ROOT to be set (see .env.local.example). Loads
 * .env.local itself since this runs outside the Next.js dev/build process.
 */
import fs from "fs";
import path from "path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadDotEnvLocal();

  const { hasDataRootConfigured, getDataRoot } = await import("../lib/dataset/config");
  if (!hasDataRootConfigured()) {
    console.error("\n✗ SCANLAB_DATA_ROOT is not set.");
    console.error("  Copy .env.local.example to .env.local and set SCANLAB_DATA_ROOT to your dataset folder, then re-run this command.\n");
    process.exit(1);
  }

  const root = getDataRoot();
  if (!fs.existsSync(root)) {
    console.error(`\n✗ SCANLAB_DATA_ROOT does not exist on this machine: ${root}\n`);
    process.exit(1);
  }

  console.log(`Scanning dataset root: ${root}\n`);
  const { runScan } = await import("../lib/dataset/scanner");
  const { manifest, perDataset, totals } = await runScan();

  const { getManifestPath } = await import("../lib/dataset/config");
  const manifestPath = getManifestPath();
  console.log(`Manifest written to: ${manifestPath}`);

  /*
   * Printed because the index has to be read back into a single string to be
   * used: past ~512 MB that becomes impossible, which is how this step failed
   * before volumetric planes were stored as compact runs. A number here makes
   * the trend visible while there is still headroom.
   */
  try {
    const bytes = fs.statSync(manifestPath).size;
    console.log(`Manifest size: ${(bytes / (1024 * 1024)).toFixed(1)} MB\n`);
  } catch {
    console.log("");
  }

  const rows = Object.entries(perDataset);
  const nameWidth = Math.max(...rows.map(([k]) => k.length), 10);
  console.log(`${"DATASET".padEnd(nameWidth)}  STUDIES  IMAGES  REPORTS  COMPLETE PAIRS`);
  for (const [dataset, counts] of rows) {
    console.log(
      `${dataset.padEnd(nameWidth)}  ${String(counts.studies).padStart(7)}  ${String(counts.images).padStart(6)}  ${String(counts.reports).padStart(7)}  ${String(counts.completePairs).padStart(14)}`
    );
  }
  console.log(`${"-".repeat(nameWidth + 40)}`);
  console.log(`${"TOTAL".padEnd(nameWidth)}  ${String(totals.studies).padStart(7)}  ${String(totals.images).padStart(6)}  ${String(totals.reports).padStart(7)}  ${String(totals.completePairs).padStart(14)}`);

  if (manifest.issues.length > 0) {
    console.log(`\n${manifest.issues.length} issue(s) encountered while scanning (run 'npm run dataset:verify' for full detail):`);
    for (const issue of manifest.issues.slice(0, 20)) {
      console.log(`  [${issue.dataset}] ${issue.reason}: ${issue.path}`);
    }
    if (manifest.issues.length > 20) console.log(`  ...and ${manifest.issues.length - 20} more.`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nDataset indexing failed:\n", err);
  process.exit(1);
});
