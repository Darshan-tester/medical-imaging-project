/**
 * Self-check for the simulated-findings + patient-profile layer.
 *
 * Run with:
 *   npm run findings:check
 *   npm run findings:check -- --manifest some/other/manifest.json
 *
 * Two halves.
 *
 * FIXTURES. Report sentences written for this test — they are not from any
 * patient record — one per modality-specific phrasing. Each asserts the three
 * things the viewer depends on: that a finding is produced at all (no finding
 * means no Original/Annotated switch), that the label is the specific one and
 * not a flattened general one, and that the box lands on the side and at the
 * height the sentence names. Three negatives must stay silent. This half exists
 * because the indexed set holds 0 Mammography studies and exactly 1 Ultrasound,
 * so the real manifest proves almost nothing about those two paths.
 *
 * SWEEP. Every study in `.scanlab/manifest.json`, put through the same
 * `toAppStudy` conversion the API routes use, so this measures the production
 * path rather than an approximation of it. Reports annotated coverage per
 * modality and checks the properties the R2 mirror depends on: determinism,
 * boxes and slice indices in range, complete patient profiles, derived BMI/BSA
 * that agree with their own height and weight, and descriptions quoted verbatim
 * from the study's own report.
 *
 * Exits non-zero if any assertion fails. A missing manifest skips the sweep with
 * a note rather than failing — run `npm run dataset:index` first.
 */

import fs from "fs";
import path from "path";
import { simulateFindings } from "../lib/simulated-findings";
import { bmiFrom, bsaFrom } from "../lib/patient-profile";
import { toAppStudy } from "../lib/dataset/to-app-study";
import type { DatasetManifest, DatasetStudy } from "../lib/dataset/types";
import type { SeriesInfo } from "../lib/types";

type XBucket = "L" | "C" | "R";
type YBucket = "hi" | "mid" | "lo";

/** id, sentence, expected label (null = must stay silent), expected x, expected y. */
type Fixture = readonly [string, string, string | null, XBucket | null, YBucket | null];

const failures: string[] = [];
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/*
 * L is viewer-left, which is the patient's right on a frontal or axial image;
 * hi/mid/lo are the upper third, middle and lower third of the frame.
 */
const FIXTURES: Fixture[] = [
  // --- Mammography (0 indexed studies, so this is the only coverage) -------
  ["mammo-1", "Clustered pleomorphic microcalcifications in the left upper outer quadrant.", "Microcalcifications", "R", "hi"],
  ["mammo-2", "There is architectural distortion in the right lower inner quadrant at the 8 o'clock position.", "Architectural distortion", "L", "lo"],
  ["mammo-3", "An irregular spiculated mass is seen in the retroareolar region of the left breast.", "Spiculated margin", "R", "mid"],
  ["mammo-4", "A well-circumscribed oval fibroadenoma is present in the right axillary tail.", "Fibroadenoma", "L", "hi"],
  ["mammo-5", "Assessment is BI-RADS category 4B, suspicious.", "BI-RADS category", "C", "mid"],
  ["mammo-6", "Focal skin thickening with nipple retraction on the left.", "Skin / nipple change", "R", "mid"],
  ["mammo-7", "Developing asymmetry in the left upper quadrant compared with the prior study.", "Asymmetry", "R", "hi"],
  ["mammo-8", "Ductal ectasia is noted in the subareolar region of the right breast.", "Ductal change", "L", "mid"],
  // --- Ultrasound / sonography (1 indexed study) --------------------------
  ["us-1", "The color Doppler demonstrates severe tricuspid valve regurgitation.", "Valvular regurgitation", "L", "mid"],
  // "Nodule" beats "Hypoechoic focus" here and should: the nodule is the
  // finding, and its echogenicity is a descriptor of it. Same for us-3.
  ["us-2", "A hypoechoic nodule with irregular margins in the left lobe of the thyroid.", "Nodule", "R", "hi"],
  ["us-3", "An anechoic simple cyst is seen in the right kidney.", "Cyst", "L", "mid"],
  ["us-4", "Echogenic gallstones are seen within the gallbladder lumen with posterior acoustic shadowing.", "Calculus", "C", "hi"],
  ["us-5", "Moderate right hydronephrosis with a dilated proximal ureter.", "Hydronephrosis", "L", "mid"],
  ["us-6", "There is free fluid in the pelvis consistent with ascites.", "Free fluid", "C", "lo"],
  ["us-7", "The liver is enlarged and shows increased echogenicity compatible with hepatic steatosis.", "Hepatic steatosis", "C", "hi"],
  ["us-8", "Non-compressible thrombus is present in the left popliteal vein.", "Thrombus", "R", "lo"],
  ["us-9", "Regional hypokinesis of the mid inferior wall is observed.", "Wall-motion abnormality", "C", "mid"],
  ["us-10", "A septated cystic lesion is seen in the right adnexa.", "Cyst", "L", "lo"],
  // --- MRI / CT / X-Ray phrasings added at the same time ------------------
  ["mri-1", "Mild widening is noted in the sulci of the bilateral occipital lobes.", "Sulcal widening", "C", "lo"],
  ["mri-2", "Bilateral maxillary retention cysts are observed.", "Cyst", "C", "mid"],
  ["mri-3", "Concha bullosa is present on the left with inferior turbinate hypertrophy.", "Concha bullosa", "R", "lo"],
  ["mri-4", "Mucosal thickening in the left maxillary sinus is compatible with sinusitis.", "Sinusitis", "R", "mid"],
  ["mri-5", "A pituitary microadenoma is suspected in the right half of the gland.", "Adenoma", "L", "mid"],
  ["mri-6", "Periventricular plaques are noted, compatible with multiple sclerosis.", "Demyelinating plaque", "C", "hi"],
  ["xr-1", "The cardiac silhouette is mildly enlarged.", "Cardiomegaly", "C", "mid"],
  ["xr-2", "Lung volumes are low with secondary crowding of the bronchovascular structures.", "Low lung volumes", "C", "mid"],
  ["xr-3", "Endotracheal tube is low, with the tip projecting over the proximal left mainstem bronchus.", "Tube malposition", "R", "mid"],
  ["xr-4", "Severe osteolytic involvement of the right hip is present.", "Osteolysis", "L", "mid"],
  ["xr-5", "There is thoracolumbar kyphoscoliosis convex to the right.", "Spinal deformity", "L", "lo"],
  // --- must stay silent ---------------------------------------------------
  ["neg-1", "No microcalcifications, masses or architectural distortion are seen.", null, null, null],
  ["neg-2", "The breast parenchyma is unremarkable with no suspicious findings.", null, null, null],
  ["neg-3", "No hydronephrosis, calculus or free fluid is identified.", null, null, null],
];

