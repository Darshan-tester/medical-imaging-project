"use client";

import { useState } from "react";
import { CheckCircle2, PenLine, ShieldCheck } from "lucide-react";
import { Report } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/utils";
import { CURRENT_USER } from "@/lib/mock-data";

export function ApprovalPanel({ report, onApprove }: { report: Report; onApprove: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const isApproved = report.status === "approved";

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink-primary">Approval</h3>
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
              Approving finalizes this report and applies your electronic signature. This action requires deliberate confirmation.
            </p>
            <Button variant="primary" size="md" className="mt-3.5 w-full" onClick={() => setConfirmOpen(true)}>
              <PenLine className="h-4 w-4" /> Approve &amp; Sign Report
            </Button>
          </>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm report approval"
        description="This will finalize the report and apply your electronic signature."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-panel-alt px-3.5 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-clinical" />
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Signing as <span className="font-medium text-ink-primary">{CURRENT_USER.name}</span>, {CURRENT_USER.role}.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink-secondary">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-strong accent-clinical"
            />
            I confirm I have reviewed all AI findings and report content, and that it is accurate to the best of my clinical judgment.
          </label>
          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={!acknowledged}
              onClick={() => {
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
