/**
 * Run with: npm run demo:pack  (after npm run dataset:index)
 *
 * Exports a small, hand-checkable set of real files out of the indexed dataset —
 * chest, CT, MRI and PET — and writes `.scanlab/upload-index.json` mapping each
 * exported file's SHA-256 to the study it came from.
 *
 * The point is a demo you can defend: you upload one of these files, the app
 * hashes it, finds the study, and shows that study's real images, real
 * reconstructions and the report that shipped with the dataset. Nothing is
 * predicted or generated anywhere in that path.
 *
 * Two deliberate properties:
 *   - Files are copied byte-for-byte, never re-encoded, so the hash in the index
 *     is exactly the hash of what gets uploaded.
 *   - Every file is named with its study code, so even a copy that has been
 *     renamed or round-tripped through email still resolves by filename.
 *
 * Nothing here writes into the dataset root; the only writes are the output
 * folder and the index file.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import type { UploadIndexEntry } from "../lib/dataset/upload-match";
import type { DatasetSeries, DatasetSourceId, DatasetStudy, ImageSourceKind } from "../lib/dataset/types";
import { DATASET_SOURCE_LABEL } from "../lib/dataset/types";

/** Must stay at or under the API route's per-file cap, or the demo upload 413s. */
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

/** Chest first because it is the one modality whose export is directly viewable in a browser. */
const GROUPS: { dataset: DatasetSourceId; count: number }[] = [
  { dataset: "CHEST_XRAY", count: 3 },
  { dataset: "CT", count: 2 },
  { dataset: "MRI", count: 3 },
  { dataset: "PET", count: 3 },
  { dataset: "ROCOV2", count: 1 },
];

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

interface Candidate {
  absPath: string;
  /** What this file is inside the study, shown in the UI on a content match. */
  sourceLabel: string;
  /** Drives the exported extension only — the bytes are always copied verbatim. */
  kind: ImageSourceKind;
}

/**
 * The most demonstrable single file in a study.
 *
 * Prefers an acquired plane over a reconstruction: an MPR series carries no
 * bytes of its own — it is the same container resliced — so exporting "the
 * coronal file" would be exporting the axial container under a misleading name.
 */
function pickCandidate(study: DatasetStudy): Candidate | undefined {
  const series = pickSeries(study);
  if (!series) return undefined;

  const run = series.frames;
  if (run) {
    if (run.kind === "dicom-volume" && series.volumeId) {
      const files = study.volumes?.[series.volumeId]?.files ?? [];
      if (files.length === 0) return undefined;
      // A middle instance, so the exported slice is anatomy rather than the
      // empty air at the top of the stack.
      const mid = Math.floor(files.length / 2);
      return {
        absPath: files[mid],
        sourceLabel: `${series.label} · instance ${mid + 1} of ${files.length}`,
        kind: run.kind,
      };
    }
    return { absPath: run.absPath, sourceLabel: `${series.label} · full volume (${run.count} frames)`, kind: run.kind };
  }

  if (series.images.length === 0) return undefined;
  const mid = Math.floor(series.images.length / 2);
  const ref = series.images[mid];
  return {
    absPath: ref.absPath,
    sourceLabel: series.images.length > 1 ? `${series.label} · slice ${mid + 1} of ${series.images.length}` : series.label,
    kind: ref.kind,
  };
}

function pickSeries(study: DatasetStudy): DatasetSeries | undefined {
  const acquired = study.series.filter((s) => !/\bMPR\b/.test(s.label));
  const pool = acquired.length > 0 ? acquired : study.series;
  return pool.find((s) => s.orientation === "Axial") ?? pool[0];
}

/**
 * Keeps the study code readable and the extension intact; drops everything a
 * shell would fight over.
 *
 * DICOM instances in this dataset are frequently extensionless (`IM278`), and a
 * browser's file picker filters by extension — so without this the CT files in
 * the pack are invisible to anyone who clicks "browse" instead of dragging.
 * Appending `.dcm` renames only; the bytes, and therefore the hash in the
 * index, are untouched.
 */
function safeName(studyCode: string, absPath: string, kind: ImageSourceKind): string {
  const base = path.basename(absPath).replace(/[^0-9A-Za-z._-]+/g, "-");
  const isDicom = kind === "dicom" || kind === "dicom-volume";
  const suffix = isDicom && !/\.[0-9A-Za-z]{1,8}$/.test(base) ? ".dcm" : "";
  return `${studyCode}__${base}${suffix}`;
}