/** One flat image: the fixtures test the language, not the geometry. */
const FIXTURE_SERIES: SeriesInfo[] = [
  { id: "s1", label: "Image", sliceCount: 1, orientation: "Unknown" },
];

function bucketX(cx: number): XBucket {
  return cx < 0.44 ? "L" : cx > 0.56 ? "R" : "C";
}

function bucketY(cy: number): YBucket {
  return cy < 0.4 ? "hi" : cy > 0.6 ? "lo" : "mid";
}

function runFixtures(): void {
  console.log(`--- fixtures (${FIXTURES.length}) ---`);
  let pass = 0;

  for (const [id, sentence, label, wantX, wantY] of FIXTURES) {
    const out = simulateFindings({
      studyId: id,
      // Modality does not steer the vocabulary — the report's own words do —
      // so one value is enough for every case here.
      modality: "Mammography",
      series: FIXTURE_SERIES,
      reportFindings: sentence,
    });

    if (label === null) {
      if (out.length === 0) {
        pass++;
        console.log(`  ok    ${id.padEnd(8)} silent`);
      } else {
        failures.push(`${id}: expected silence, got "${out[0].label}"`);
        console.log(`  FAIL  ${id.padEnd(8)} expected silence, got ${out[0].label}`);
      }
      continue;
    }

    const f = out[0];
    if (!f) {
      failures.push(`${id}: no finding produced — the Annotated switch would not appear`);
      console.log(`  FAIL  ${id.padEnd(8)} no finding`);
      continue;
    }

    const cx = f.region.x + f.region.w / 2;
    const cy = f.region.y + f.region.h / 2;
    const gotX = bucketX(cx);
    const gotY = bucketY(cy);
    const bad: string[] = [];
    if (f.label !== label) bad.push(`label "${f.label}" != "${label}"`);
    if (gotX !== wantX) bad.push(`x ${gotX} (${cx.toFixed(2)}) != ${wantX}`);
    if (gotY !== wantY) bad.push(`y ${gotY} (${cy.toFixed(2)}) != ${wantY}`);
    if (norm(f.description) !== norm(sentence)) bad.push("description is not the sentence verbatim");

    if (bad.length === 0) {
      pass++;
      console.log(`  ok    ${id.padEnd(8)} ${f.label.padEnd(24)} ${gotX}/${gotY}  conf ${f.confidence}`);
    } else {
      failures.push(`${id}: ${bad.join("; ")}`);
      console.log(`  FAIL  ${id.padEnd(8)} ${bad.join("; ")}`);
    }
  }

  console.log(`  ${pass}/${FIXTURES.length} fixtures passed`);
}

function manifestPath(): string {
  const i = process.argv.indexOf("--manifest");
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.resolve(process.cwd(), ".scanlab", "manifest.json");
}

