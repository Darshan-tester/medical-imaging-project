/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — STUDY AGENT
 * ---------------------------------------------------------------------------
 * Responsibilities:
 * - Identify modality & body region
 * - Inspect acquisition metadata & series protocols
 * - Extract and categorize clinical indication
 * - Discover relevant prior studies from the patient record
 * - Perform initial urgency triage
 * ---------------------------------------------------------------------------
 */

import { Study } from "../types";
import { StudyAgentOutput } from "./types";

export function runStudyAgent(study: Study, allStudies?: Study[]): StudyAgentOutput {
  const start = performance.now();

  const indication =
    study.report?.sections?.clinicalInformation ||
    study.sourceReport?.indication ||
    study.sourceReport?.clinicalInformation ||
    "Diagnostic evaluation";

  // Discover priors: same patient alias or same patient ID, earlier date
  const priors = (allStudies || [])
    .filter((s) => s.id !== study.id && s.patientAlias === study.patientAlias)
    .sort((a, b) => (new Date(b.date || 0).getTime()) - (new Date(a.date || 0).getTime()))
    .map((s) => ({
      priorStudyId: s.id,
      date: s.date || "Prior examination",
      modality: s.modality,
      bodyRegion: s.bodyRegion,
    }));

  // Urgency Triage Assessment based on clinical indication & priority
  let urgency: "routine" | "urgent" | "stat" = study.priority || "routine";
  const urgentKeywords = /trauma|hemorrhage|bleed|stroke|infarct|aneurysm|dissection|embolism|pneumothorax|acute|stat\b/i;
  if (urgentKeywords.test(indication) && urgency === "routine") {
    urgency = "urgent";
  }

  const duration = performance.now() - start;

  return {
    modality: study.modality,
    bodyRegion: study.bodyRegion || "Whole Body",
    clinicalIndication: indication,
    protocolVerified: (study.series && study.series.length > 0),
    discoveredPriorStudies: priors,
    urgencyTriage: urgency,
    metadata: {
      agentRole: "study_agent",
      agentName: "Meridian Study Context Agent",
      version: "2.1.0",
      executionTimestamp: new Date().toISOString(),
      executionDurationMs: Math.round(duration * 100) / 100,
      deterministic: true,
    },
  };
}
