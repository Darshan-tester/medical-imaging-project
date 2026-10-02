/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — REPORTING AGENT
 * ---------------------------------------------------------------------------
 * Responsibilities:
 * - Select appropriate modality / body-region structured template
 * - Synthesize findings, measurements, and comparison into draft sections
 * - Formulate structured radiological impression with evidence linkage
 * - Provide template customization and clinical macro expansions
 * ---------------------------------------------------------------------------
 */

import { Finding, Modality, ReportSection, Study } from "../types";
import { ReportingAgentOutput } from "./types";

export interface ReportTemplate {
  id: string;
  name: string;
  modality: Modality;
  bodyRegion: string;
  techniqueTemplate: string;
  findingsTemplate: string;
  impressionTemplate: string;
}

export const CLINICAL_TEMPLATES: Record<string, ReportTemplate> = {
  "ct-chest": {
    id: "ct-chest",
    name: "CT Chest Routine",
    modality: "CT",
    bodyRegion: "Chest",
    techniqueTemplate: "Volumetric high-resolution axial CT of the thorax performed from lung apices through adrenal glands. Multiplanar coronal and sagittal reconstructions generated.",
    findingsTemplate: "LUNGS: Normal lung expansion. No focal consolidation, pneumothorax, or suspicious pulmonary nodule.\n\nAIRWAYS: Trachea and central bronchi are patent without endobronchial lesion.\n\nPLEURA: No pleural effusion or thickening.\n\nMEDIASTINUM & HILA: Normal mediastinal and hilar contours. No pathologically enlarged lymph nodes (subcentimeter short-axis).\n\nHEART & VESSELS: Heart size within normal limits. Thoracic aorta caliber unremarkable. Pulmonary arterial trunk is non-dilated.\n\nCHEST WALL & BONES: Intact thoracic cage without acute fracture or aggressive osseous lesion.",
    impressionTemplate: "1. No acute cardiopulmonary abnormality.\n2. No evidence of pulmonary consolidation or focal suspicious nodule.",
  },
  "mri-brain": {
    id: "mri-brain",
    name: "MRI Brain Comprehensive",
    modality: "MRI",
    bodyRegion: "Head/Brain",
    techniqueTemplate: "Multiplanar multisequence MRI of the brain including Axial T1, T2, FLAIR, DWI/ADC, and Sagittal T1 without intravenous contrast administration.",
    findingsTemplate: "PARENCHYMA: Normal signal intensity throughout cerebral hemispheres, cerebellum, and brainstem. No acute diffusion restriction to suggest acute territorial infarction. No intracranial hemorrhage or significant mass effect.\n\nVENTRICLES & EXTRA-AXIAL SPACES: Ventricular size and sulcal patterns appropriate for age. Midline structures are centered without deviation.\n\nVASCULATURE: Major intracranial flow voids preserved at the skull base.\n\nBONES & SOFT TISSUES: Marrow signal intact. Paranasal sinuses and mastoid air cells are well-aerated.",
    impressionTemplate: "1. No evidence of acute intracranial infarction, intracranial hemorrhage, or pathological mass effect.\n2. Age-appropriate brain morphology.",
  },
  "mri-knee": {
    id: "mri-knee",
    name: "MRI Knee Diagnostic",
    modality: "MRI",
    bodyRegion: "Knee",
    techniqueTemplate: "Multiplanar MRI of the knee obtained using proton-density fat-suppressed, T1, and T2-weighted sequences in coronal, sagittal, and axial planes.",
    findingsTemplate: "MENISCI: Medial and lateral menisci demonstrate normal low signal intensity and morphology without surface-extending tear or degenerative maceration.\n\nCRUCIATE LIGAMENTS: Anterior and posterior cruciate ligaments are intact with normal continuous fibers.\n\nCOLLATERAL LIGAMENTS: Medial and lateral collateral ligament complexes are intact without sprain or disruption.\n\nCARTILAGE & BONE: Articular cartilage of patellofemoral and tibiofemoral compartments is preserved. No subchondral marrow edema or fracture.\n\nJOINT: No significant joint effusion or popliteal cyst.",
    impressionTemplate: "1. Intact menisci and cruciate ligaments without acute tear.\n2. No articular cartilage defect or joint effusion.",
  },
  "chest-xray": {
    id: "chest-xray",
    name: "Chest Radiograph PA & Lateral",
    modality: "X-Ray",
    bodyRegion: "Chest",
    techniqueTemplate: "Frontal and lateral projection radiographs of the chest.",
    findingsTemplate: "LUNGS: Lungs are clear without focal consolidation, pneumothorax, or interstitial edema.\n\nPLEURA: Costophrenic sulci are sharp and clear bilaterally without effusion.\n\nCARDIAC: Cardiothoracic ratio is normal (< 0.50). Mediastinal and hilar contours are within normal limits.\n\nOSSEOUS: Visualized ribs and clavicles are intact without acute fracture.",
    impressionTemplate: "1. No acute cardiopulmonary disease.",
  },
  "ct-abdomen": {
    id: "ct-abdomen",
    name: "CT Abdomen & Pelvis with Contrast",
    modality: "CT",
    bodyRegion: "Abdomen",
    techniqueTemplate: "Axial CT of abdomen and pelvis performed following administration of intravenous contrast during portal venous phase. Multiplanar reconstructions provided.",
    findingsTemplate: "LIVER & BILIARY: Normal hepatic attenuation and smooth surface contour. No focal hepatic lesion. Gallbladder and biliary tree are non-dilated.\n\nSPLEEN & PANCREAS: Spleen and pancreas are unremarkable in size and parenchymal enhancement.\n\nADRENALS & KIDNEYS: Adrenals are symmetric. Kidneys enhance symmetrically without hydronephrosis or perinephric fluid.\n\nGASTROINTESTINAL: Bowel loops demonstrate normal caliber and wall thickness without obstruction or inflammatory changes.\n\nPERITONEUM: No ascites or free peritoneal air.",
    impressionTemplate: "1. Normal contrast-enhanced examination of the abdomen and pelvis.\n2. No acute inflammatory or obstructive intra-abdominal process.",
  },
  "pet-ct": {
    id: "pet-ct",
    name: "PET/CT Whole Body Oncologic",
    modality: "PET",
    bodyRegion: "Whole Body",
    techniqueTemplate: "Whole-body PET/CT scan acquired from skull base to proximal thighs approximately 60 minutes following intravenous 18F-FDG administration. Low-dose CT performed for attenuation correction and anatomical localization.",
    findingsTemplate: "HEAD & NECK: Physiological distribution of FDG in brain and salivary glands. No pathological hypermetabolism in cervical lymph nodes.\n\nCHEST: Physiological cardiac uptake. Lungs demonstrate background-level activity without hypermetabolic pulmonary lesion or hypermetabolic mediastinal lymphadenopathy.\n\nABDOMEN & PELVIS: Physiological hepatic, splenic, and urinary tract excretion. No pathological FDG accumulation in visceral organs or retroperitoneal nodes.\n\nSKELETON: Background bone marrow distribution without hypermetabolic osseous metastasis.",
    impressionTemplate: "1. No evidence of pathological hypermetabolic malignancy or distant metastasis.\n2. Normal physiological FDG bio-distribution.",
  },
};