interface ModalityRow {
  studies: number;
  annotated: number;
  findings: number;
}

function runSweep(studies: DatasetStudy[]): void {
  const per = new Map<string, ModalityRow>();
  const labels = new Map<string, number>();
  let exercised = 0;
  let nonDeterministic = 0;
  let outOfRange = 0;
  let profileMissing = 0;
  let derivedMismatch = 0;
  let notQuoted = 0;

  for (const ds of studies) {
    if (!ds.series || ds.series.length === 0) continue;
    exercised++;

    const study = toAppStudy(ds);
    const again = toAppStudy(ds);
    if (JSON.stringify(study.findings) !== JSON.stringify(again.findings)) nonDeterministic++;
    if (JSON.stringify(study.patientProfile) !== JSON.stringify(again.patientProfile)) nonDeterministic++;

    const row = per.get(ds.modality) ?? { studies: 0, annotated: 0, findings: 0 };
    row.studies++;
    if (study.findings.length > 0) {
      row.annotated++;
      row.findings += study.findings.length;
    }
    per.set(ds.modality, row);

    const reportText = norm(ds.report?.text ?? "");

    for (const f of study.findings) {
      labels.set(f.label, (labels.get(f.label) ?? 0) + 1);

      const r = f.region;
      const boxOk =
        r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;
      const host = study.series.find((s) => s.id === f.seriesId) ?? study.series[0];
      const sliceOk = f.sliceIndex >= 0 && f.sliceIndex <= Math.max(0, host.sliceCount - 1);
      const confOk = f.confidence >= 1 && f.confidence <= 99;

      if (!boxOk || !sliceOk || !confOk) {
        outOfRange++;
        if (outOfRange <= 5) console.log(`  RANGE ${ds.id} ${JSON.stringify(f)}`);
      }
      if (reportText && !reportText.includes(norm(f.description))) {
        notQuoted++;
        if (notQuoted <= 5) console.log(`  NOT QUOTED ${ds.id}: "${f.description}"`);
      }
    }

    const p = study.patientProfile;
    if (!p || !p.age || !p.sex || !p.heightCm || !p.weightKg || !p.bmi || !p.bsaM2) {
      profileMissing++;
    } else {
      const h = p.heightCm.value;
      const w = p.weightKg.value;
      if (Math.abs(p.bmi.value - bmiFrom(h, w)) > 1e-9) derivedMismatch++;
      if (Math.abs(p.bsaM2.value - bsaFrom(h, w)) > 1e-9) derivedMismatch++;
      if (p.bmi.value < 13 || p.bmi.value > 45) derivedMismatch++;
    }
  }

  const annotated = [...per.values()].reduce((n, r) => n + r.annotated, 0);
  console.log(`\n  studies exercised: ${exercised}   with >= 1 annotation: ${annotated}`);
  for (const [modality, r] of [...per.entries()].sort()) {
    const pct = ((100 * r.annotated) / r.studies).toFixed(1);
    console.log(
      `    ${modality.padEnd(12)} studies ${String(r.studies).padStart(5)}` +
        `   annotated ${String(r.annotated).padStart(5)} (${pct.padStart(5)}%)` +
        `   avg boxes ${(r.findings / Math.max(1, r.annotated)).toFixed(2)}`
    );
  }

  console.log("\n  invariants (each must be 0)");
  const checks: [string, number][] = [
    ["non-deterministic repeats", nonDeterministic],
    ["out-of-range box/slice/confidence", outOfRange],
    ["profiles missing a field", profileMissing],
    ["derived BMI/BSA disagreeing", derivedMismatch],
    ["descriptions not quoted from the report", notQuoted],
  ];
  for (const [name, n] of checks) {
    console.log(`    ${n === 0 ? "ok  " : "FAIL"}  ${name.padEnd(40)} ${n}`);
    if (n !== 0) failures.push(`sweep: ${name} = ${n}`);
  }

  console.log("\n  most common labels");
  [...labels.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([l, n]) => console.log(`    ${String(n).padStart(5)}  ${l}`));
}

function main(): void {
  runFixtures();

  const mp = manifestPath();
  if (!fs.existsSync(mp)) {
    console.log(`\n--- sweep skipped: no manifest at ${mp} ---`);
    console.log("Run npm run dataset:index first if you want the real-study half.");
  } else {
    const manifest = JSON.parse(fs.readFileSync(mp, "utf8")) as DatasetManifest;
    console.log(`\n--- sweep: manifest v${manifest.version}, ${manifest.studies?.length ?? 0} studies ---`);
    runSweep(manifest.studies ?? []);
  }

  if (failures.length === 0) {
    console.log("\nAll checks passed.\n");
    return;
  }
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("");
  process.exitCode = 1;
}

main();
