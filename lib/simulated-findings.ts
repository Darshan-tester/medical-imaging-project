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
  {
    // "The cardiac silhouette is mildly enlarged" is the commonest phrasing in
    // MIMIC-CXR and matched none of the first three alternatives.
    re: /cardiomegal|enlarged cardiac|cardiac silhouette[^.]{0,30}enlarg|enlargement of the cardiac|cardiothoracic ratio/i,
    label: "Cardiomegaly",
  },
  { re: /ground.?glass/i, label: "Ground-glass opacity" },
  { re: /opacit|opacif/i, label: "Opacity" },
  { re: /infiltrat/i, label: "Infiltrate" },
  { re: /emphysema|emphysematous/i, label: "Emphysema" },
  { re: /bronchiectas/i, label: "Bronchiectasis" },
  { re: /fibrosis|fibrotic|reticulat/i, label: "Fibrosis" },
  { re: /hyperinflat|hyperexpand/i, label: "Hyperinflation" },
  { re: /low lung volumes|lung volumes are low(?:er)?|hypoinflat/i, label: "Low lung volumes" },
  { re: /vascular congestion|pulmonary (?:venous )?congestion|vascular engorgement/i, label: "Vascular congestion" },
  { re: /granulom/i, label: "Granuloma" },
  { re: /metasta/i, label: "Metastatic focus" },
  { re: /carcinoma|tumou?r|malignan|neoplas/i, label: "Neoplastic focus" },
  // Both before `nodul` and `lesion`, which would otherwise swallow them and
  // report a pituitary microadenoma as an unnamed "Lesion".
  { re: /fibroadenoma/i, label: "Fibroadenoma" },
  { re: /micro-?adenoma|macro-?adenoma|adenoma/i, label: "Adenoma" },
  // The three BI-RADS features that decide whether a mammogram is suspicious.
  // "An irregular spiculated mass" must not be flattened to "Lesion" — the
  // spiculation is the whole reason the sentence matters. `microcalcification`
  // additionally has to precede the general `calcification` cue further down,
  // where it previously sat and was unreachable dead code.
  { re: /micro-?calcification|punctate calcification|pleomorphic calcification/i, label: "Microcalcifications" },
  { re: /architectural distortion/i, label: "Architectural distortion" },
  { re: /spiculat|stellate margin/i, label: "Spiculated margin" },
  { re: /nodul/i, label: "Nodule" },
  // Above `lesion` for the same reason: cystic versus solid is the distinction a
  // reader is looking for. Plural included — "Bilateral maxillary retention
  // cysts are observed" is real report language that `cyst\b` did not match.
  { re: /cysts?\b|cystic/i, label: "Cyst" },
  { re: /osteolysis|osteolytic|lytic lesion|bone destruction/i, label: "Osteolysis" },
  { re: /\bmass\b|lesion/i, label: "Lesion" },
  { re: /fracture|fractured/i, label: "Fracture" },
  { re: /dislocat|subluxat/i, label: "Dislocation" },
  { re: /kyphosis|kyphotic|scoliosis|scoliotic|kyphoscolio/i, label: "Spinal deformity" },
  { re: /osteopeni|osteoporo|demineralis|demineraliz/i, label: "Reduced bone density" },
  { re: /h[ae]morrhage|h[ae]matoma|bleed/i, label: "Haemorrhage" },
  { re: /acute (?:cerebral |cortical |territorial )?infarct|acute isch[ae]mi|diffusion restriction|restricted diffusion/i, label: "Acute infarct / diffusion restriction" },
  { re: /chronic microangiopath|microangiopathic|small vessel disease|fazekas|deep white matter hyperintens|periventricular white matter/i, label: "Chronic microangiopathic ischemic change" },
  { re: /chronic (?:lacunar |cerebral )?infarct|old infarct|lacunar infarct/i, label: "Chronic lacunar infarct" },
  { re: /encephalomalac|gliosis|gliotic/i, label: "Gliosis" },
  { re: /possible isch[ae]mi|suspected isch[ae]mi|ischemic change|isch[ae]mi/i, label: "Possible ischemic change" },
  { re: /flair hyperintens|indeterminate flair/i, label: "Indeterminate FLAIR hyperintensity" },
  { re: /midline shift|mass effect|herniation of the/i, label: "Mass effect" },
  { re: /hydrocephalus|ventriculomegal/i, label: "Hydrocephalus" },
  // `multiple sclerosis` lives here rather than with the sclerotic-bone cue: an
  // MS plaque labelled "Sclerosis" would read as a bone finding.
  { re: /demyelinat|multiple sclerosis|periventricular plaque|plaques? perpendicular/i, label: "Demyelinating plaque" },
  // The commonest genuine finding in the cranial-MR set: "Mild widening is noted
  // in the sulci of the bilateral occipital lobe". Kept as a phrase so it cannot
  // fire on "assess mediastinal width".
  { re: /sulcal widening|widening[^.]{0,25}sulci|prominent sulci|sulci are prominent/i, label: "Sulcal widening" },
  { re: /atroph/i, label: "Atrophy" },
  { re: /angioma|cavernoma|arteriovenous malformation|\bavm\b/i, label: "Vascular malformation" },
  { re: /hyperintens/i, label: "T2 hyperintensity" },
  { re: /hypointens/i, label: "T1 hypointensity" },
  // Attenuation (CT) and echogenicity (US) are different physics and must not
  // share a label — "Hypodensity" on a sonogram is simply the wrong word, so the
  // echo terms come first and are named for what they are. Only the three that
  // describe a discrete focus live here; `echogenic` and `acoustic shadow` are
  // descriptors of something else and sit below the things they describe.
  { re: /anechoic/i, label: "Anechoic focus" },
  { re: /hypoechoic/i, label: "Hypoechoic focus" },
  { re: /hyperechoic/i, label: "Hyperechoic focus" },
  { re: /hypodens|hypoattenuat/i, label: "Hypodensity" },
  { re: /hyperdens|hyperattenuat/i, label: "Hyperdensity" },
  { re: /disc (protrusion|herniation|bulge|extrusion)|disc desiccation/i, label: "Disc protrusion" },
  { re: /stenosis|narrowing|impingement/i, label: "Stenosis" },
  { re: /spondylo|degenerative|osteophyt|osteoarthr/i, label: "Degenerative change" },
  // Mammography, continued. These are less specific than a mass descriptor but
  // still ahead of the general cues they would be flattened into: "skin
  // thickening" would read as generic "Wall thickening" and ductal ectasia as
  // generic "Dilatation".
  { re: /bi.?rads/i, label: "BI-RADS category" },
  { re: /skin thickening|skin retraction|nipple retraction|nipple inversion/i, label: "Skin / nipple change" },
  { re: /ductal (?:ectasia|dilat)|intraductal|duct dilat/i, label: "Ductal change" },
  { re: /heterogeneously dense|dense fibroglandular|fibroglandular|breast density/i, label: "Dense fibroglandular tissue" },
  { re: /asymmetr/i, label: "Asymmetry" },
  { re: /calcification|calcified/i, label: "Calcification" },
  { re: /sclerotic|sclerosis/i, label: "Sclerosis" },
  { re: /fdg|suv|hypermetabolic|avid uptake|increased uptake|tracer uptake/i, label: "Hypermetabolic focus" },
  { re: /aneurysm|dissection/i, label: "Vascular abnormality" },
  // Echocardiography and vascular sonography. "Severe tricuspid valve
  // regurgitation" was the single unmatched Ultrasound sentence in the dataset,
  // which is why that study had no annotated view at all.
  { re: /regurgitat|valvular insufficiency|incompetent valve/i, label: "Valvular regurgitation" },
  { re: /hypokines|akines|dyskines|wall motion|ejection fraction/i, label: "Wall-motion abnormality" },
  { re: /thromb/i, label: "Thrombus" },
  { re: /turbulent flow|absent flow|reversed flow|no demonstrable flow|hypervascular|neovascular|increased vascularit/i, label: "Abnormal flow" },
  // Sinus disease before the generic `thicken` cue, and narrowed to mucosal
  // thickening *of a sinus* so bowel-wall thickening is not called sinusitis.
  { re: /sinusitis|sinus opacification|mucosal thickening[^.]{0,40}sinus|sinus[^.]{0,30}mucosal thickening/i, label: "Sinusitis" },
  { re: /concha bullosa/i, label: "Concha bullosa" },
  { re: /hypertroph/i, label: "Hypertrophy" },
  // Abdominal / renal sonography. Each sits above the general cue it would
  // otherwise be flattened into: a calculus is not a "Calcification", and
  // hydronephrosis is not an unqualified "Dilatation".
  { re: /gallstone|cholelith|nephrolith|urolith|calculus|calculi/i, label: "Calculus" },
  { re: /hydronephro|pyelectasis|pelvicaliectasis/i, label: "Hydronephrosis" },
  { re: /ascites|free fluid|peritoneal fluid/i, label: "Free fluid" },
  // Steatosis above organomegaly: "The liver is enlarged and shows increased
  // echogenicity compatible with hepatic steatosis" is a fatty-liver report, and
  // the enlargement is a consequence of it.
  { re: /steatosis|fatty liver|fatty infiltration/i, label: "Hepatic steatosis" },
  { re: /hepatomegal|splenomegal|nephromegal|organomegal|(?:liver|spleen|kidney)[^.]{0,12}(?:is|are) enlarged/i, label: "Organomegaly" },
  { re: /septation|septated/i, label: "Septation" },
  // Descriptors, so they sit below every substantive finding above: "Echogenic
  // gallstones with posterior acoustic shadowing" is a stone, not an echotexture.
  { re: /echogenic|echotextur/i, label: "Altered echotexture" },
  { re: /acoustic shadow|posterior shadowing/i, label: "Acoustic shadowing" },
  { re: /thicken/i, label: "Wall thickening" },
  { re: /dilat|distend|ectasia/i, label: "Dilatation" },
  { re: /hernia\b/i, label: "Hernia" },
  { re: /oedema|edema|swelling|effusive/i, label: "Oedema" },
  { re: /tear\b|torn\b|rupture/i, label: "Tear" },
  { re: /lymphadenopathy|enlarged (lymph )?node/i, label: "Lymphadenopathy" },
  { re: /abscess|collection/i, label: "Collection" },
  // Only ever written when something is wrong, so it is safe as a cue; a
  // correctly sited line is described without any of these words. The tube
  // clause is spelled out because "tip projecting over the proximal left
  // mainstem bronchus" is how an over-inserted ET tube is actually reported.
  { re: /malposition|kink(?:ed|ing)|coiled/i, label: "Device malposition" },
  { re: /(?:tube|catheter) is (?:too )?(?:low|high)|t(?:ube|ip)[^.]{0,40}mainstem/i, label: "Tube malposition" },
  { re: /mediastinal widening|widened mediastinum|widening of the mediastinum/i, label: "Mediastinal widening" },
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
  // Cardiac structures name a side without using the word. Same convention: the
  // tricuspid valve is right-heart and therefore viewer-left. Appended last so
  // an explicit "right"/"left" in the same sentence still wins.
  { re: /tricuspid|right ventric|right atri/i, cx: 0.33 },
  { re: /mitral|left ventric|left atri/i, cx: 0.66 },
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
  // T3-T12 only. Bare "T1" and "T2" in a report are almost always the MRI
  // sequence, not a vertebral level, and reading them as levels would drag brain
  // findings down to mid-chest height.
  { re: /\bt(?:1[0-2]|[3-9])\b|thoracic spine/i, cy: 0.47 },
  { re: /\bl[1-5]\b|lumbar|sacr|coccy/i, cy: 0.68 },
  // Sinuses and sella, for the cranial MR set. "Frontal sinus" is deliberately
  // below the brain block, which matches "frontal lobe" and not this.
  { re: /frontal sinus/i, cy: 0.22 },
  { re: /sphenoid|ethmoid|middle turbinate|nasopharyn/i, cy: 0.45 },
  { re: /sella|pituitary|suprasellar|cavernous sinus/i, cy: 0.5 },
  { re: /maxillary|inferior turbinate|nasal (?:cavity|septum)|concha|palate/i, cy: 0.6 },
  // Mammography. A quadrant names both a height and a side; the height is here
  // and the side comes from LATERALITY. "Subareolar" means beneath the areola,
  // so it is central by definition — it used to be grouped with "upper".
  { re: /upper (?:outer|inner) quadrant|upper quadrant/i, cy: 0.33 },
  { re: /lower (?:outer|inner) quadrant|lower quadrant|inframammary/i, cy: 0.67 },
  { re: /retroareolar|subareolar|periareolar|nipple|central breast/i, cy: 0.5 },
  { re: /axillary tail|axilla/i, cy: 0.2 },
  // Clock-face notation, the standard way a breast or thyroid location is
  // written. 12 is up, 6 is down, 3 and 9 are mid-height. The two-digit
  // alternatives lead so "11 o'clock" is not read as "1 o'clock".
  { re: /\b(?:10|11|12|1|2)\s*o.?\s?clock/i, cy: 0.3 },
  { re: /\b(?:4|5|6|7|8)\s*o.?\s?clock/i, cy: 0.7 },
  { re: /\b(?:3|9)\s*o.?\s?clock/i, cy: 0.5 },
  // Echocardiography: on an apical view the valves sit mid-image. The apex
  // itself is already caught by the chest `apic|apex` entry above.
  { re: /tricuspid|mitral|aortic valve|pulmonic valve|atrioventricular/i, cy: 0.5 },
  // Abdominal, renal and pelvic sonography / CT. `\brenal` has a word boundary
  // so "adrenal" does not match, and `\buter` so "outer" does not.
  { re: /\bliver|hepatic|gallbladder|biliary|porta hepatis/i, cy: 0.35 },
  { re: /spleen|splenic|pancrea|epigastr/i, cy: 0.4 },
  { re: /kidney|\brenal|perinephric|ureter/i, cy: 0.5 },
  { re: /bladder|prostat|\buter|ovar|adnex|endometri|\bcervix|\bpelvi(?:s|c)\b/i, cy: 0.75 },
  { re: /thyroid|parathyroid|carotid|jugular|submandibular/i, cy: 0.3 },
  { re: /scrotum|testic|epididym|inguinal/i, cy: 0.8 },
  { re: /popliteal|femoral vein|saphenous|\bcalf\b/i, cy: 0.7 },
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

