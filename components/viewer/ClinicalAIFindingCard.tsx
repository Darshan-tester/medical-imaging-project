"use client";

import { useState } from "react";
import {
  Crosshair,
  GitCompare,
  Plus,
  Check,
  Edit3,
  X,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Finding, Study, SeriesInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const REJECTION_REASONS = [
  "False positive",
  "Wrong location",
  "Wrong finding",
  "Normal variant",
  "Already accounted for",
  "Insufficient evidence",
  "Other",
] as const;

const CHRONICITY_OPTIONS = [
  { value: "acute", label: "Acute" },
  { value: "subacute", label: "Subacute" },
  { value: "chronic", label: "Chronic" },
  { value: "indeterminate", label: "Indeterminate" },
] as const;

const SEVERITY_OPTIONS = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

export interface ClinicalAIFindingCardProps {
  finding: Finding;
  study: Study;
  isActive: boolean;
  onSelectFinding: (id: string) => void;
  onShowOnScan?: (finding: Finding) => void;
  onComparePrior?: (finding: Finding) => void;
  onAddToReport?: (finding: Finding) => void;
  onUpdateFinding: (id: string, patch: Partial<Finding>) => void;
  onSelectSeries?: (seriesId: string) => void;
  onJumpToSlice?: (sliceIndex: number) => void;
  compact?: boolean;
}

export function ClinicalAIFindingCard({
  finding,
  study,
  isActive,
  onSelectFinding,
  onShowOnScan,
  onComparePrior,
  onAddToReport,
  onUpdateFinding,
  onSelectSeries,
  onJumpToSlice,
  compact = false,
}: ClinicalAIFindingCardProps) {
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  const [showRejectMenu, setShowRejectMenu] = useState(false);
  const [showWhyEvidence, setShowWhyEvidence] = useState(false);
  const [showTechnicalScore, setShowTechnicalScore] = useState(false);

  // Editable modification state
  const [modLabel, setModLabel] = useState(finding.label);
  const [modLocation, setModLocation] = useState(finding.anatomicalLocation || finding.location || "");
  const [modChronicity, setModChronicity] = useState<string>(finding.chronicity || "chronic");
  const [modSeverity, setModSeverity] = useState<string>(finding.severityLevel || "mild");
  const [modComment, setModComment] = useState(finding.radiologistNote || "");

  // Match series metadata if available
  const matchedSeries = study.series.find(
    (s) => s.id === finding.seriesId || s.label.toLowerCase() === (finding.seriesLabel || "").toLowerCase()
  );
  const seriesName = finding.seriesLabel || matchedSeries?.label || "Reference Series";
  const plane = finding.plane || matchedSeries?.orientation || "Axial";
  const sliceNum = finding.sliceIndex !== undefined ? finding.sliceIndex + 1 : undefined;
  const totalSlices = finding.totalSlices || matchedSeries?.sliceCount;

  // DWI / ADC availability in study
  const dwiSeries = study.series.find((s) => /dwi|diff/i.test(s.label));
  const adcSeries = study.series.find((s) => /adc/i.test(s.label));
  const isBrainMri = (study.modality === "MRI" && (study.bodyRegion || "").toUpperCase().includes("BRAIN")) ||
    study.series.some((s) => /flair|t1|t2/i.test(s.label));
  const isIschemicFinding = /isch[ae]m|infarct|lacun|glios/i.test(finding.label) || /isch[ae]m|infarct/i.test(finding.description);

  const isDemo = finding.isDemonstration || finding.provenance === "report_extracted" || finding.provenance === "demo_synthetic";

  // Confidence mapping
  const confidenceCategory =
    finding.confidenceLevel ||
    (finding.confidence >= 75 ? "high" : finding.confidence >= 50 ? "moderate" : "low");

  const confidenceDisplay = isDemo
    ? { text: "Report cue (Uncalibrated)", badgeClass: "bg-amber-950/40 text-amber-300 border-amber-800/40" }
    : confidenceCategory === "high"
    ? { text: "High confidence", badgeClass: "bg-emerald-950/40 text-emerald-300 border-emerald-800/40" }
    : confidenceCategory === "moderate"
    ? { text: "Moderate confidence", badgeClass: "bg-amber-950/40 text-amber-300 border-amber-800/40" }
    : { text: "Low confidence", badgeClass: "bg-orange-950/40 text-orange-300 border-orange-800/40" };

  // Status mapping
  const isAccepted = finding.status === "accepted" || finding.status === "confirmed";
  const isModified = finding.status === "modified";
  const isRejected = finding.status === "rejected";

  const handleShowOnScan = () => {
    onSelectFinding(finding.id);
    if (onShowOnScan) {
      onShowOnScan(finding);
      return;
    }
    if (finding.seriesId && onSelectSeries) {
      onSelectSeries(finding.seriesId);
    }
    if (finding.sliceIndex !== undefined && onJumpToSlice) {
      onJumpToSlice(finding.sliceIndex);
    }
  };

  const handleAccept = () => {
    onUpdateFinding(finding.id, { status: "accepted" });
    if (onAddToReport) {
      onAddToReport(finding);
    }
  };

  const handleSaveModification = () => {
    onUpdateFinding(finding.id, {
      status: "modified",
      label: modLabel,
      anatomicalLocation: modLocation,
      location: modLocation,
      chronicity: modChronicity as any,
      severityLevel: modSeverity as any,
      radiologistNote: modComment,
    });
    setShowModifyDialog(false);
  };

  const handleReject = (reason: string) => {
    onUpdateFinding(finding.id, {
      status: "rejected",
      rejectionReason: reason,
    });
    setShowRejectMenu(false);
  };

  return (
    <div
      onClick={() => onSelectFinding(finding.id)}
      className={cn(
        "rounded-lg border transition-all text-[11.5px] select-none",
        isActive
          ? "border-clinical bg-clinical/10 ring-1 ring-clinical"
          : isAccepted
          ? "border-emerald-800/50 bg-emerald-950/15"
          : isModified
          ? "border-amber-800/50 bg-amber-950/15"
          : isRejected
          ? "border-border-strong/50 bg-panel-alt/50 opacity-60"
          : "border-border-strong bg-panel hover:border-clinical/50",
        finding.isCritical && !isRejected && "border-critical/60 bg-critical/10"
      )}
    >
      {/* Top Header: Finding Label, State Badge & Categorical Confidence */}
      <div className="p-3 border-b border-border/40 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {isDemo ? (
                <span className="rounded bg-amber-950/60 border border-amber-600/50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
                  DEMO ONLY — NOT FOR DIAGNOSIS
                </span>
              ) : (
                <span className="text-[10px] uppercase font-bold tracking-wider text-ink-muted">AI Finding</span>
              )}
              {finding.isCritical && !isRejected && (
                <span className="rounded bg-critical/20 border border-critical/50 px-1.5 py-0.2 text-[9px] font-bold uppercase text-critical">
                  STAT / High Priority
                </span>
              )}
            </div>
            <h4 className="font-semibold text-[13px] text-ink-primary leading-snug mt-0.5">
              {finding.label}
            </h4>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            {/* Categorical Confidence (Section 17) */}
            <span
              className={cn(
                "rounded border px-2 py-0.5 font-medium text-[10.5px]",
                confidenceDisplay.badgeClass
              )}
            >
              {confidenceDisplay.text}
            </span>

            {/* Expandable Technical Model Score */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowTechnicalScore((v) => !v);
              }}
              className="text-[9.5px] font-mono text-ink-muted hover:text-ink-secondary flex items-center gap-0.5"
              title="Provenance and validation status"
            >
              <span>Provenance info</span>
              {showTechnicalScore ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            </button>
          </div>
        </div>

        {/* Technical Score / Provenance Expansion */}
        {showTechnicalScore && (
          <div className="rounded bg-base/80 p-2 border border-border text-[10px] space-y-1 font-mono text-ink-secondary">
            <div className="flex justify-between">
              <span>Source Provenance:</span>
              <span className="text-amber-400 font-bold uppercase">{finding.provenance || (isDemo ? "report_extracted" : "model_inference")}</span>
            </div>
            {isDemo ? (
              <p className="text-[9.5px] text-amber-300/90 pt-0.5">
                Notice: Bounding box and coordinates were inferred from report sentence cues. No deep learning computer vision model is currently connected.
              </p>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Raw Model Score:</span>
                  <span className="text-ink-primary font-bold">{(finding.confidence / 100).toFixed(2)}</span>
                </div>
                {finding.modelName && (
                  <div className="flex justify-between">
                    <span>Model Architecture:</span>
                    <span className="text-ink-primary">{finding.modelName}</span>
                  </div>
                )}
              </>
            )}
            <p className="text-[9px] text-ink-muted italic pt-0.5 border-t border-border/50">
              Not for diagnosis. Findings are subject to mandatory radiologist verification.
            </p>
          </div>
        )}

        {/* Status indicator after action */}
        {isAccepted && (
          <div className="flex items-center gap-1.5 rounded bg-emerald-950/40 border border-emerald-800/40 px-2 py-1 text-[10.5px] text-emerald-300 font-medium">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>Accepted · Added to diagnostic report</span>
          </div>
        )}
        {isModified && (
          <div className="flex items-center gap-1.5 rounded bg-amber-950/40 border border-amber-800/40 px-2 py-1 text-[10.5px] text-amber-300 font-medium">
            <Edit3 className="h-3.5 w-3.5 shrink-0" />
            <span>Modified · Radiologist edited</span>
          </div>
        )}
        {isRejected && (
          <div className="flex items-center justify-between rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-[10.5px] text-zinc-400">
            <div className="flex items-center gap-1.5">
              <X className="h-3.5 w-3.5 shrink-0 text-red-400" />
              <span>Rejected{finding.rejectionReason ? `: ${finding.rejectionReason}` : ""}</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateFinding(finding.id, { status: "pending", rejectionReason: undefined });
              }}
              className="text-[10px] underline hover:text-zinc-200"
            >
              Undo
            </button>
          </div>
        )}
      </div>

      {/* Middle Body: Location, Series, Slice & Description */}
      <div className="p-3 space-y-2 border-b border-border/40 bg-base/30">
        {/* Anatomical Context Matrix */}
        <div className="grid grid-cols-2 gap-2 text-[10.5px]">
          <div>
            <span className="text-[9.5px] uppercase font-bold text-ink-muted block">Location</span>
            <span className="font-medium text-ink-primary">
              {finding.anatomicalLocation || finding.location || "Metadata unavailable"}
            </span>
          </div>
          <div>
            <span className="text-[9.5px] uppercase font-bold text-ink-muted block">Series & Plane</span>
            <span className="font-medium text-ink-primary truncate block">
              {seriesName} · {plane}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[10.5px] pt-1 border-t border-border/30">
          <div>
            <span className="text-[9.5px] uppercase font-bold text-ink-muted block">Slice</span>
            <span className="font-mono font-medium text-ink-primary">
              {sliceNum !== undefined ? `${sliceNum}${totalSlices ? ` / ${totalSlices}` : ""}` : "Volumetric"}
            </span>
          </div>
          {finding.chronicity && (
            <div>
              <span className="text-[9.5px] uppercase font-bold text-ink-muted block">Chronicity</span>
              <span className="capitalize font-medium text-ink-primary">{finding.chronicity}</span>
            </div>
          )}
        </div>

        {/* Clinical Description */}
        {finding.description && (
          <p className="text-[11px] text-ink-secondary leading-relaxed pt-1">
            {finding.description}
          </p>
        )}

        {/* DWI / ADC Correlation Status for Brain MRI (Section 9) */}
        {isBrainMri && isIschemicFinding && (
          <div className="rounded border border-border/70 bg-panel/60 p-2 text-[10px] space-y-1">
            <span className="font-semibold text-ink-secondary uppercase tracking-wider text-[9px] block">
              Correlation: DWI / ADC
            </span>
            {dwiSeries || adcSeries ? (
              <div className="flex items-center gap-2">
                {dwiSeries && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectSeries) onSelectSeries(dwiSeries.id);
                    }}
                    className="px-2 py-0.5 rounded bg-clinical/20 text-clinical-strong hover:bg-clinical/30 border border-clinical/40 font-mono"
                  >
                    View DWI
                  </button>
                )}
                {adcSeries && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectSeries) onSelectSeries(adcSeries.id);
                    }}
                    className="px-2 py-0.5 rounded bg-clinical/20 text-clinical-strong hover:bg-clinical/30 border border-clinical/40 font-mono"
                  >
                    View ADC
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleShowOnScan();
                  }}
                  className="text-ink-secondary hover:text-ink-primary underline ml-auto text-[9.5px]"
                >
                  Show on scan
                </button>
              </div>
            ) : (
              <p className="text-amber-400/90 text-[10px] flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>DWI/ADC correlation unavailable in this study.</span>
              </p>
            )}
          </div>
        )}

        {/* "Why did AI flag this?" Explainability Interaction (Section 16) */}
        <div className="pt-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowWhyEvidence((v) => !v);
            }}
            className="flex items-center gap-1 text-[10.5px] font-medium text-clinical hover:underline"
          >
            <HelpCircle className="h-3 w-3" />
            <span>Why did AI flag this? (Evidence)</span>
            {showWhyEvidence ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showWhyEvidence && (
            <div className="mt-1.5 rounded border border-border bg-base/90 p-2.5 text-[10.5px] space-y-2">
              <span className="font-semibold text-ink-primary text-[10.5px] block">
                Model Detection Criteria:
              </span>
              {(() => {
                const observations: string[] = Array.isArray(finding.evidenceDetails)
                  ? (finding.evidenceDetails as any)
                  : finding.evidenceDetails?.keyObservations || [];
                return observations.length > 0 ? (
                  <ul className="space-y-1 list-disc list-inside text-ink-secondary text-[10px]">
                    {observations.map((item: string, idx: number) => (
                      <li key={idx} className="leading-snug">{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted italic text-[10px]">
                    Model-level explanation unavailable.
                  </p>
                );
              })()}

              <div className="pt-1 border-t border-border/50 text-[9.5px] text-ink-muted">
                <span>Supporting Sequences: </span>
                <span className="text-ink-primary font-mono">{seriesName}</span>
                {dwiSeries ? (
                  <span className="text-ink-primary font-mono">, {dwiSeries.label}</span>
                ) : (
                  <span className="text-ink-muted"> (DWI unavailable)</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Primary Actions Row: Show on scan | Compare prior | Add to report */}
      <div className="p-2.5 flex flex-wrap items-center justify-between gap-1.5 bg-panel-alt/40 border-b border-border/40">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleShowOnScan();
          }}
          className="flex items-center gap-1 rounded bg-clinical/15 border border-clinical/30 px-2.5 py-1 text-[11px] font-medium text-clinical hover:bg-clinical/25 transition-colors"
          title="Switch series, jump to slice, center ROI, and highlight finding"
        >
          <Crosshair className="h-3 w-3" />
          <span>Show on scan</span>
        </button>

        {onComparePrior && study.priorStudies && study.priorStudies.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onComparePrior(finding);
            }}
            className="flex items-center gap-1 rounded bg-base border border-border px-2 py-1 text-[11px] font-medium text-ink-secondary hover:text-ink-primary hover:bg-panel transition-colors"
          >
            <GitCompare className="h-3 w-3" />
            <span>Compare prior</span>
          </button>
        )}

        {onAddToReport && !isAccepted && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleAccept();
            }}
            className="flex items-center gap-1 rounded bg-base border border-border px-2 py-1 text-[11px] font-medium text-ink-secondary hover:text-ink-primary hover:bg-panel transition-colors ml-auto"
          >
            <Plus className="h-3 w-3" />
            <span>Add to report</span>
          </button>
        )}
      </div>

      {/* Decision Support Review Action Bar: Accept | Modify | Reject */}
      <div className="p-2.5 flex items-center gap-1.5 bg-panel">
        <button
          type="button"
          disabled={isAccepted}
          onClick={(e) => {
            e.stopPropagation();
            handleAccept();
          }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors border",
            isAccepted
              ? "bg-emerald-950/50 text-emerald-300 border-emerald-800/60"
              : "bg-emerald-950/20 text-emerald-400 border-emerald-800/40 hover:bg-emerald-950/40"
          )}
        >
          <Check className="h-3 w-3" />
          <span>{isAccepted ? "Accepted" : "Accept"}</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowModifyDialog(true);
            setShowRejectMenu(false);
          }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors border",
            isModified
              ? "bg-amber-950/50 text-amber-300 border-amber-800/60"
              : "bg-amber-950/20 text-amber-400 border-amber-800/40 hover:bg-amber-950/40"
          )}
        >
          <Edit3 className="h-3 w-3" />
          <span>{isModified ? "Modified" : "Modify"}</span>
        </button>

        <button
          type="button"
          disabled={isRejected}
          onClick={(e) => {
            e.stopPropagation();
            setShowRejectMenu((v) => !v);
            setShowModifyDialog(false);
          }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors border",
            isRejected
              ? "bg-zinc-900 text-zinc-400 border-zinc-700"
              : "bg-red-950/20 text-red-400 border-red-800/40 hover:bg-red-950/40"
          )}
        >
          <X className="h-3 w-3" />
          <span>{isRejected ? "Rejected" : "Reject"}</span>
        </button>
      </div>

      {/* Structured Rejection Dropdown Menu (Section 15) */}
      {showRejectMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="m-2 rounded-lg border border-red-800/40 bg-base p-2.5 space-y-2 shadow-xl"
        >
          <div className="flex items-center justify-between text-[11px] font-semibold text-red-300">
            <span>Select Rejection Reason</span>
            <button
              type="button"
              onClick={() => setShowRejectMenu(false)}
              className="text-ink-muted hover:text-ink-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {REJECTION_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => handleReject(reason)}
                className="rounded px-2 py-1 text-left text-[10.5px] text-ink-secondary hover:bg-red-950/40 hover:text-red-200 transition-colors"
              >
                {reason}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Structured Modification Inline Form (Section 14) */}
      {showModifyDialog && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="m-2 rounded-lg border border-amber-800/40 bg-base p-3 space-y-2.5 shadow-xl"
        >
          <div className="flex items-center justify-between text-[11.5px] font-semibold text-amber-300 border-b border-border pb-1.5">
            <span>Modify Finding (Radiologist Override)</span>
            <button
              type="button"
              onClick={() => setShowModifyDialog(false)}
              className="text-ink-muted hover:text-ink-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-ink-muted">Finding Terminology</label>
            <input
              type="text"
              value={modLabel}
              onChange={(e) => setModLabel(e.target.value)}
              className="w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-ink-primary focus:border-clinical outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-ink-muted">Anatomical Location</label>
            <input
              type="text"
              value={modLocation}
              onChange={(e) => setModLocation(e.target.value)}
              className="w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-ink-primary focus:border-clinical outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-ink-muted">Chronicity</label>
              <select
                value={modChronicity}
                onChange={(e) => setModChronicity(e.target.value)}
                className="w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-ink-primary focus:border-clinical outline-none"
              >
                {CHRONICITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-ink-muted">Severity</label>
              <select
                value={modSeverity}
                onChange={(e) => setModSeverity(e.target.value)}
                className="w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-ink-primary focus:border-clinical outline-none"
              >
                {SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-ink-muted">Radiologist Comment</label>
            <textarea
              rows={2}
              value={modComment}
              onChange={(e) => setModComment(e.target.value)}
              placeholder="Clinical reasoning or notes regarding this finding..."
              className="w-full rounded border border-border bg-panel px-2 py-1 text-[11px] text-ink-primary focus:border-clinical outline-none resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowModifyDialog(false)}
              className="px-2.5 py-1 rounded text-[10.5px] text-ink-secondary hover:text-ink-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveModification}
              className="px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-600/50 hover:bg-amber-500/30 font-semibold text-[10.5px]"
            >
              Save Modification
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
