/**
 * ---------------------------------------------------------------------------
 * PATIENT PROFILE — demographics and anthropometrics, with provenance
 * ---------------------------------------------------------------------------
 * The report view needs name, age, sex, height, weight, BMI, BSA, history and
 * notes, because the analysis is normalized against them (SUV body-weight for
 * PET, dose and contrast by weight, BSA for cardiothoracic ratios).
 *
 * None of that exists in the source data. Measured over `.scanlab/manifest.json`
 * (v4, 2,314 studies): 0 carry `age`, 0 carry `sex`, and there is no height,
 * weight or history field anywhere in `DatasetStudy`. The reports are real; the
 * demographics were never part of these public datasets.
 *
 * So every value here is one of three things, and which one is always visible:
 *
 *   "source"    the dataset supplied it — passed through untouched
 *   "entered"   a human typed it on the Upload Scan form
 *   "simulated" generated deterministically from the study id, for the demo
 *   "derived"   computed (BMI, BSA); inherits the weaker badge of its inputs
 *
 * `Study.age` / `Study.sex` keep their documented contract of never being
 * fabricated: a simulated age lives in this profile and nowhere else, so any
 * code reading `study.age` still sees `undefined` and still renders
 * "Not available". The profile is what the UI badges.
 *
 * Pure and client-safe: no `fs`, no `Date.now()`, no `Math.random()`. Values are
 * a function of the study id alone (see `lib/seeded-random.ts` for why that has
 * to be per-study rather than a shared stream).
 * ---------------------------------------------------------------------------
 */
import { Modality } from "./types";
import { streamFor } from "./seeded-random";

/** Where a displayed value came from. Rendered as a badge, never hidden. */
export type FieldSource = "source" | "entered" | "simulated" | "derived";

export interface ProfileField<T> {
  value: T;
  source: FieldSource;
}

export interface PatientProfile {
  /** Display name. For dataset studies this is the alias, never a real name. */
  name: ProfileField<string>;
  age?: ProfileField<number>;
  sex?: ProfileField<"M" | "F" | "Other">;
  /** Centimetres. */
  heightCm?: ProfileField<number>;
  /** Kilograms, one decimal. */
  weightKg?: ProfileField<number>;
  /** kg/m², one decimal. Derived from height + weight. */
  bmi?: ProfileField<number>;
  /** m², two decimals. Mosteller: √(cm × kg / 3600). */
  bsaM2?: ProfileField<number>;
  /** Relevant history / pre-existing conditions, most relevant first. */
  history?: ProfileField<string[]>;
  /** Anything that changes how the images should be read. */
  notes?: ProfileField<string>;
}

/** True when any field in the profile was generated rather than supplied. */
export function profileHasSimulatedFields(p: PatientProfile): boolean {
  return Object.values(p).some(
    (f) => f && typeof f === "object" && "source" in f && (f as ProfileField<unknown>).source === "simulated",
  );
}