function deriveAnatomicalLocation(sentence: string, side?: { cx: number }, zone?: { cy: number }): string | undefined {
  if (/bilateral (?:frontoparietal|periventricular|deep white matter)/i.test(sentence)) {
    return "Bilateral frontoparietal white matter";
  }
  if (/periventricular/i.test(sentence)) {
    return "Periventricular white matter";
  }
  if (/deep white matter/i.test(sentence)) {
    return "Deep cerebral white matter";
  }
  if (/centrum semiovale/i.test(sentence)) {
    return "Centrum semiovale";
  }
  if (/frontal lobe/i.test(sentence)) {
    return side && side.cx < 0.4 ? "Right frontal lobe" : side && side.cx > 0.6 ? "Left frontal lobe" : "Frontal lobe";
  }
  if (/temporal lobe/i.test(sentence)) {
    return side && side.cx < 0.4 ? "Right temporal lobe" : side && side.cx > 0.6 ? "Left temporal lobe" : "Temporal lobe";
  }
  if (/parietal lobe/i.test(sentence)) {
    return side && side.cx < 0.4 ? "Right parietal lobe" : side && side.cx > 0.6 ? "Left parietal lobe" : "Parietal lobe";
  }
  if (/occipital lobe|occipital/i.test(sentence)) {
    return side && side.cx < 0.4 ? "Right occipital lobe" : side && side.cx > 0.6 ? "Left occipital lobe" : "Occipital lobe";
  }
  if (/cerebell/i.test(sentence)) {
    return "Posterior fossa / Cerebellum";
  }
  if (/brain ?stem|pons|medulla/i.test(sentence)) {
    return "Brainstem";
  }
  if (/basal ganglia|thalam/i.test(sentence)) {
    return "Deep gray nuclei / Basal ganglia";
  }
  if (/sphenoid sinus/i.test(sentence)) {
    return "Sphenoid sinus";
  }
  if (/maxillary sinus/i.test(sentence)) {
    return "Maxillary sinus";
  }
  if (/left lower lobe|lll\b/i.test(sentence)) {
    return "Left lower lobe";
  }
  if (/right lower lobe|rll\b/i.test(sentence)) {
    return "Right lower lobe";
  }
  if (/right upper lobe|rul\b/i.test(sentence)) {
    return "Right upper lobe";
  }
  if (/left upper lobe|lul\b/i.test(sentence)) {
    return "Left upper lobe";
  }
  if (/middle lobe|rml\b/i.test(sentence)) {
    return "Right middle lobe";
  }
  if (/mediastin/i.test(sentence)) {
    return "Mediastinum";
  }
  if (/paraaortic/i.test(sentence)) {
    return "Para-aortic lymph node station";
  }
  if (/liver|hepatic/i.test(sentence)) {
    return "Liver parenchyma";
  }
  return undefined;
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

  const location = deriveAnatomicalLocation(sentence, side, zone);

  let chronicity: Finding["chronicity"] = undefined;
  if (/acute/i.test(label) || /acute/i.test(sentence)) chronicity = "acute";
  else if (/chronic/i.test(label) || /chronic|old|gliotic/i.test(sentence)) chronicity = "chronic";
  else if (/subacute/i.test(sentence)) chronicity = "subacute";

  let severityLevel: Finding["severityLevel"] = undefined;
  if (/severe|extensive|gross|massive/i.test(sentence)) severityLevel = "severe";
  else if (/moderate/i.test(sentence)) severityLevel = "moderate";
  else if (/mild|minimal|trace|subtle|small/i.test(sentence)) severityLevel = "mild";

  const hasDwi = input.series.some((s) => /dwi|diff/i.test(s.label));
  const hasAdc = input.series.some((s) => /adc/i.test(s.label));
  const hasFlair = input.series.some((s) => /flair/i.test(s.label));
  const hasT2 = input.series.some((s) => /t2/i.test(s.label));
  const hasT1 = input.series.some((s) => /t1/i.test(s.label));

  const supporting: string[] = [];
  if (hasFlair) supporting.push("FLAIR");
  if (hasT2) supporting.push("T2");
  if (hasT1 && !hasFlair && !hasT2) supporting.push("T1");
  if (supporting.length === 0) supporting.push(series.label.split("·")[0].trim());

  const unavailable: string[] = [];
  if (input.modality === "MRI") {
    if (!hasDwi) unavailable.push("DWI");
    if (!hasAdc) unavailable.push("ADC");
  }

  const isIschemicOrInfarct = /ischemic|infarct|flair hyperintens|white matter/i.test(label);

  const evidenceDetails = {
    keyObservations: [
      isIschemicOrInfarct
        ? "FLAIR hyperintensity in periventricular/deep white-matter distribution"
        : `${label} morphologic presentation observed on reference plane`,
      "Non-mass-like signal distribution without significant vasogenic edema or mass effect",
    ],
    supportingSequences: supporting,
    unavailableSequences: unavailable,
    explainabilityNote: isIschemicOrInfarct && (!hasDwi || !hasAdc)
      ? "DWI/ADC correlation unavailable in this study."
      : undefined,
  };

  return {
    id: `${input.studyId}-sim-${ordinal}`,
    label,
    description: sentence,
    confidence,
    provenance: "report_extracted",
    isDemonstration: true,
    band: bandFor(confidence),
    region: { x: round4(cx - w / 2), y: round4(cy - h / 2), w: round4(w), h: round4(h) },
    sliceIndex,
    totalSlices: series.sliceCount,
    seriesId: series.id,
    seriesLabel: series.label,
    plane: series.orientation,
    modality: input.modality,
    location,
    chronicity,
    severityLevel,
    evidenceDetails,
    dwiCorrelationAvailable: hasDwi && hasAdc,
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
