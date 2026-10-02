/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI SUBSYSTEM — ARCHITECTURAL TYPES
 * ---------------------------------------------------------------------------
 * Defines the contract, payloads, and provenance for each modular clinical agent:
 * - Study Agent
 * - Imaging Analysis Agent
 * - Comparison Agent
 * - Reporting Agent
 * - Quality-Control (QC) Agent
 * - Workflow Agent
 * ---------------------------------------------------------------------------
 */

import {
  Finding,
  FindingMeasurement,
  FindingEvidence,
  Modality,
  PriorStudyComparison,
  ReportQCWarning,
  ReportSection,
  Study,
} from "../types";

export type AgentRole =
  | "study_agent"
  | "imaging_analysis_agent"
  | "comparison_agent"
  | "reporting_agent"
  | "qc_agent"
  | "workflow_agent";

export interface AgentExecutionMetadata {
  agentRole: AgentRole;
  agentName: string;
  version: string;
  executionTimestamp: string;
  executionDurationMs: number;
  deterministic: boolean;
}

/**
 * 1. Study Agent Output
 */
export interface StudyAgentOutput {
  modality: Modality;
  bodyRegion: string;
  clinicalIndication: string;
  protocolVerified: boolean;
  discoveredPriorStudies: {
    priorStudyId: string;
    date: string;
    modality: Modality;
    bodyRegion?: string;
  }[];
  urgencyTriage: "routine" | "urgent" | "stat";
  metadata: AgentExecutionMetadata;
}

/**
 * 2. Imaging Analysis Agent Output
 */
export interface ImagingAnalysisAgentOutput {
  findings: Finding[];
  criticalFindingsCount: number;
  calibratedMeasurements: Record<string, FindingMeasurement>;
  visualEvidenceMap: Record<string, FindingEvidence>;
  applicableModels: {
    modelId: string;
    name: string;
    version: string;
    targetAnatomy: string;
  }[];
  metadata: AgentExecutionMetadata;
}

/**
 * 3. Comparison Agent Output
 */
export interface ComparisonAgentOutput {
  hasPriorStudy: boolean;
  priorStudyComparison?: PriorStudyComparison;
  intervalSummary: string;
  trackedLesions: {
    findingName: string;
    status: "new" | "stable" | "increased" | "decreased" | "resolved";
    currentSizeMm?: number;
    priorSizeMm?: number;
    percentageChange?: number;
    clinicalSignificance: "significant" | "indeterminate" | "expected";
  }[];
  metadata: AgentExecutionMetadata;
}

/**
 * 4. Reporting Agent Output
 */
export interface ReportingAgentOutput {
  draftSections: ReportSection;
  usedTemplateId: string;
  evidenceCitations: {
    sectionKey: keyof ReportSection;
    sentence: string;
    referencedFindingId?: string;
  }[];
  suggestedImpressionPoints: string[];
  metadata: AgentExecutionMetadata;
}

/**
 * 5. Quality-Control (QC) Agent Output
 */
export interface QCAgentOutput {
  passed: boolean;
  totalWarnings: number;
  criticalIssuesCount: number;
  warnings: ReportQCWarning[];
  summary: string;
  metadata: AgentExecutionMetadata;
}

/**
 * 6. Workflow Agent Output
 */
export interface WorkflowAgentOutput {
  caseStatus: "ready_for_review" | "needs_prior_retrieval" | "critical_unreviewed" | "review_in_progress" | "approved";
  pendingReviewItems: string[];
  radiologistChecklist: {
    id: string;
    label: string;
    completed: boolean;
    required: boolean;
  }[];
  auditEntryId?: string;
  metadata: AgentExecutionMetadata;
}

/**
 * Unified Agentic Workstation Case Context
 */
export interface AgenticWorkstationState {
  studyId: string;
  studyAnalysis: StudyAgentOutput;
  imagingAnalysis: ImagingAnalysisAgentOutput;
  priorComparison: ComparisonAgentOutput;
  reportDraft: ReportingAgentOutput;
  qualityControl: QCAgentOutput;
  workflow: WorkflowAgentOutput;
  orchestratedAt: string;
}
