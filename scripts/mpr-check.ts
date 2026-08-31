/**
 * Multiplanar reconstruction self-check.
 *
 * Run with:
 *   npm run dataset:mpr-check                          -> checks volumes found in the manifest
 *   npm run dataset:mpr-check -- <file.nii.gz> [...]    -> checks specific files
 *
 * For every volume it prints what the file's own header says (dims, mm spacing,
 * which array axis carries each anatomical direction, whether a qform/sform was
 * present) and then actually renders the middle slice of each plane, reporting
 * the rendered pixel size and the fraction of non-black pixels.
 *
 * This is the check that distinguishes a real reslice from a rotated copy: a
 * genuine coronal reconstruction of an axially-acquired volume has a DIFFERENT
 * slice count and a different pixel height from the axial view, and its middle
 * slice still contains anatomy.
 *
 * Nothing here is asserted about planes the data cannot support — a volume that
 * is flat along an axis is reported as "not offered", which is exactly what the
 * indexer does with it.
 */

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RenderedImage } from "../lib/dataset/image-render";
import type { DicomVolumeRef } from "../lib/dataset/types";

const PLANES = ["Axial", "Coronal", "Sagittal"] as const;

interface VolumeTarget {
  dataset: string;
  studyCode: string;
  volumeId: string;
  volume: DicomVolumeRef;
}