export function bmiFrom(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

/** Mosteller — the form used clinically, and the one that needs no lookup table. */
export function bsaFrom(heightCm: number, weightKg: number): number {
  return round(Math.sqrt((heightCm * weightKg) / 3600), 2);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * The weaker of two badges. A BMI computed from an entered weight and a
 * simulated height is not "entered" — it is only as trustworthy as its worst
 * input, so that is what gets shown.
 */
function weakest(a: FieldSource, b: FieldSource): FieldSource {
  const rank: Record<FieldSource, number> = { source: 3, entered: 2, derived: 1, simulated: 0 };
  return rank[a] <= rank[b] ? a : b;
}

/**
 * Coarse clinical topic, used to keep generated values plausible for the study
 * they sit next to: a screening mammogram should not be a 9-year-old, and a
 * lumbar-spine MRI should not carry a smoking-and-COPD history.
 */
type Topic = "chest" | "neuro" | "abdomen" | "msk" | "breast" | "oncology" | "general";

function topicFor(modality: Modality, bodyRegion?: string): Topic {
  const r = (bodyRegion ?? "").toLowerCase();
  if (modality === "Mammography" || r.includes("breast") || r.includes("mammo")) return "breast";
  if (modality === "PET") return "oncology";
  if (/brain|head|skull|neuro|spine|cervical|lumbar|thoracic spine|c-spine/.test(r)) return "neuro";
  if (/chest|thorax|lung|pulmon|cardi|rib/.test(r)) return "chest";
  if (/abdom|pelvi|liver|hepat|renal|kidney|bowel|gallbladder|thyroid|carotid/.test(r)) return "abdomen";
  if (/knee|shoulder|wrist|ankle|hip|femur|humerus|hand|foot|elbow|extremity/.test(r)) return "msk";
  if (modality === "X-Ray") return "chest";
  if (modality === "MRI") return "neuro";
  return "general";
}

const AGE_RANGE: Record<Topic, [number, number]> = {
  chest: [28, 86],
  neuro: [22, 84],
  abdomen: [24, 82],
  msk: [16, 78],
  breast: [40, 74],
  oncology: [35, 81],
  general: [21, 80],
};

const HISTORY_BY_TOPIC: Record<Topic, string[]> = {
  chest: ["Former smoker, ~20 pack-years", "COPD, GOLD stage II", "Hypertension", "Type 2 diabetes mellitus", "Prior pulmonary tuberculosis, treated", "Asthma, well controlled"],
  neuro: ["Hypertension", "Migraine with aura", "Prior transient ischaemic attack", "Type 2 diabetes mellitus", "Chronic low back pain", "Hyperlipidaemia"],
  abdomen: ["Cholelithiasis", "Chronic hepatitis B carrier", "Type 2 diabetes mellitus", "Prior appendicectomy", "Nephrolithiasis", "Hypothyroidism"],
  msk: ["Prior ipsilateral injury, conservatively managed", "Osteoarthritis", "Recreational running, ~30 km/week", "Rheumatoid arthritis on methotrexate"],
  breast: ["First-degree family history of breast carcinoma", "Prior benign biopsy (fibroadenoma)", "Postmenopausal, no HRT", "Dense breast tissue on prior screening"],
  oncology: ["Known primary malignancy under surveillance", "Completed chemotherapy 6 months ago", "Prior partial resection", "Type 2 diabetes mellitus"],
  general: ["Hypertension", "Type 2 diabetes mellitus", "Hyperlipidaemia", "No significant past medical history"],
};

const NOTES_BY_TOPIC: Record<Topic, string[]> = {
  chest: [
    "Unable to achieve full inspiration; mild basal crowding is positional.",
    "Rotated slightly to the left — assess mediastinal width with that in mind.",
    "Portable technique, AP projection: cardiac silhouette is magnified.",
  ],
  neuro: [
    "Motion during the later sequences; posterior fossa detail is reduced.",
    "No prior imaging available in this system for comparison.",
    "Contrast withheld — eGFR below local threshold.",
  ],
  abdomen: [
    "Non-fasting at the time of the examination.",
    "Bowel gas limits the acoustic window over the pancreatic head.",
    "Oral contrast only; no intravenous phase acquired.",
  ],
  msk: ["Symptoms localised to the lateral joint line.", "Immobilised at the time of imaging; positioning is non-standard."],
  breast: ["Palpable area of concern marked by the technologist prior to acquisition.", "Prior screening study not available for comparison."],
  oncology: ["Fasting blood glucose within protocol range at injection.", "Uptake time 62 minutes post-injection.", "Brown fat uptake expected in the supraclavicular regions."],
  general: ["No prior study available for comparison.", "Examination performed without intravenous contrast."],
};

const HEIGHT_RANGE: Record<"M" | "F" | "Other", [number, number]> = {
  M: [162, 188],
  F: [150, 174],
  Other: [155, 183],
};

/**
 * Rough median stature by age in years, linearly interpolated between points.
 *
 * Only needs to be good enough that a paediatric case does not read as a 175 cm
 * seven-year-old. It is reached only when an age under 18 is known, and the only
 * way that happens here is a report that states the age in its own text.
 */
const PAEDIATRIC_STATURE: readonly [number, number][] = [
  [0, 50],
  [1, 75],
  [2, 87],
  [4, 102],
  [6, 115],
  [8, 128],
  [10, 138],
  [12, 149],
  [14, 162],
  [16, 168],
  [18, 171],
];

function paediatricHeightCm(age: number): number {
  if (age <= PAEDIATRIC_STATURE[0][0]) return PAEDIATRIC_STATURE[0][1];
  for (let i = 1; i < PAEDIATRIC_STATURE.length; i++) {
    const [a1, h1] = PAEDIATRIC_STATURE[i];
    if (age <= a1) {
      const [a0, h0] = PAEDIATRIC_STATURE[i - 1];
      return h0 + ((age - a0) / (a1 - a0)) * (h1 - h0);
    }
  }
  return PAEDIATRIC_STATURE[PAEDIATRIC_STATURE.length - 1][1];
}

/**
 * Age and sex quoted from a report's own text.
 *
 * Measured over the v4 manifest: 3 of 2,314 reports state an age and a few dozen
 * state a sex, nearly all of them ROCOV2 case-report captions ("3D reformatted
 * CT scan in a 10-years-old-girl showed…"). A tiny number — and exactly the
 * studies where a generated value would contradict a sentence printed on the
 * same screen. A panel reading 63 y / Female beside a report reading "7-year old
 * boy" is worse than no demographics at all.
 *
 * Deliberately narrow. A bare "M" or "F" token is not accepted, because series
 * labels and units produce those, and an age is only taken from an explicit
 * "<n> year(s) old". MIMIC-CXR's de-identified "___-year-old man" therefore
 * yields a sex and no age, which is the truth of it.
 */
const AGE_RE = /\b(\d{1,3})\s*[-–]?\s*(?:year|yr)s?\s*[-–]?\s*old\b/i;
const MALE_RE = /\b(?:male|man|boy|gentleman)\b/i;
const FEMALE_RE = /\b(?:female|woman|girl|lady)\b/i;

export function extractDemographics(text: string | undefined): { age?: number; sex?: "M" | "F" } {
  if (!text) return {};
  const out: { age?: number; sex?: "M" | "F" } = {};

  const m = AGE_RE.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 120) out.age = n;
  }

  // "female" contains "male", but not as a word, so the boundaries settle it.
  // Where both appear, the first mention wins.
  const f = FEMALE_RE.exec(text);
  const male = MALE_RE.exec(text);
  if (f && male) out.sex = f.index < male.index ? "F" : "M";
  else if (f) out.sex = "F";
  else if (male) out.sex = "M";

  return out;
}

