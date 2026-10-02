"use client";

import { useState } from "react";
import { CheckCircle2, PenLine, ShieldCheck, ShieldAlert } from "lucide-react";
import { Report, ReportQCWarning, Study } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { AuditTrail } from "@/lib/audit-trail";
import { runQCAgent } from "@/lib/agents/qc-agent";
import { ReportQCModal } from "@/components/report/ReportQCModal";

export function ApprovalPanel({
  report,
  study,
  onApprove,
}: {
  report: Report;
  study?: Study;
  onApprove: () => void;
}) {
  const { user } = useAuthStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcWarnings, setQcWarnings] = useState<ReportQCWarning[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  const isApproved = report.status === "approved";

  const handleInitiateApproval = () => {
    if (study) {
      const qcResult = runQCAgent(report.sections, study.findings);
      if (qcResult.warnings.length > 0) {
        setQcWarnings(qcResult.warnings);
        setQcModalOpen(true);
        return;
      }
    }
    setConfirmOpen(true);
  };

  const handleQCOverride = () => {
    setQcModalOpen(false);
    setConfirmOpen(true);
  };

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink-primary">Approval &amp; Attestation</h3>
      </div>
      <div className="p-4">
        {isApproved ? (
          <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success-dim px-3.5 py-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-ink-primary">Report Approved</p>
              <p className="mt-0.5 text-[11.5px] text-ink-secondary">
                {report.reviewer?.name} · {report.approvedAt && formatDateTime(report.approvedAt)}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Version v{report.version} · Electronically signed</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Approving finalizes this report and applies your electronic signature. An automated AI Quality Control (QC) verification will audit the draft for clinical safety, laterality agreement, and acute findings before final sign-off.
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-3.5 w-full"
              onClick={handleInitiateApproval}
            >
              <PenLine className="h-4 w-4" /> Approve &amp; Sign Report
            </Button>
          </>
        )}
      </div>

      {/* QC Audit Modal */}
      <ReportQCModal
        isOpen={qcModalOpen}
        onClose={() => setQcModalOpen(false)}
        warnings={qcWarnings}
        onConfirmApproval={handleQCOverride}
      />

      {/* Signature Confirmation Modal */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm report approval & electronic signature"
        description="This will lock the clinical report, increment version history, and stamp your legal electronic signature."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-panel-alt px-3.5 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-clinical" />
            <div className="text-[12px] leading-relaxed text-ink-secondary">
              <p>Signing as <span className="font-semibold text-ink-primary">{user.name}</span>, {user.role}.</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">Certified NPI: {user.npi || "Verified"} · {user.department || "Medical Imaging Workstation"}</p>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink-secondary">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-strong accent-clinical"
            />
            <span>
              I confirm I have personally reviewed all visualized imaging series, AI-detected findings, and structured report sections, and attest that this report is complete, accurate, and reflects my independent clinical judgment.
            </span>
          </label>
          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={!acknowledged}
              onClick={() => {
                if (study) {
                  AuditTrail.record(study.id, "REPORT_APPROVED", user, {
                    reportVersion: report.version,
                    studyId: study.id,
                  });
                }
                onApprove();
                setConfirmOpen(false);
                setAcknowledged(false);
              }}
            >
              <CheckCircle2 className="h-4 w-4" /> Confirm &amp; Sign
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