/** Same loader as scripts/dataset-index.ts — this runs outside Next.js, so .env.local is not read for us. */
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

  const { readNiftiGeometry, renderImage, dicomVolumeGeometry } = await import("../lib/dataset/image-render");
  const { readManifest } = await import("../lib/dataset/manifest-store");
  const { getLogsDir } = await import("../lib/dataset/config");

  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  let files: string[] = args;
  let source = "command line";
  /** Reconstructed DICOM stacks (CT MPR). Only ever discovered from the manifest — a stack is a list of files, not one path a user can pass. */
  const volumeTargets: VolumeTarget[] = [];

  if (files.length === 0) {
    source = "manifest";
    const manifest = readManifest();
    if (!manifest) {
      console.error("\n✗ No manifest found. Run `npm run dataset:index` first, or pass a .nii/.nii.gz path directly.\n");
      process.exit(1);
    }

    // One volume per distinct file, and at most a couple per dataset: decoding
    // every indexed volume would read gigabytes to prove the same thing.
    const perDataset = new Map<string, Set<string>>();
    const volumesSeen = new Map<string, Set<string>>();
    for (const study of manifest.studies) {
      for (const series of study.series) {
        if (series.volumeId) {
          const volume = study.volumes?.[series.volumeId];
          const bucket = volumesSeen.get(study.dataset) ?? new Set<string>();
          if (volume && !bucket.has(series.volumeId) && bucket.size < 2) {
            bucket.add(series.volumeId);
            volumeTargets.push({ dataset: study.dataset, studyCode: study.studyCode, volumeId: series.volumeId, volume });
          }
          volumesSeen.set(study.dataset, bucket);
        }
        /*
         * NIfTI planes are indexed as one compact run per plane (every slice is
         * a frame of the same file), so the path comes off the run. A series
         * with explicit per-file refs is walked instead.
         */
        const niftiPaths = series.frames
          ? series.frames.kind === "nifti"
            ? [series.frames.absPath]
            : []
          : series.images.filter((img) => img.kind === "nifti").map((img) => img.absPath);

        for (const absPath of niftiPaths) {
          const bucket = perDataset.get(study.dataset) ?? new Set<string>();
          if (bucket.size < 2) bucket.add(absPath);
          perDataset.set(study.dataset, bucket);
        }
      }
    }
    files = [...perDataset.values()].flatMap((s) => [...s]);

    if (files.length === 0 && volumeTargets.length === 0) {
      console.error("\n✗ The manifest contains no volumetric series, so there is nothing to reslice.\n");
      console.error("  That is a data fact, not a bug: only NIfTI files and multi-slice DICOM stacks are expanded per plane.\n");
      process.exit(1);
    }
  }

  const outDir = path.join(getLogsDir(), "mpr-check");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Checking ${files.length} volume(s) and ${volumeTargets.length} reconstructed DICOM stack(s) from the ${source}.`);
  console.log(`Rendered slices are written to: ${outDir}\n`);

  let failures = 0;
  let planesRendered = 0;

  for (const file of files) {
    console.log(path.basename(file));

    const geo = readNiftiGeometry(file);
    if (!geo) {
      console.log("  UNREADABLE — no NIfTI header could be parsed, so no plane is offered for this file.\n");
      failures++;
      continue;
    }

    console.log(`  dims        ${geo.dims.join(" x ")} voxels`);
    console.log(`  spacing     ${geo.spacing.map((s) => s.toFixed(4)).join(" x ")} mm`);
    console.log(
      `  transform   ${geo.hasSpatialTransform ? "qform/sform present — axis mapping measured from the affine" : "NONE — axis mapping falls back to the NIfTI default (assumed RAS)"}`
    );
    console.log(`  acquired    ${geo.acquiredPlane} (coarsest through-plane spacing)`);

    for (const plane of PLANES) {
      const p = geo.planes[plane];
      const label = plane === geo.acquiredPlane ? `${plane} (acquired)` : `${plane} (MPR)`;

      if (p.sliceCount < 2) {
        console.log(`  ${label.padEnd(20)} not offered — only ${p.sliceCount} slice along this axis`);
        continue;
      }

      const middle = Math.floor(p.sliceCount / 2);
      const started = Date.now();
      let rendered: RenderedImage;
      try {
        rendered = renderImage({
          id: "mpr-check",
          index: middle,
          kind: "nifti",
          absPath: file,
          frameIndex: middle,
          orientation: plane,
        });
      } catch (err) {
        console.log(`  ${label.padEnd(20)} RENDER FAILED — ${(err as Error).message}`);
        failures++;
        continue;
      }
      const ms = Date.now() - started;
      planesRendered++;

      const stem = path.basename(file).replace(/\.nii(\.gz)?$/i, "");
      const outFile = path.join(outDir, `${stem}-${plane.toLowerCase()}-${middle}.png`);
      fs.writeFileSync(outFile, rendered.bytes);

      const coverage = nonBlackFraction(rendered.bytes);
      const coverageNote = coverage === undefined ? "" : ` · ${(coverage * 100).toFixed(1)}% non-black`;
      console.log(
        `  ${label.padEnd(20)} ${String(p.sliceCount).padStart(4)} slices · ${p.width}x${p.height}px · ` +
          `through voxel axis ${p.through.axis} · slice ${middle} in ${ms}ms${coverageNote}`
      );
      console.log(`  ${"".padEnd(20)} → ${path.basename(outFile)}`);

      if (coverage !== undefined && coverage < 0.01) {
        console.log(`  ${"".padEnd(20)} WARNING: that slice is almost entirely black. Open the PNG before trusting this plane.`);
        failures++;
      }
    }
    console.log("");
  }

  for (const target of volumeTargets) {
    console.log(`${target.studyCode} · ${target.dataset} reconstructed stack (${target.volume.files.length} instances)`);

    const geo = dicomVolumeGeometry(target.volume);
    if (!geo) {
      console.log("  NOT RECONSTRUCTIBLE — the stored geometry is insufficient, so no reconstructed plane is offered.\n");
      failures++;
      continue;
    }

    console.log(`  matrix      ${geo.sourceColumns} x ${geo.sourceRows} per instance, decimated 1/${geo.step} in-plane`);
    console.log(`  dims        ${geo.dims.join(" x ")} voxels`);
    console.log(`  spacing     ${geo.spacing.map((s) => s.toFixed(4)).join(" x ")} mm`);
    console.log(
      `  slice step  ${geo.sliceDelta.toFixed(4)} mm ${
        geo.spacingFromPositions
          ? "measured from ImagePositionPatient"
          : "from SliceThickness/SpacingBetweenSlices (positions were missing)"
      }`
    );
    console.log(`  acquired    ${geo.acquiredPlane} (coarsest through-plane spacing)`);

    for (const plane of PLANES) {
      const p = geo.planes[plane];
      const label = plane === geo.acquiredPlane ? `${plane} (acquired)` : `${plane} (MPR)`;

      if (p.sliceCount < 2) {
        console.log(`  ${label.padEnd(20)} not offered — only ${p.sliceCount} slice along this axis`);
        continue;
      }

      const middle = Math.floor(p.sliceCount / 2);
      const started = Date.now();
      let rendered: RenderedImage;
      try {
        rendered = renderImage(
          {
            id: "mpr-check",
            index: middle,
            kind: "dicom-volume",
            // Pixels come from `volume.files`; this path only has to be a real
            // indexed instance, exactly as the image route requires.
            absPath: target.volume.files[0] ?? "",
            frameIndex: middle,
            orientation: plane,
          },
          { volume: target.volume }
        );
      } catch (err) {
        console.log(`  ${label.padEnd(20)} RENDER FAILED — ${(err as Error).message}`);
        failures++;
        continue;
      }
      const ms = Date.now() - started;
      planesRendered++;

      const outFile = path.join(outDir, `${target.studyCode}-${plane.toLowerCase()}-${middle}.png`);
      fs.writeFileSync(outFile, rendered.bytes);

      const coverage = nonBlackFraction(rendered.bytes);
      const coverageNote = coverage === undefined ? "" : ` · ${(coverage * 100).toFixed(1)}% non-black`;
      console.log(
        `  ${label.padEnd(20)} ${String(p.sliceCount).padStart(4)} slices · ${p.width}x${p.height}px · ` +
          `through voxel axis ${p.through.axis} · slice ${middle} in ${ms}ms${coverageNote}`
      );
      console.log(`  ${"".padEnd(20)} → ${path.basename(outFile)}`);

      if (coverage !== undefined && coverage < 0.01) {
        console.log(`  ${"".padEnd(20)} WARNING: that slice is almost entirely black. Open the PNG before trusting this plane.`);
        failures++;
      }
    }
    console.log("");
  }

  if (failures > 0) {
    console.log(`${planesRendered} plane(s) rendered, ${failures} problem(s) found.`);
    console.log("Nothing was substituted to hide them — a plane that cannot be reconstructed is simply not offered.\n");
    process.exit(1);
  }

  console.log(`${planesRendered} plane(s) rendered with no problems.`);
  console.log("Open the PNGs above: differing slice counts and pixel heights per plane are what prove these are reslices of the volume, not rotations of one image.\n");
}

/**
 * Fraction of pixels above near-black, read straight back out of the PNG we
 * just wrote. A real reslice of a real volume is never uniformly black; an
 * all-black plane means the axis mapping landed on an empty edge of the volume.
 */
function nonBlackFraction(png: Buffer): number | undefined {
  try {
    const decoded = PNG.sync.read(png);
    let lit = 0;
    for (let i = 0; i < decoded.data.length; i += 4) {
      if (decoded.data[i] > 8) lit++;
    }
    return lit / (decoded.data.length / 4);
  } catch {
    return undefined;
  }
}

main().catch((err) => {
  console.error("\nMPR check failed:\n", err);
  process.exit(1);
});