export interface ProfileInput {
  /** Stable id. The only thing generated values depend on. */
  studyId: string;
  /** Alias for dataset studies, typed identifier for uploads. */
  displayName: string;
  modality: Modality;
  bodyRegion?: string;
  /** Real values. Any that are present are passed through and badged `supplied`. */
  age?: number;
  sex?: "M" | "F" | "Other";
  heightCm?: number;
  weightKg?: number;
  history?: string[];
  notes?: string;
  /**
   * Badge to apply to whatever the caller supplied. `"simulated"` is a real
   * option, and the one the seeded demo studies in `lib/mock-data.ts` use: they
   * already carry a generated age and sex on the `Study` itself, and passing
   * those in here keeps the number the studies table shows identical to the
   * number the report column shows, while still marking both as demo values.
   */
  supplied?: Extract<FieldSource, "source" | "entered" | "simulated">;

  /**
   * Fill the gaps with generated values (default). Pass `false` to get a
   * profile containing only what was actually supplied — which is what a caller
   * that must not display demo values should do.
   */
  simulateMissing?: boolean;
}

/**
 * Builds the profile shown in the report's patient column.
 *
 * Supplied values always win. Everything missing is generated from `studyId`
 * when `simulateMissing` is left on, and every generated value is badged
 * `simulated` so the UI can mark it. Height and weight are drawn as a pair via
 * a target BMI rather than independently — independent draws produce 150 cm at
 * 96 kg often enough to be noticed.
 */
