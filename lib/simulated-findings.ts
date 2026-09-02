/**
 * ---------------------------------------------------------------------------
 * SIMULATED LOCALISATION OF REAL REPORT FINDINGS
 * ---------------------------------------------------------------------------
 * The viewer has always been able to draw boxes over an image: `Finding.region`
 * is a normalized 0-1 bbox and `AIOverlay` inside `ImageViewer` renders it. For
 * real dataset studies that machinery has simply had nothing to draw — measured
 * over the v4 manifest, 0 of 2,314 studies carry `aiFindings`, because no model
 * has ever run against them.
 *
 * This module fills that gap for the demo, and the split of what is real and
 * what is not is deliberate:
 *
 *   REAL       the finding's text. Each one is a sentence lifted verbatim from
 *              the study's own report, so the box you see corresponds to a
 *              finding that a radiologist actually wrote about this image.
 *   SIMULATED  where the box sits, and the confidence percentage. Both are
 *              derived from words in that sentence — laterality, zone, size —
 *              not from the pixels. Nothing here looks at the image.
 *
 * That is why callers must set `aiStatus: "simulated"`, and why the UI badges it
 * as such: a plausible box in roughly the right lung is not a detection, and
 * must never be presentable as one.
 *
 * Studies whose reports are entirely negative produce no findings at all. There
 * is nothing to point at, and drawing a box labelled "no acute abnormality"
 * would be worse than drawing nothing.
 *
 * Pure and client-safe: no `fs`, no clock, no `Math.random()`. Output is a
 * function of the study id and its report text, so `mirror-export` and a local
 * render produce byte-identical JSON.
 * ---------------------------------------------------------------------------
 */
import { AIConfidenceBand, Finding, Modality, SeriesInfo } from "./types";
import { streamFor } from "./seeded-random";

/**
 * Splits report prose into sentences without a lookbehind regex — Safari only
 * gained those in 16.4, and an unsupported lookbehind is a parse-time crash
 * rather than a graceful degradation.
 *
 * Deliberately tolerant: a decimal point ("1.5 cm") is not a boundary, and a
 * period not followed by whitespace is not one either.
 */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== "." && ch !== ";" && ch !== "!" && ch !== "?") continue;

    const prev = clean[i - 1];
    const next = clean[i + 1];
    if (ch === "." && isDigit(prev) && isDigit(next)) continue;
    if (next !== undefined && next !== " ") continue;

    const s = clean.slice(start, i + 1).trim();
    if (s) out.push(s);
    start = i + 1;
  }

  const tail = clean.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Abnormality cues, most specific first. The matched entry supplies the short
 * label; the sentence itself stays the description. A sentence with no cue is
 * skipped rather than given a generic label — "Finding 1" over a real patient
 * image tells the reader nothing and implies more than we know.
 */
const CUES: { re: RegExp; label: string }[] = [
  { re: /pneumothorax/i, label: "Pneumothorax" },
  { re: /pneumoperitoneum|free air/i, label: "Free air" },
  { re: /consolidat/i, label: "Consolidation" },
  { re: /pneumonia|pneumonic/i, label: "Pneumonia" },
  { re: /pleural effusion|effusion/i, label: "Effusion" },
  { re: /atelectas|collapse/i, label: "Atelectasis" },
  { re: /cardiomegal|enlarged cardiac|cardiothoracic ratio/i, label: "Cardiomegaly" },
  { re: /ground.?glass/i, label: "Ground-glass opacity" },
  { re: /opacit|opacif/i, label: "Opacity" },
  { re: /infiltrat/i, label: "Infiltrate" },
  { re: /emphysema|emphysematous/i, label: "Emphysema" },
  { re: /bronchiectas/i, label: "Bronchiectasis" },
  { re: /fibrosis|fibrotic|reticulat/i, label: "Fibrosis" },
  { re: /granulom/i, label: "Granuloma" },
  { re: /metasta/i, label: "Metastatic focus" },
  { re: /carcinoma|tumou?r|malignan|neoplas/i, label: "Neoplastic focus" },
  { re: /nodul/i, label: "Nodule" },
  { re: /\bmass\b|lesion/i, label: "Lesion" },
  { re: /fracture|fractured/i, label: "Fracture" },
  { re: /dislocat|subluxat/i, label: "Dislocation" },
  { re: /h[ae]morrhage|h[ae]matoma|bleed/i, label: "Haemorrhage" },
  { re: /infarct|isch[ae]mi/i, label: "Infarct" },
  { re: /midline shift|mass effect|herniation of the/i, label: "Mass effect" },
  { re: /hydrocephalus|ventriculomegal/i, label: "Hydrocephalus" },
  { re: /hyperintens/i, label: "T2 hyperintensity" },
  { re: /hypointens/i, label: "T1 hypointensity" },
  { re: /hypodens|hypoattenuat|hypoechoic/i, label: "Hypodensity" },
  { re: /hyperdens|hyperattenuat|hyperechoic/i, label: "Hyperdensity" },
  { re: /disc (protrusion|herniation|bulge|extrusion)|disc desiccation/i, label: "Disc protrusion" },
  { re: /stenosis|narrowing|impingement/i, label: "Stenosis" },
  { re: /spondylo|degenerative|osteophyt|osteoarthr/i, label: "Degenerative change" },
  { re: /calcification|calcified/i, label: "Calcification" },
  { re: /microcalcification/i, label: "Microcalcifications" },
  { re: /fdg|suv|hypermetabolic|avid uptake|increased uptake|tracer uptake/i, label: "Hypermetabolic focus" },
  { re: /aneurysm|dissection/i, label: "Vascular abnormality" },
  { re: /thicken/i, label: "Wall thickening" },
  { re: /dilat|distend|ectasia/i, label: "Dilatation" },
  { re: /cyst\b|cystic/i, label: "Cyst" },
  { re: /hernia\b/i, label: "Hernia" },
  { re: /oedema|edema|swelling|effusive/i, label: "Oedema" },
  { re: /tear\b|torn\b|rupture/i, label: "Tear" },
  { re: /lymphadenopathy|enlarged (lymph )?node/i, label: "Lymphadenopathy" },
  { re: /abscess|collection/i, label: "Collection" },
  { re: /scarring|scar\b|sequel/i, label: "Scarring" },
];

