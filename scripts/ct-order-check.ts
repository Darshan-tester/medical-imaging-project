/**
 * ---------------------------------------------------------------------------
 * CT SLICE ORDER CHECK
 * ---------------------------------------------------------------------------
 * Proves that the slice order baked into `public/demo-data/index.json` is the
 * true anatomical order of each DICOM series, by reading the committed
 * instances back and comparing against the geometry.
 *
 * Why this exists as a check rather than as a re-sort in the browser: the
 * viewer must never scan 443 DICOM files to work out what order they go in.
 * The order is decided once, at indexing time, and the index is the source of
 * truth from then on. That is only safe if something verifies the decision, so
 * this is that something — and it runs against the same bytes the deployed site
 * serves, not against the original corpus.
 *
 * What is checked, per series, in the order the index lists the files:
 *
 *   1. Every instance carries ImagePositionPatient (0020,0032) and
 *      ImageOrientationPatient (0020,0037), and every instance shares one
 *      orientation — otherwise it is not a single stack and no linear order is
 *      meaningful.
 *   2. Position projected onto the slice normal is strictly monotone. This is
 *      the real test: it fails for a filename string sort (IM1, IM10, IM100,
 *      IM11, ...), for interleaved acquisitions, and for a series that mixes a
 *      localiser in with the axials.
 *   3. Centre-to-centre spacing is uniform, so the stack has no gap or
 *      duplicate.
 *   4. The index order matches `orderDicomStack()` — the geometry-aware
 *      comparator the MPR path already uses — read either forwards or
 *      backwards. Backwards is not an error: a chest CT is presented apex-first
 *      (InstanceNumber 1 at the top of the lungs), which runs against
 *      increasing patient Z.
 *   5. InstanceNumber is monotone in the same direction, i.e. the display
 *      numbering the viewer shows as "17 / 443" agrees with the anatomy.
 *
 * Usage:
 *   npm run ct:order-check              # every DICOM series in the index
 *   npm run ct:order-check -- CT-27CEA6 # one study code
 *
 * Exits non-zero if any series fails, so it can gate a release.
 * ---------------------------------------------------------------------------
 */

import * as fs from "fs";
import * as path from "path";
import { readDicomSummary, orderDicomStack, DicomStackEntry } from "../lib/dataset/image-render";

/**
 * How far a single centre-to-centre step may sit from the series' nominal step
 * before it counts as a gap, as a fraction of that step.
 *
 * Not an absolute millimetre figure, deliberately. ImagePositionPatient arrives
 * as a DICOM decimal string with a handful of significant digits, so a real
 * 0.85 mm reconstruction lands anywhere in 0.8498..0.8509 — a 0.13 % spread that
 * is rounding, not anatomy. The failures worth catching are an order of
 * magnitude larger than that: a dropped slice doubles the step, and a duplicate
 * takes it to zero.
 */
const SPACING_TOLERANCE_FRACTION = 0.02;

/** Direction cosines are unit vectors; anything above this is a different plane, not rounding. */
const ORIENTATION_TOLERANCE = 1e-4;

interface IndexSeries {
  id: string;
  label: string;
  n: number;
  kind: string;
  orientation: string;
  files?: string[];
}

interface IndexStudy {
  id: string;
  code: string;
  modality: string;
  series: IndexSeries[];
}

const PUBLIC_DIR = path.join(process.cwd(), "public");
const INDEX_PATH = path.join(PUBLIC_DIR, "demo-data", "index.json");