export function buildPatientProfile(input: ProfileInput): PatientProfile {
  const supplied: Extract<FieldSource, "source" | "entered" | "simulated"> = input.supplied ?? "source";
  const simulate = input.simulateMissing !== false;
  const topic = topicFor(input.modality, input.bodyRegion);
  const r = streamFor(input.studyId, "profile");

  const profile: PatientProfile = {
    name: { value: input.displayName, source: supplied },
  };

  /*
   * Every candidate is drawn up front, in a fixed order, whether or not it ends
   * up being used. Otherwise supplying one field would shift the values
   * generated for the others — an entered age would silently change the
   * patient's height, and the same study would look different depending on
   * which boxes a user happened to fill in.
   */
  /*
   * One draw, so nothing downstream in the stream shifts. Near 50/50, with
   * "Other" rare: at a fifth of all studies it read as a data-entry fault rather
   * than as a demographic, and these datasets record only M or F where they
   * record anything at all. The upload form still offers it as a choice.
   */
  const sexRoll = r.float();
  const drawnSex: "M" | "F" | "Other" = sexRoll < 0.49 ? "M" : sexRoll < 0.98 ? "F" : "Other";
  const [ageMin, ageMax] = AGE_RANGE[topic];
  const drawnAge = r.int(ageMin, ageMax);
  const drawnBmi = r.range(18.8, 31.4);
  /* Drawn unconditionally, like everything else here, so supplying an age does
     not shift the values generated for the other fields. Read as a position
     within an age-dependent band, because a child's BMI is not comparable to an
     adult's: 18.8 is unremarkable at 40 and near the 97th centile at 7. */
  const childBmiFactor = r.float();
  const heightFactor = r.float();
  const historyRoll = r.float();

  const historyPool = [...HISTORY_BY_TOPIC[topic]];
  const historyCount = historyRoll < 0.2 ? 0 : historyRoll < 0.6 ? 1 : historyRoll < 0.88 ? 2 : 3;
  const drawnHistory: string[] = [];
  for (let i = 0; i < historyCount && historyPool.length > 0; i++) {
    drawnHistory.push(historyPool.splice(r.int(0, historyPool.length - 1), 1)[0]);
  }
  const drawnNote = r.pick(NOTES_BY_TOPIC[topic]);

  // Screening mammography in these datasets is a female population; generating
  // anything else beside a real mammogram report would read as a data error.
  const effectiveSex = input.sex ?? (topic === "breast" ? "F" : drawnSex);

  if (input.sex !== undefined) profile.sex = { value: input.sex, source: supplied };
  else if (simulate) profile.sex = { value: effectiveSex, source: "simulated" };

  if (input.age !== undefined) profile.age = { value: input.age, source: supplied };
  else if (simulate) profile.age = { value: drawnAge, source: "simulated" };

  const [hMin, hMax] = HEIGHT_RANGE[effectiveSex];
  /*
   * A known age under 18 comes from the report's own words, so the body has to
   * follow it: an adult stature range beside "7-year old boy" is the same
   * contradiction, one field over.
   */
  const effectiveAge = input.age ?? drawnAge;
  const child = effectiveAge < 18;
  const drawnHeight = child
    ? Math.round(paediatricHeightCm(effectiveAge) + (heightFactor - 0.5) * 9)
    : Math.round(hMin + heightFactor * (hMax - hMin));
  const heightCm = input.heightCm ?? (simulate ? drawnHeight : undefined);
  const heightSource: FieldSource = input.heightCm !== undefined ? supplied : "simulated";
  if (heightCm !== undefined) profile.heightCm = { value: heightCm, source: heightSource };

  // Weight follows from height and a target BMI, so the pair stays coherent.
  // The paediatric band tracks age: roughly the median for that age, ±2.
  const childBmiMid = 14.6 + 0.3 * Math.min(18, Math.max(2, effectiveAge));
  const targetBmi = child ? childBmiMid - 2 + childBmiFactor * 4 : drawnBmi;
  const weightKg =
    input.weightKg ?? (simulate && heightCm !== undefined ? round(targetBmi * (heightCm / 100) ** 2, 1) : undefined);
  const weightSource: FieldSource = input.weightKg !== undefined ? supplied : "simulated";
  if (weightKg !== undefined) profile.weightKg = { value: weightKg, source: weightSource };

  if (heightCm !== undefined && weightKg !== undefined) {
    const derived = weakest(heightSource, weightSource);
    profile.bmi = { value: bmiFrom(heightCm, weightKg), source: derived === "simulated" ? "simulated" : "derived" };
    profile.bsaM2 = { value: bsaFrom(heightCm, weightKg), source: derived === "simulated" ? "simulated" : "derived" };
  }

  /*
   * No generated history for a child: every pool here is adult ("Former smoker,
   * ~20 pack-years", "Postmenopausal"), and there is no honest paediatric list to
   * draw from. History is optional in the UI, so it is simply absent.
   */
  if (input.history && input.history.length > 0) profile.history = { value: input.history, source: supplied };
  else if (simulate && !child && drawnHistory.length > 0) profile.history = { value: drawnHistory, source: "simulated" };

  if (input.notes && input.notes.trim()) profile.notes = { value: input.notes.trim(), source: supplied };
  else if (simulate) profile.notes = { value: drawnNote, source: "simulated" };



  return profile;
}