export function selectTemplate(modality: Modality, bodyRegion?: string): ReportTemplate {
  const normRegion = (bodyRegion || "").toLowerCase();
  if (modality === "CT") {
    if (normRegion.includes("abdomen") || normRegion.includes("pelvis")) return CLINICAL_TEMPLATES["ct-abdomen"];
    return CLINICAL_TEMPLATES["ct-chest"];
  }
  if (modality === "MRI") {
    if (normRegion.includes("knee") || normRegion.includes("joint") || normRegion.includes("leg")) return CLINICAL_TEMPLATES["mri-knee"];
    return CLINICAL_TEMPLATES["mri-brain"];
  }
  if (modality === "PET") return CLINICAL_TEMPLATES["pet-ct"];
  return CLINICAL_TEMPLATES["chest-xray"];
}

export function runReportingAgent(
  study: Study,
  findings: Finding[],
  comparisonSummary?: string
): ReportingAgentOutput {
  const start = performance.now();

  const template = selectTemplate(study.modality, study.bodyRegion);
  const evidenceCitations: ReportingAgentOutput["evidenceCitations"] = [];

  // Synthesize findings
  let findingsText = "";
  const positiveFindings = findings.filter((f) => !f.label.toLowerCase().startsWith("no "));

  if (positiveFindings.length > 0) {
    const findingSentences = positiveFindings.map((f, idx) => {
      const sizeStr = f.measurements?.lengthMm ? ` measuring ${f.measurements.lengthMm} mm` : "";
      const locStr = f.location ? ` within ${f.location}` : "";
      const sentence = `${f.label}${sizeStr}${locStr} (Slice ${f.sliceIndex + 1}). Description: ${f.description}`;
      evidenceCitations.push({
        sectionKey: "findings",
        sentence,
        referencedFindingId: f.id,
      });
      return `• ${sentence}`;
    });

    findingsText = `ABNORMAL FINDINGS:\n${findingSentences.join("\n")}\n\nBACKGROUND PARENCHYMA:\n${template.findingsTemplate}`;
  } else {
    findingsText = study.report?.sections?.findings?.trim() || template.findingsTemplate;
  }

  // Synthesize impression
  const impressionPoints: string[] = [];
  if (positiveFindings.length > 0) {
    positiveFindings.forEach((f, i) => {
      const sizeStr = f.measurements?.lengthMm ? ` measuring ${f.measurements.lengthMm} mm` : "";
      const point = `${i + 1}. ${f.label}${sizeStr}. ${f.isCritical ? "Requires urgent clinical correlation." : ""}`;
      impressionPoints.push(point);
      evidenceCitations.push({
        sectionKey: "impression",
        sentence: point,
        referencedFindingId: f.id,
      });
    });
  } else {
    impressionPoints.push(template.impressionTemplate);
  }

  const comparisonText = comparisonSummary || study.report?.sections?.comparison || "None available.";

  const draftSections: ReportSection = {
    clinicalInformation: study.report?.sections?.clinicalInformation || study.sourceReport?.clinicalInformation || "Diagnostic imaging evaluation.",
    technique: study.report?.sections?.technique || template.techniqueTemplate,
    comparison: comparisonText,
    findings: findingsText,
    impression: impressionPoints.join("\n"),
  };

  const duration = performance.now() - start;

  return {
    draftSections,
    usedTemplateId: template.id,
    evidenceCitations,
    suggestedImpressionPoints: impressionPoints,
    metadata: {
      agentRole: "reporting_agent",
      agentName: "Meridian Structured Reporting Agent",
      version: "2.3.0",
      executionTimestamp: new Date().toISOString(),
      executionDurationMs: Math.round(duration * 100) / 100,
      deterministic: true,
    },
  };
}