/** `/demo-data/ct/.../IM442?dcm=1` → the file on disk that the Worker serves for it. */
function localPath(url: string): string {
  const clean = url.split("?")[0] ?? url;
  return path.join(PUBLIC_DIR, clean.replace(/^\//, ""));
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function sign(n: number): 1 | -1 {
  return n < 0 ? -1 : 1;
}

interface SeriesResult {
  study: string;
  series: string;
  label: string;
  count: number;
  ok: boolean;
  problems: string[];
  notes: string[];
}

function checkSeries(study: IndexStudy, series: IndexSeries): SeriesResult {
  const files = series.files ?? [];
  const result: SeriesResult = {
    study: study.code,
    series: series.id,
    label: series.label,
    count: files.length,
    ok: true,
    problems: [],
    notes: [],
  };

  const fail = (msg: string) => {
    result.ok = false;
    result.problems.push(msg);
  };

  if (files.length !== series.n) fail(`index declares n=${series.n} but lists ${files.length} files`);
  if (files.length === 0) {
    fail("no files listed");
    return result;
  }

  // Read in the order the index lists them — the whole point is to test that order.
  const entries: DicomStackEntry[] = [];
  for (const url of files) {
    const abs = localPath(url);
    if (!fs.existsSync(abs)) {
      fail(`missing asset: ${url}`);
      return result;
    }
    const summary = readDicomSummary(abs);
    if (!summary) {
      fail(`unreadable DICOM: ${url}`);
      return result;
    }
    entries.push({ absPath: abs, summary });
  }

  const missingIpp = entries.filter((e) => !e.summary.imagePositionPatient).length;
  const missingIop = entries.filter((e) => !e.summary.imageOrientationPatient).length;
  if (missingIpp > 0) fail(`${missingIpp}/${entries.length} instances have no ImagePositionPatient`);
  if (missingIop > 0) fail(`${missingIop}/${entries.length} instances have no ImageOrientationPatient`);
  if (missingIpp > 0 || missingIop > 0) return result;

  const iop = entries[0]!.summary.imageOrientationPatient!;
  const offPlane = entries.filter((e) =>
    e.summary.imageOrientationPatient!.some((v, i) => Math.abs(v - iop[i]!) > ORIENTATION_TOLERANCE)
  );
  if (offPlane.length > 0) {
    fail(`${offPlane.length} instances have a different ImageOrientationPatient — not one stack`);
    return result;
  }

  const normal = cross([iop[0], iop[1], iop[2]], [iop[3], iop[4], iop[5]]);
  const positions = entries.map((e) => dot(e.summary.imagePositionPatient!, normal));

  // 2 + 3: monotone along the slice normal, with uniform spacing.
  const step0 = positions[1]! - positions[0]!;
  if (step0 === 0) fail("first two slices sit at the same position");
  const dir = sign(step0);
  let minStep = Infinity;
  let maxStep = -Infinity;
  const steps: number[] = [];
  const breaks: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    const step = positions[i]! - positions[i - 1]!;
    if (step === 0 || sign(step) !== dir) breaks.push(i);
    steps.push(step);
    minStep = Math.min(minStep, step);
    maxStep = Math.max(maxStep, step);
  }
  if (breaks.length > 0) {
    fail(
      `position is not monotone — ${breaks.length} reversal(s), first at index ${breaks[0]} ` +
        `(${path.basename(entries[breaks[0]! - 1]!.absPath)} → ${path.basename(entries[breaks[0]!]!.absPath)})`
    );
  }

  const nominal = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)]!;
  const slack = Math.abs(nominal) * SPACING_TOLERANCE_FRACTION;
  const outliers = steps.filter((s) => Math.abs(s - nominal) > slack);
  if (outliers.length > 0) {
    const worst = outliers.reduce((a, b) => (Math.abs(b - nominal) > Math.abs(a - nominal) ? b : a));
    fail(
      `${outliers.length} of ${steps.length} gaps deviate from the ${Math.abs(nominal).toFixed(4)} mm ` +
        `nominal spacing by more than ${(SPACING_TOLERANCE_FRACTION * 100).toFixed(0)} % — worst ${worst.toFixed(4)} mm`
    );
  }

  // 4: same sequence the geometry-aware comparator produces, forwards or backwards.
  const spatial = orderDicomStack(entries).map((e) => e.absPath);
  const asIndexed = entries.map((e) => e.absPath);
  const forwards = spatial.join(" ") === asIndexed.join(" ");
  const backwards = spatial.join(" ") === [...asIndexed].reverse().join(" ");
  if (!forwards && !backwards) {
    const firstDiff = spatial.findIndex((p, i) => p !== asIndexed[i]);
    fail(
      `index order is neither orderDicomStack() nor its reverse — first difference at ${firstDiff}: ` +
        `index has ${path.basename(asIndexed[firstDiff]!)}, geometry wants ${path.basename(spatial[firstDiff]!)}`
    );
  }

  // 5: the number the viewer prints has to move with the anatomy.
  const instance = entries.map((e) => e.summary.instanceNumber);
  if (instance.some((v) => v === undefined)) {
    result.notes.push("some instances have no InstanceNumber");
  } else {
    const nums = instance as number[];
    const nDir = sign(nums[1]! - nums[0]!);
    const nBreaks = nums.filter((v, i) => i > 0 && sign(v - nums[i - 1]!) !== nDir).length;
    if (nBreaks > 0) {
      fail(`InstanceNumber is not monotone in index order — ${nBreaks} reversal(s)`);
    } else {
      result.notes.push(`InstanceNumber ${nums[0]} → ${nums[nums.length - 1]!} (${nDir > 0 ? "ascending" : "descending"})`);
    }
  }

  const loc = entries.map((e) => e.summary.sliceLocation);
  if (loc.every((v) => v !== undefined)) {
    result.notes.push(`SliceLocation ${(loc[0] as number).toFixed(3)} → ${(loc[loc.length - 1] as number).toFixed(3)} mm`);
  }
  result.notes.push(
    `step ${Math.abs(nominal).toFixed(4)} mm (${minStep.toFixed(4)}..${maxStep.toFixed(4)}), ` +
      `${dir > 0 ? "increasing" : "decreasing"} patient position`
  );
  result.notes.push(`geometry order: ${forwards ? "forwards" : backwards ? "reversed (presentation order)" : "mismatch"}`);
  result.notes.push(`${entries[0]!.summary.columns}×${entries[0]!.summary.rows} px`);

  return result;
}

function main(): void {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as { studies: IndexStudy[] };

  const targets: Array<{ study: IndexStudy; series: IndexSeries }> = [];
  for (const study of raw.studies) {
    if (filter.length > 0 && !filter.includes(study.code) && !filter.includes(study.id)) continue;
    for (const series of study.series) {
      if (series.kind !== "dicom" || !series.files) continue;
      targets.push({ study, series });
    }
  }

  if (targets.length === 0) {
    console.log("No per-file DICOM series matched. Nothing to check.");
    return;
  }

  console.log(`Checking ${targets.length} DICOM series from ${path.relative(process.cwd(), INDEX_PATH)}\n`);

  let failed = 0;
  for (const { study, series } of targets) {
    const started = Date.now();
    const r = checkSeries(study, series);
    const ms = Date.now() - started;
    const head = `${r.ok ? "PASS" : "FAIL"}  ${r.study}  ${r.label}  (${r.count} slices, ${ms} ms)`;
    console.log(head);
    for (const n of r.notes) console.log(`        ${n}`);
    for (const p of r.problems) console.log(`  !!    ${p}`);
    console.log();
    if (!r.ok) failed++;
  }

  if (failed > 0) {
    console.error(`${failed} series failed the slice-order check.`);
    process.exit(1);
  }
  console.log("All series are in true anatomical order.");
}

main();