/**
 * Rejects a cue that the sentence is actually denying. "There is no focal
 * consolidation" matches the consolidation cue and must not become a finding.
 *
 * Only the text before the cue is considered, and an adversative cancels the
 * negation — in "no consolidation, however a small left effusion is seen" the
 * effusion is real and the consolidation is not.
 */
function isNegatedAt(sentence: string, cueIndex: number): boolean {
  const prefix = sentence.slice(0, cueIndex);
  if (/\b(?:but|however|although|though|except|apart from|aside from|whereas)\b/i.test(prefix)) return false;
  return /\b(?:no|not|nor|never|without|absent|absence|negative|free of|denies|nil|unremarkable|clear|resolved|regress)\b/i.test(
    prefix,
  );
}

/**
 * Horizontal placement from laterality words.
 *
 * The centres look inverted and are not: on a frontal radiograph or an axial
 * slice the patient's right side appears on the *viewer's left*, so "right lower
 * lobe" belongs at a low x. Getting this backwards would put every box on the
 * wrong side of every chest image.
 */
const LATERALITY: { re: RegExp; cx: number; widen?: boolean }[] = [
  { re: /\bbilateral|bilaterally|both lungs|both sides|either side/i, cx: 0.5, widen: true },
  { re: /\bright\b|\brt\b|right-sided/i, cx: 0.33 },
  { re: /\bleft\b|\blt\b|left-sided/i, cx: 0.66 },
  { re: /midline|central|median/i, cx: 0.5 },
];

/** Vertical placement from zone / level words. */
const ZONES: { re: RegExp; cy: number }[] = [
  { re: /apic|apex|upper (lobe|zone|lung)|supraclavicular|superior segment/i, cy: 0.25 },
  { re: /mid.?zone|mid.?lung|middle lobe|mid.?thoracic/i, cy: 0.45 },
  { re: /lower (lobe|zone|lung)|bas(e|al|ilar)|diaphragm|costophrenic|infrahilar/i, cy: 0.68 },
  { re: /retrocardiac/i, cy: 0.62 },
  { re: /hil(um|ar)|perihilar|mediastin|paratracheal|carina/i, cy: 0.46 },
  { re: /frontal lobe|vertex|corona radiata|centrum semiovale|periventricular|parietal/i, cy: 0.3 },
  { re: /cerebell|posterior fossa|brain ?stem|pons|medulla|occipital/i, cy: 0.68 },
  { re: /temporal|insula|basal ganglia|thalam/i, cy: 0.5 },
  { re: /\bc[1-7]\b|cervical/i, cy: 0.27 },
  { re: /\bt(1[0-2]|[1-9])\b|thoracic spine/i, cy: 0.47 },
  { re: /\bl[1-5]\b|lumbar|sacr|coccy/i, cy: 0.68 },
  { re: /upper outer quadrant|upper quadrant|subareolar/i, cy: 0.33 },
  { re: /lower quadrant|inframammary/i, cy: 0.67 },
];

const SMALL = /\bsub.?centimet|tiny|punctate|subtle|small|minimal|trace|mild|faint|focal tiny/i;
const LARGE = /\blarge|extensive|massive|gross|marked|widespread|diffuse|multifocal|confluent|lobar/i;

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

function bandFor(confidence: number): AIConfidenceBand {
  if (confidence >= 88) return "high";
  if (confidence >= 70) return "moderate";
  return "low";
}

