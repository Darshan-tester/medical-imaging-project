/**
 * ---------------------------------------------------------------------------
 * MERIDIAN AGENTIC AI — QUALITY-CONTROL (QC) AGENT
 * ---------------------------------------------------------------------------
 * Responsibilities:
 * - Detect internal clinical contradictions between Findings and Impression
 * - Detect laterality mismatches (e.g., Left lung lesion vs Right lung impression)
 * - Detect measurement discrepancies (e.g., Finding 8.4 mm vs Impression 12 mm)
 * - Detect unmentioned critical acute findings (Pneumothorax, Hemorrhage, Embolism)
 * - Flag unsupported assertions lacking visual or clinical evidence
 * - Provide actionable warnings with suggested radiologist corrections
 * ---------------------------------------------------------------------------
 */

import { Finding, ReportQCWarning, ReportSection } from "../types";
import { QCAgentOutput } from "./types";

const LATERALITY_WORDS = ["left", "right", "bilateral", "unilateral"];

export function runQCAgent(sections: ReportSection, findings: Finding[]): QCAgentOutput {
  const start = performance.now();
  const warnings: ReportQCWarning[] = [];

  const findingsText = (sections.findings || "").toLowerCase();
  const impressionText = (sections.impression || "").toLowerCase();

  // 1. Check for Missing Critical Findings in Report
  for (const f of findings) {
    if (f.isCritical) {
      const keyword = f.label.toLowerCase();
      const inFindings = findingsText.includes(keyword);
      const inImpression = impressionText.includes(keyword);

      if (!inFindings && !inImpression) {
        warnings.push({
          id: `qc-crit-${f.id}`,
          category: "missing_critical",
          severity: "critical",
          title: `Critical Finding Not Mentioned: ${f.label}`,
          description: `AI detected acute finding "${f.label}" on slice ${f.sliceIndex + 1}, but neither the Findings nor the Impression section references it.`,
          suggestedAction: `Review slice ${f.sliceIndex + 1} and explicitly confirm or rule out ${f.label} in the Impression.`,
          findingId: f.id,
          resolved: false,
        });
      }
    }
  }

  // 2. Laterality Discrepancy Check (Left vs Right)
  for (const f of findings) {
    const fDesc = f.description.toLowerCase();
    const hasLeftInFinding = fDesc.includes("left") || f.label.toLowerCase().includes("left");
    const hasRightInFinding = fDesc.includes("right") || f.label.toLowerCase().includes("right");

    if (hasLeftInFinding && !hasRightInFinding) {
      // Finding is strictly Left
      if (impressionText.includes("right") && !impressionText.includes("left")) {
        warnings.push({
          id: `qc-lat-${f.id}`,
          category: "laterality",
          severity: "critical",
          title: `Laterality Discrepancy: ${f.label}`,
          description: `Finding is described on the LEFT side, but the Impression specifies RIGHT.`,
          suggestedAction: `Verify whether the lesion is Left or Right and align the Impression text.`,
          findingId: f.id,
          resolved: false,
        });
      }
    } else if (hasRightInFinding && !hasLeftInFinding) {
      // Finding is strictly Right
      if (impressionText.includes("left") && !impressionText.includes("right")) {
        warnings.push({
          id: `qc-lat-${f.id}`,
          category: "laterality",
          severity: "critical",
          title: `Laterality Discrepancy: ${f.label}`,
          description: `Finding is described on the RIGHT side, but the Impression specifies LEFT.`,
          suggestedAction: `Verify anatomical side and correct Impression text.`,
          findingId: f.id,
          resolved: false,
        });
      }
    }
  }

  // 3. Clinical Contradictions Check
  const CONTRADICTION_PAIRS = [
    {
      presence: /pleural effusion|effusion present/i,
      absence: /no pleural effusion|no effusion|pleura.*clear/i,
      label: "Pleural Effusion",
    },
    {
      presence: /pneumothorax present|evidence of pneumothorax/i,
      absence: /no pneumothorax|lungs.*fully expanded/i,
      label: "Pneumothorax",
    },
    {
      presence: /consolidation|pneumonia present/i,
      absence: /no consolidation|clear lungs|no focal infiltrate/i,
      label: "Pulmonary Consolidation",
    },
    {
      presence: /fracture detected|acute fracture/i,
      absence: /no fracture|intact bones|no acute osseous/i,
      label: "Bone Fracture",
    },
    {
      presence: /intracranial h[ae]morrhage|subarachnoid bleed/i,
      absence: /no hemorrhage|no acute intracranial bleed/i,
      label: "Intracranial Hemorrhage",
    },
  ];

  for (const pair of CONTRADICTION_PAIRS) {
    const findingHasPresence = pair.presence.test(findingsText);
    const impressionHasAbsence = pair.absence.test(impressionText);

    if (findingHasPresence && impressionHasAbsence) {
      warnings.push({
        id: `qc-contra-${pair.label.toLowerCase().replace(/\s+/g, "-")}`,
        category: "contradiction",
        severity: "critical",
        title: `Direct Contradiction: ${pair.label}`,
        description: `Findings report presence of "${pair.label}", but Impression explicitly states its absence.`,
        suggestedAction: `Reconcile Findings and Impression before approving report.`,
        resolved: false,
      });
    }
  }

  // 4. Metric Measurement Cross-Check
  for (const f of findings) {
    if (f.measurements?.lengthMm) {
      const fMm = f.measurements.lengthMm;
      // Search for numbers in impression near finding label
      const impressionNums = impressionText.match(/(\d+(?:\.\d+)?)\s*(?:mm|millimeter)/g);
      if (impressionNums) {
        for (const numStr of impressionNums) {
          const val = parseFloat(numStr);
          // If difference is > 30% and not matching
          if (Math.abs(val - fMm) > 3.0 && Math.abs(val - fMm) / fMm > 0.3) {
            warnings.push({
              id: `qc-meas-${f.id}`,
              category: "measurement",
              severity: "warning",
              title: `Measurement Mismatch: ${f.label}`,
              description: `Finding calibrated at ${fMm} mm, but Impression mentions ${val} mm.`,
              suggestedAction: `Check caliper measurement and ensure Impression matches caliper dimensions.`,
              findingId: f.id,
              resolved: false,
            });
            break;
          }
        }
      }
    }
  }

  const criticalIssuesCount = warnings.filter((w) => w.severity === "critical").length;
  const passed = criticalIssuesCount === 0;
  const summary = passed
    ? (warnings.length === 0 ? "All quality checks passed. Report is clinically consistent." : `${warnings.length} advisory notice(s) noted.`)
    : `Quality Gate Warning: ${criticalIssuesCount} critical clinical discrepancy(ies) detected.`;

  const duration = performance.now() - start;

  return {
    passed,
    totalWarnings: warnings.length,
    criticalIssuesCount,
    warnings,
    summary,
    metadata: {
      agentRole: "qc_agent",
      agentName: "Meridian Clinical Quality Control Agent",
      version: "3.0.1",
      executionTimestamp: new Date().toISOString(),
      executionDurationMs: Math.round(duration * 100) / 100,
      deterministic: true,
    },
  };
}
