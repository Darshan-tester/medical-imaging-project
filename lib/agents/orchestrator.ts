/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — MASTER ORCHESTRATOR
 * ---------------------------------------------------------------------------
 * Coordinates the autonomous execution and synchronization of:
 * 1. Study Agent
 * 2. Imaging Analysis Agent
 * 3. Comparison Agent
 * 4. Reporting Agent
 * 5. Quality-Control (QC) Agent
 * 6. Workflow Agent
 *
 * Provides a unified, verifiable diagnostic state with full provenance for each
 * agent's execution, timing, and reasoning.
 * ---------------------------------------------------------------------------
 */

import { Study } from "../types";
import { runStudyAgent } from "./study-agent";
import { runImagingAnalysisAgent } from "./imaging-analysis-agent";
import { runComparisonAgent } from "./comparison-agent";
import { runReportingAgent } from "./reporting-agent";
import { runQCAgent } from "./qc-agent";
import { runWorkflowAgent } from "./workflow-agent";
import { AgenticWorkstationState } from "./types";

export interface OrchestrationOptions {
  priorStudy?: Study;
  allStudies?: Study[];
  currentUser?: string;
}

export function orchestrateStudyAgents(
  study: Study,
  options: OrchestrationOptions = {}
): AgenticWorkstationState {
  // Step 1: Study Agent Context Analysis
  const studyAnalysis = runStudyAgent(study, options.allStudies);

  // Step 2: Imaging Analysis Agent — Detect, measure, localize evidence
  const imagingAnalysis = runImagingAnalysisAgent(study);

  // Step 3: Prior Comparison Agent — Longitudinal tracking
  const priorComparison = runComparisonAgent(study, options.priorStudy);

  // Step 4: Reporting Agent — Evidence-grounded report synthesis
  const reportDraft = runReportingAgent(
    study,
    imagingAnalysis.findings,
    priorComparison.hasPriorStudy ? priorComparison.intervalSummary : undefined
  );

  // Step 5: Quality-Control Agent — Consistency, laterality, contradictions, acute gaps
  const activeSections = study.report?.sections?.findings
    ? study.report.sections
    : reportDraft.draftSections;
  const qualityControl = runQCAgent(activeSections, imagingAnalysis.findings);

  // Step 6: Workflow & Audit Agent — Triage checklist, review status, audit trail
  const workflow = runWorkflowAgent(study, imagingAnalysis.findings, options.currentUser);

  return {
    studyId: study.id,
    studyAnalysis,
    imagingAnalysis,
    priorComparison,
    reportDraft,
    qualityControl,
    workflow,
    orchestratedAt: new Date().toISOString(),
  };
}