function argValue(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  loadDotEnvLocal();

  const { readManifest, getManifestStatus } = await import("../lib/dataset/manifest-store");
  const { getUploadIndexPath, UPLOAD_INDEX_VERSION } = await import("../lib/dataset/upload-match");

  const manifest = readManifest();
  if (!manifest) {
    console.error("\n✗ No dataset index found. Run `npm run dataset:index` first.\n");
    process.exit(1);
  }

  const status = getManifestStatus();
  if (status.state !== "current") {
    console.warn(`\n! Index is ${status.state}: ${status.message}`);
    if (status.remedy) console.warn(`  ${status.remedy}`);
    console.warn("  Exporting from it anyway — the pack will only match studies the index still contains.\n");
  }

  const outDir = path.resolve(process.cwd(), argValue("out") ?? "demo-pack");
  const perGroup = Number.parseInt(argValue("per") ?? "", 10);
  fs.mkdirSync(outDir, { recursive: true });

  const entries: UploadIndexEntry[] = [];
  const rows: string[] = [];
  const skipped: string[] = [];

  for (const group of GROUPS) {
    const want = Number.isFinite(perGroup) && perGroup > 0 ? perGroup : group.count;
    // A report is required: a demo file whose study has no report would show an
    // empty report panel, which is exactly the bug this work was chasing.
    const pool = manifest.studies.filter((s) => s.dataset === group.dataset && s.report);
    let taken = 0;

    for (const study of pool) {
      if (taken >= want) break;

      const candidate = pickCandidate(study);
      if (!candidate) {
        skipped.push(`${study.studyCode}: no exportable series`);
        continue;
      }
      let size: number;
      try {
        size = fs.statSync(candidate.absPath).size;
      } catch {
        skipped.push(`${study.studyCode}: source file is no longer on disk`);
        continue;
      }
      if (size > MAX_EXPORT_BYTES) {
        skipped.push(`${study.studyCode}: ${(size / 1024 / 1024).toFixed(1)} MB exceeds the ${MAX_EXPORT_BYTES / 1024 / 1024} MB upload cap`);
        continue;
      }

      const fileName = safeName(study.studyCode, candidate.absPath, candidate.kind);
      const dest = path.join(outDir, fileName);
      fs.copyFileSync(candidate.absPath, dest);

      // Hash what was written, not what was read: the index must describe the
      // bytes that will actually be uploaded.
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
      entries.push({ sha256, bytes: size, fileName, studyCode: study.studyCode, sourceLabel: candidate.sourceLabel });
      rows.push(
        [
          fileName,
          study.studyCode,
          study.patientAlias,
          study.modality,
          DATASET_SOURCE_LABEL[study.dataset] ?? study.dataset,
          study.bodyRegion ?? "—",
          candidate.sourceLabel,
        ].join(" | ")
      );
      taken++;
    }

    if (taken < want) skipped.push(`${group.dataset}: only ${taken} of ${want} requested studies were exportable`);
  }

  if (entries.length === 0) {
    console.error("\n✗ Nothing could be exported. Re-run `npm run dataset:index` and check the dataset root is reachable.\n");
    process.exit(1);
  }

  const indexPath = getUploadIndexPath();
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ version: UPLOAD_INDEX_VERSION, generatedAt: new Date().toISOString(), entries }, null, 2),
    "utf-8"
  );

  fs.writeFileSync(path.join(outDir, "INDEX.txt"), readmeText(rows, skipped), "utf-8");

  console.log(`\nExported ${entries.length} file(s) to: ${outDir}`);
  console.log(`Upload index written to: ${indexPath}\n`);
  for (const row of rows) console.log(`  ${row}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  console.log("");
}

function readmeText(rows: string[], skipped: string[]): string {
  const lines = [
    "DEMO UPLOAD PACK",
    "================",
    "",
    "Every file here was copied byte-for-byte out of the indexed dataset. Uploading",
    "one on the Upload Scan page (with NEXT_PUBLIC_DATA_MODE=dataset) hashes it,",
    "finds the study it came from, and opens that study's real images, real",
    "reconstructed planes and the radiology report that shipped with the dataset.",
    "",
    "Nothing in that path runs a model. The match is a lookup, not a prediction, and",
    "the app labels it that way.",
    "",
    "FILE | STUDY | PATIENT | MODALITY | DATASET | REGION | WHAT THE FILE IS",
    "-".repeat(78),
    ...rows,
    "",
    "Notes",
    "-----",
    "- .dcm (CT) and .nii/.nii.gz (MRI, PET) are not browser-viewable formats, so the",
    "  upload page will not show a thumbnail for them. They still match exactly, and",
    "  the study that opens shows the rendered slices and MPR planes.",
    "- CT instances are stored extensionless in the source data (e.g. IM278). A .dcm",
    "  extension is appended on export so the file is selectable in the browser's",
    "  file picker; the bytes are unchanged, so the hash still matches.",
    "- The study code in each filename is a second, independent way to match, so a",
    "  file that gets renamed or re-saved still resolves as long as the code survives.",
    "- Re-run `npm run dataset:index` then `npm run demo:pack` after changing the",
    "  dataset; the index in .scanlab/upload-index.json belongs to this pack.",
  ];
  if (skipped.length > 0) {
    lines.push("", `Skipped during export (${skipped.length}):`, ...skipped.map((s) => `- ${s}`));
  }
  return `${lines.join("\n")}\n`;
}

main().catch((err) => {
  console.error("\nDemo pack export failed:\n", err);
  process.exit(1);
});
