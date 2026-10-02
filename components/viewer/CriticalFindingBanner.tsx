"use client";

import { useState } from "react";
import { AlertTriangle, BellRing, Check, CheckCircle2, ChevronRight, Eye, ShieldAlert, X } from "lucide-react";
import { Finding } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AuditTrail } from "@/lib/audit-trail";
import { useAuthStore } from "@/lib/store";

interface CriticalFindingBannerProps {
  studyId: string;
  findings: Finding[];
  acknowledgedIds: string[];
  onAcknowledge: (findingId: string, action: "confirmed" | "dismissed", note: string) => void;
  onJumpToSlice: (sliceIndex: number) => void;
}

export function CriticalFindingBanner({
  studyId,
  findings,
  acknowledgedIds,
  onAcknowledge,
  onJumpToSlice,
}: CriticalFindingBannerProps) {
  const { user } = useAuthStore();
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [actionType, setActionType] = useState<"confirmed" | "dismissed">("confirmed");
  const [physicianNote, setPhysicianNote] = useState("");
  const [referringDoctor, setReferringDoctor] = useState("");
  const [communicationMethod, setCommunicationMethod] = useState("Phone Call / Direct Verbal");

  // Identify all critical or acute findings
  const criticalFindings = findings.filter(
    (f) =>
      f.isCritical ||
      f.priority === "critical" ||
      f.severity === "critical" ||
      /pneumothorax|hemorrhage|infarct|aortic dissection|embolism|perforation/i.test(f.label)
  );

  if (criticalFindings.length === 0) return null;

  const pendingFindings = criticalFindings.filter((f) => !acknowledgedIds.includes(f.id));
  const isAllAcknowledged = pendingFindings.length === 0;

  const handleOpenActionModal = (finding: Finding, type: "confirmed" | "dismissed") => {
    setSelectedFinding(finding);
    setActionType(type);
    setPhysicianNote("");
    setReferringDoctor("");
  };

  const handleCommitAction = () => {
    if (!selectedFinding) return;

    const fullNote =
      actionType === "confirmed"
        ? `Confirmed by ${user.name}. Notified ${referringDoctor || "Attending Physician"} via ${communicationMethod}. Notes: ${physicianNote || "Immediate critical finding reported per hospital statutory protocol."}`
        : `Dismissed by ${user.name} as artifact/non-acute. Rationale: ${physicianNote || "Clinical review ruled out acute pathology."}`;

    AuditTrail.record(
      studyId,
      actionType === "confirmed" ? "CRITICAL_FINDING_CONFIRMED" : "CRITICAL_FINDING_DISMISSED",
      user,
      {
        findingId: selectedFinding.id,
        findingLabel: selectedFinding.label,
        sliceIndex: selectedFinding.sliceIndex,
        action: actionType,
        note: fullNote,
        referringDoctor,
        communicationMethod,
      }
    );

    onAcknowledge(selectedFinding.id, actionType, fullNote);
    setSelectedFinding(null);
  };

  return (
    <>
      <div
        className={`relative z-20 border-b px-4 py-2.5 transition-colors ${
          isAllAcknowledged
            ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
            : "border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-red-950/30 to-amber-950/40 text-amber-200 animate-pulse-slow"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {isAllAcknowledged ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/20 text-red-400">
                <AlertTriangle className="h-4 w-4 animate-bounce" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold tracking-wide uppercase">
                  {isAllAcknowledged
                    ? "Critical Findings Acknowledged & Documented"
                    : `⚠️ Urgent Action Required: ${pendingFindings.length} Critical Acute ${pendingFindings.length === 1 ? "Finding" : "Findings"}`}
                </span>
                {!isAllAcknowledged && (
                  <span className="rounded-full bg-red-500/25 px-2 py-0.5 text-[10px] font-bold text-red-300">
                    STAT Critical Gate
                  </span>
                )}
              </div>
              <p className="text-[11px] opacity-80 truncate">
                {isAllAcknowledged
                  ? "All critical acute imaging findings have been reviewed and statutory communication logged."
                  : "Clinical workstation protocol requires radiologist acknowledgment or dismissal before report finalization."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {criticalFindings.map((cf) => {
              const isAcked = acknowledgedIds.includes(cf.id);
              return (
                <div
                  key={cf.id}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-all ${
                    isAcked
                      ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-300 line-through opacity-70"
                      : "border-red-500/50 bg-red-950/50 text-red-200 shadow-sm"
                  }`}
                >
                  <span className="font-semibold">{cf.label}</span>
                  <span className="opacity-75 text-[10.5px]">(Slice {cf.sliceIndex + 1})</span>

                  <button
                    type="button"
                    onClick={() => onJumpToSlice(cf.sliceIndex)}
                    title={`Jump to slice ${cf.sliceIndex + 1}`}
                    className="ml-1 inline-flex items-center rounded p-1 hover:bg-white/10 text-cyan-300"
                  >
                    <Eye className="h-3 w-3" />
                  </button>

                  {!isAcked && (
                    <div className="ml-1 flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="primary"
                        className="h-6 bg-red-600 hover:bg-red-500 text-[10.5px] px-2 py-0"
                        onClick={() => handleOpenActionModal(cf, "confirmed")}
                      >
                        <Check className="h-3 w-3 mr-0.5" /> Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-ink-muted hover:text-white text-[10.5px] px-1.5 py-0"
                        onClick={() => handleOpenActionModal(cf, "dismissed")}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Critical Finding Review & Communication Modal */}
      <Modal
        open={!!selectedFinding}
        onClose={() => setSelectedFinding(null)}
        title={
          actionType === "confirmed"
            ? `Confirm Critical Finding: ${selectedFinding?.label}`
            : `Dismiss Finding: ${selectedFinding?.label}`
        }
        description={
          actionType === "confirmed"
            ? "Log statutory critical finding notification and clinical handover documentation."
            : "Record clinical justification for dismissing this AI-detected acute finding."
        }
      >
        <div className="space-y-4 text-[12.5px]">
          <div className="rounded-lg border border-border bg-panel-alt p-3 space-y-1.5">
            <div className="flex justify-between items-center text-[12px]">
              <span className="font-semibold text-ink-primary">Anatomical Location:</span>
              <span className="font-mono text-cyan-400">{selectedFinding?.location || "Thoracic / Visual Field"}</span>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="font-semibold text-ink-primary">Slice Index:</span>
              <span className="font-mono text-ink-secondary">Slice {(selectedFinding?.sliceIndex ?? 0) + 1}</span>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="font-semibold text-ink-primary">AI Confidence:</span>
              <span className="font-mono text-amber-400">{Math.round((selectedFinding?.confidence ?? 0.85) * 100)}%</span>
            </div>
          </div>

          {actionType === "confirmed" ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[11.5px] font-semibold text-ink-secondary mb-1">
                  Referring Physician / Clinical Contact Notified
                </label>
                <input
                  type="text"
                  value={referringDoctor}
                  onChange={(e) => setReferringDoctor(e.target.value)}
                  placeholder="e.g. Dr. R. Mitchell (ED Attending / ICU Fellow)"
                  className="w-full rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-ink-primary outline-none focus:border-clinical"
                />
              </div>

              <div>
                <label className="block text-[11.5px] font-semibold text-ink-secondary mb-1">
                  Communication Channel
                </label>
                <select
                  value={communicationMethod}
                  onChange={(e) => setCommunicationMethod(e.target.value)}
                  className="w-full rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-ink-primary outline-none focus:border-clinical"
                >
                  <option value="Phone Call / Direct Verbal">Phone Call / Direct Verbal</option>
                  <option value="Hospital Pager / Vocera">Hospital Pager / Vocera</option>
                  <option value="Stat EHR Critical Alert">Stat EHR Critical Alert</option>
                  <option value="Direct In-Person Handover">Direct In-Person Handover</option>
                </select>
              </div>

              <div>
                <label className="block text-[11.5px] font-semibold text-ink-secondary mb-1">
                  Physician Communication Notes / Read-Back Verification
                </label>
                <textarea
                  rows={3}
                  value={physicianNote}
                  onChange={(e) => setPhysicianNote(e.target.value)}
                  placeholder="e.g. Spoke with Dr. Mitchell at 17:15. Finding conveyed with read-back confirmed. Immediate chest tube placement advised."
                  className="w-full rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-ink-primary outline-none focus:border-clinical"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11.5px] font-semibold text-ink-secondary mb-1">
                Clinical Rationale for Dismissal
              </label>
              <textarea
                rows={3}
                value={physicianNote}
                onChange={(e) => setPhysicianNote(e.target.value)}
                placeholder="e.g. Skin fold artifact / motion blur mimics pneumothorax line; true visceral pleural line absent. Ruled out on physical comparison."
                className="w-full rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-ink-primary outline-none focus:border-clinical"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setSelectedFinding(null)}>
              Cancel
            </Button>
            <Button
              variant={actionType === "confirmed" ? "primary" : "secondary"}
              size="sm"
              className={actionType === "confirmed" ? "bg-red-600 hover:bg-red-500" : ""}
              onClick={handleCommitAction}
            >
              {actionType === "confirmed" ? "Commit Handover & Acknowledge" : "Dismiss Finding"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
