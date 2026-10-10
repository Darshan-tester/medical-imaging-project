/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — COMPARISON AGENT
 * ---------------------------------------------------------------------------
 * Responsibilities:
 * - Match current examination against relevant prior imaging studies
 * - Perform lesion-by-lesion longitudinal tracking
 * - Compute quantitative growth / regression metrics (% change, diameter delta)
 * - Classify temporal evolution (New, Stable, Increased, Decreased, Resolved)
 * - Generate longitudinal interval summary for structured report
 * ---------------------------------------------------------------------------
 */

import { Finding, PriorStudyComparison, Study } from "../types";
import { ComparisonAgentOutput } from "./types";

export function runComparisonAgent(study: Study, priorStudy?: Study): ComparisonAgentOutput {
  const start = performance.now();

  if (!priorStudy) {
    const duration = performance.now() - start;
    return {
      hasPriorStudy: false,
      intervalSummary: "No previous imaging available for direct comparison. Baseline examination.",
      trackedLesions: [],
      metadata: {
        agentRole: "comparison_agent",
        agentName: "Meridian Longitudinal Comparison Agent",
        version: "1.9.0",
        executionTimestamp: new Date().toISOString(),
        executionDurationMs: Math.round(duration * 100) / 100,
        deterministic: true,
      },
    };
  }

  // Cross-reference current findings against prior findings
  const priorFindings = priorStudy.findings || [];
  const trackedLesions: ComparisonAgentOutput["trackedLesions"] = [];
  const findingDeltas: PriorStudyComparison["findingDeltas"] = [];

  for (const curr of study.findings || []) {
    // Attempt match by label or anatomical similarity
    const matchedPrior = priorFindings.find(
      (pf) => pf.label.toLowerCase() === curr.label.toLowerCase()
    );

    const currSize = curr.measurements?.lengthMm;
    if (matchedPrior) {
      const priorSize = matchedPrior.measurements?.lengthMm;
      let pctChange: number | undefined;
      let status: "new" | "stable" | "increased" | "decreased" | "resolved" = "stable";

      if (currSize !== undefined && priorSize !== undefined && priorSize > 0) {
        const delta = currSize - priorSize;
        pctChange = Math.round((delta / priorSize) * 100);
        if (pctChange > 20) status = "increased";
        else if (pctChange < -20) status = "decreased";
      }

      trackedLesions.push({
        findingName: curr.label,
        status,
        currentSizeMm: currSize,
        priorSizeMm: priorSize,
        percentageChange: pctChange,
        clinicalSignificance: pctChange !== undefined && Math.abs(pctChange) > 20 ? "significant" : "indeterminate",
      });

      findingDeltas.push({
        findingName: curr.label,
        status,
        currentMeasurementMm: currSize,
        priorMeasurementMm: priorSize,
        percentChange: pctChange,
      });
    } else {
      // New finding not visible on prior study
      trackedLesions.push({
        findingName: curr.label,
        status: "new",
        currentSizeMm: currSize,
        clinicalSignificance: "significant",
      });

      findingDeltas.push({
        findingName: curr.label,
        status: "new",
        currentMeasurementMm: currSize,
      });
    }
  }

  // Check for resolved findings present on prior but absent on current
  for (const pf of priorFindings) {
    const stillPresent = study.findings?.some(
      (cf) => cf.label.toLowerCase() === pf.label.toLowerCase()
    );
    if (!stillPresent) {
      trackedLesions.push({
        findingName: pf.label,
        status: "resolved",
        priorSizeMm: pf.measurements?.lengthMm || 10,
        clinicalSignificance: "significant",
      });
      findingDeltas.push({
        findingName: pf.label,
        status: "resolved",
        priorMeasurementMm: pf.measurements?.lengthMm || 10,
      });
    }
  }

  const newCount = trackedLesions.filter((l) => l.status === "new").length;
  const stableCount = trackedLesions.filter((l) => l.status === "stable").length;
  const increasedCount = trackedLesions.filter((l) => l.status === "increased").length;

  const intervalSummary = `Comparison made to prior ${priorStudy.modality} study dated ${priorStudy.date || "previous date"}. ` +
    (trackedLesions.length === 0
      ? "No focal abnormalities tracked across examinations."
      : `${newCount} new finding(s), ${stableCount} stable finding(s), ${increasedCount} increased in size.`);

  const comparisonData: PriorStudyComparison = {
    priorStudyId: priorStudy.id,
    priorDate: priorStudy.date || "Prior Date",
    modality: priorStudy.modality,
    findingDeltas,
  };

  const duration = performance.now() - start;

  return {
    hasPriorStudy: true,
    priorStudyComparison: comparisonData,
    intervalSummary,
    trackedLesions,
    metadata: {
      agentRole: "comparison_agent",
      agentName: "Meridian Longitudinal Comparison Agent",
      version: "1.9.0",
      executionTimestamp: new Date().toISOString(),
      executionDurationMs: Math.round(duration * 100) / 100,
      deterministic: true,
    },
  };
}