function firstMatch<T extends { re: RegExp }>(table: T[], text: string): T | undefined {
  for (const entry of table) if (entry.re.test(text)) return entry;
  return undefined;
}

export interface SimulatedFindingsInput {
  /** Stable study id — the seed. */
  studyId: string;
  modality: Modality;
  series: SeriesInfo[];
  /** The study's real report. Findings section first, impression as backup. */
  reportFindings?: string;
  reportImpression?: string;
  /** Hard cap on how many boxes to place. */
  max?: number;
}

/**
 * The series the boxes are placed on: the first axial series with slices, since
 * that is what the report's laterality and zone language describes. Falls back
 * to the first series that has any slices at all.
 */
function referenceSeries(series: SeriesInfo[]): SeriesInfo | undefined {
  const withSlices = series.filter((s) => s.sliceCount > 0);
  if (withSlices.length === 0) return undefined;
  return withSlices.find((s) => s.orientation === "Axial") ?? withSlices.find((s) => s.orientation === "PA" || s.orientation === "AP") ?? withSlices[0];
}

/**
 * Turns a study's own report into localised findings.
 *
 * Every returned finding's `label` and `description` come from that report;
 * `region`, `confidence` and `sliceIndex` are simulated. Returns `[]` when the
 * report is missing, or when nothing in it describes an abnormality.
 *
 * All findings share one reference slice. `AnalysisTab.visibleFindings` filters
 * to `sliceIndex === currentSlice`, so spreading them across a 1,140-slice PET
 * stack would mean the annotated view showed at most one box and usually none.
 * One slice with every box on it is what lets a reader match written finding to
 * location, which is the point of the view.
 */
export function simulateFindings(input: SimulatedFindingsInput): Finding[] {
  const series = referenceSeries(input.series);
  if (!series) return [];

  const text = [input.reportFindings, input.reportImpression].filter((t) => t && t.trim()).join(" ");
  if (!text.trim()) return [];

  const r = streamFor(input.studyId, "findings");
  const max = input.max ?? 3;

  // One slice for the whole study, in the middle third: the first slices of a
  // volumetric acquisition are usually air, and the last are usually table.
  const n = series.sliceCount;
  const lo = Math.floor(n / 3);
  const hi = Math.max(lo, Math.floor((2 * n) / 3) - 1);
  const sliceIndex = n <= 1 ? 0 : r.int(lo, hi);

  const findings: Finding[] = [];
  const usedLabels = new Set<string>();

  for (const sentence of splitSentences(text)) {
    if (findings.length >= max) break;
    if (sentence.length < 20) continue;

    const cue = CUES.find((c) => {
      const m = c.re.exec(sentence);
      return m !== null && !isNegatedAt(sentence, m.index);
    });
    if (!cue || usedLabels.has(cue.label)) continue;
    usedLabels.add(cue.label);

    findings.push(placeFinding(input, sentence, cue.label, series, sliceIndex, findings.length, r));
  }

  return findings;
}

function placeFinding(
  input: SimulatedFindingsInput,
  sentence: string,
  label: string,
  series: SeriesInfo,
  sliceIndex: number,
  ordinal: number,
  r: ReturnType<typeof streamFor>,
): Finding {
  const side = firstMatch(LATERALITY, sentence);
  const zone = firstMatch(ZONES, sentence);

  const sizeScale = LARGE.test(sentence) ? 1.55 : SMALL.test(sentence) ? 0.62 : 1;
  const baseW = 0.17 * sizeScale * (side?.widen ? 1.7 : 1);
  const baseH = 0.15 * sizeScale;

  const w = clamp(baseW + r.range(-0.02, 0.03), 0.05, 0.7);
  const h = clamp(baseH + r.range(-0.02, 0.03), 0.05, 0.6);

  // Jitter is small on purpose: enough that two findings in the same zone do not
  // sit exactly on top of each other, not enough to move a box out of the zone
  // the report named.
  const cx = clamp((side?.cx ?? 0.5) + r.range(-0.05, 0.05), w / 2 + 0.02, 1 - w / 2 - 0.02);
  const cy = clamp((zone?.cy ?? 0.45) + r.range(-0.05, 0.05), h / 2 + 0.02, 1 - h / 2 - 0.02);

  // Deliberately not high: a box inferred from a sentence has not been measured
  // against the pixels, and a 97% badge would imply it had been.
  const confidence = r.int(58, 84);

  return {
    id: `${input.studyId}-sim-${ordinal}`,
    label,
    description: sentence,
    confidence,
    band: bandFor(confidence),
    region: { x: round4(cx - w / 2), y: round4(cy - h / 2), w: round4(w), h: round4(h) },
    sliceIndex,
    seriesId: series.id,
    status: "pending",
  };
}

/**
 * Four decimals. Full doubles would put 17-digit values into every mirrored
 * JSON body for sub-pixel precision no viewer can use.
 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
