"use client";

import { AlertTriangle, CheckCircle, ShieldAlert, X } from "lucide-react";
import { ReportQCWarning } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface ReportQCModalProps {
  isOpen: boolean;
  onClose: () => void;
  warnings: ReportQCWarning[];
  onConfirmApproval: () => void;
}

export function ReportQCModal({
  isOpen,
  onClose,
  warnings,
  onConfirmApproval,
}: ReportQCModalProps) {
  if (!isOpen) return null;

  const criticalWarnings = warnings.filter((w) => w.severity === "critical");
  const advisoryWarnings = warnings.filter((w) => w.severity !== "critical");
  const hasCritical = criticalWarnings.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-xl border border-border bg-panel shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            {hasCritical ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-critical-dim text-critical">
                <ShieldAlert className="h-5 w-5" />
              </div>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success-dim text-success">
                <CheckCircle className="h-5 w-5" />
              </div>
            )}
            <div>
              <h3 className="text-[15px] font-semibold text-ink-primary">
                AI Quality Control Audit
              </h3>
              <p className="text-[12px] text-ink-secondary">
                Pre-approval consistency and clinical safety verification
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-muted hover:bg-panel-alt hover:text-ink-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
          {warnings.length === 0 ? (
            <div className="rounded-lg border border-success/30 bg-success-dim/30 p-4 text-center">
              <CheckCircle className="mx-auto h-8 w-8 text-success" />
              <p className="mt-2 text-[13px] font-medium text-ink-primary">
                All Automated Quality Checks Passed
              </p>
              <p className="mt-1 text-[12px] text-ink-secondary">
                No laterality discrepancies, contradictions, or missing acute findings were detected between Findings and Impression.
              </p>
            </div>
          ) : (
            <>
              {hasCritical && (
                <div className="rounded-lg border border-critical/40 bg-critical-dim/30 p-3.5">
                  <div className="flex items-center gap-2 text-critical font-medium text-[13px]">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Clinical Safety Warnings Detected ({criticalWarnings.length})</span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-ink-secondary">
                    The AI Quality-Control Agent detected potential inconsistencies that require deliberate radiologist review before final sign-off.
                  </p>
                </div>
              )}

              {/* Critical Warnings */}
              {criticalWarnings.map((w) => (
                <div
                  key={w.id}
                  className="rounded-lg border border-critical/30 bg-panel-alt p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px] text-critical">
                      {w.title}
                    </span>
                    <span className="rounded bg-critical-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-critical">
                      {w.category.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-primary">{w.description}</p>
                  {w.suggestedAction && (
                    <p className="text-[11.5px] text-clinical font-medium">
                      💡 Remedy: {w.suggestedAction}
                    </p>
                  )}
                </div>
              ))}

              {/* Advisory Warnings */}
              {advisoryWarnings.map((w) => (
                <div
                  key={w.id}
                  className="rounded-lg border border-warning/30 bg-panel-alt p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[13px] text-warning">
                      {w.title}
                    </span>
                    <span className="rounded bg-warning-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                      {w.category.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-primary">{w.description}</p>
                  {w.suggestedAction && (
                    <p className="text-[11.5px] text-ink-muted">
                      💡 Suggested: {w.suggestedAction}
                    </p>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-panel-alt px-5 py-3.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Back to Edit Report
          </Button>

          <Button
            variant={hasCritical ? "critical" : "primary"}
            size="sm"
            onClick={() => {
              onConfirmApproval();
              onClose();
            }}
          >
            {hasCritical ? "Acknowledge & Sign Anyway" : "Approve & Sign Report"}
          </Button>
        </div>
      </div>
    </div>
  );
}
