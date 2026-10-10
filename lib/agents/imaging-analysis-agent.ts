/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — IMAGING ANALYSIS AGENT
 * ---------------------------------------------------------------------------
 * Responsibilities:
 * - Determine applicable modality-specific AI models
 * - Detect & localize imaging findings with coordinate provenance
 * - Calibrate measurements (metric millimeter calipers, volume, HU/SUV values)
 * - Flag critical life-threatening findings requiring immediate radiologist review
 * - Ensure bidirectional evidence linking between report and image coordinates
 * ---------------------------------------------------------------------------
 */

import { Finding, FindingEvidence, FindingMeasurement, Study } from "../types";
import { ImagingAnalysisAgentOutput } from "./types";

const CRITICAL_KEYWORDS = [
  /intracranial h[ae]morrhage|subarachnoid|subdural|epidural/i,
  /tension pneumothorax|pneumothorax/i,
  /pulmonary embolism|pe\b/i,
  /aortic dissection/i,
  /acute infarct|large vessel occlusion/i,
  /pneumoperitoneum|free air under diaphragm/i,
  /active extravasation|ruptur/i,
];

export function runImagingAnalysisAgent(study: Study): ImagingAnalysisAgentOutput {
  const start = performance.now();

  const applicableModels = [
    {
      modelId: `adapter-${study.modality.toLowerCase()}-text-heuristic`,
      name: `Report Text-Mining Heuristic Adapter (Vision Model Unconnected)`,
      version: "1.0.0-demo",
      targetAnatomy: study.bodyRegion || "Chest/Abdomen/Neuro",
    },
  ];

  const measurementsMap: Record<string, FindingMeasurement> = {};
  const evidenceMap: Record<string, FindingEvidence> = {};

  const enhancedFindings: Finding[] = (study.findings || []).map((f) => {
    // Check if finding is critical based on clinical terms
    const isCritical = CRITICAL_KEYWORDS.some((re) => re.test(f.label) || re.test(f.description));

    // Extract metric measurement ONLY if explicitly reported in text (e.g. "8.4 mm", "1.2 cm")
    const mmMatch = f.description.match(/(\d+(?:\.\d+)?)\s*(?:mm|millimeter)/i);
    const cmMatch = f.description.match(/(\d+(?:\.\d+)?)\s*(?:cm|centimeter)/i);
    let lengthMm: number | undefined;
    if (mmMatch) {
      lengthMm = parseFloat(mmMatch[1]);
    } else if (cmMatch) {
      lengthMm = parseFloat(cmMatch[1]) * 10;
    }

    // Never fabricate 2D caliper width/area or HU/SUV without actual calibrated DICOM pixels
    const measurement: FindingMeasurement = {
      lengthMm,
      widthMm: undefined,
      areaMm2: undefined,
      meanHu: undefined, // Verified CT pixel probe required
      maxSuv: undefined, // Calibrated PET decay & dose calculation required
    };
    if (lengthMm !== undefined) {
      measurementsMap[f.id] = measurement;
    }

    const evidence: FindingEvidence = {
      seriesId: f.seriesId || study.series[0]?.id || "",
      sliceIndex: f.sliceIndex ?? 0,
      region: f.region,
      centerCoords: {
        x: Math.round((f.region.x + f.region.w / 2) * 1000) / 1000,
        y: Math.round((f.region.y + f.region.h / 2) * 1000) / 1000,
      },
      keyObservation: f.description,
    };
    evidenceMap[f.id] = evidence;

    return {
      ...f,
      status: f.status || "pending",
      isCritical,
      provenance: f.provenance || "report_extracted",
      isDemonstration: f.isDemonstration ?? true,
      modelName: f.provenance === "model_inference" ? f.modelName : "Report Text Heuristic (Demo Only)",
      modelVersion: f.provenance === "model_inference" ? f.modelVersion : undefined,
      measurements: lengthMm !== undefined ? measurement : undefined,
      evidence,
    };
  });

  const criticalCount = enhancedFindings.filter((f) => f.isCritical).length;
  const duration = performance.now() - start;

  return {
    findings: enhancedFindings,
    criticalFindingsCount: criticalCount,
    calibratedMeasurements: measurementsMap,
    visualEvidenceMap: evidenceMap,
    applicableModels,
    metadata: {
      agentRole: "imaging_analysis_agent",
      agentName: "Meridian Imaging Analysis Agent",
      version: "2.4.1",
      executionTimestamp: new Date().toISOString(),
      executionDurationMs: Math.round(duration * 100) / 100,
      deterministic: true,
    },
  };
}
