"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { listStudies } from "@/lib/mock-data";
import { ModalityBadge, Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/utils";
import { ReportStatus } from "@/lib/types";
import { exportStudyReportPDF } from "@/lib/pdf";
import { useUIStore } from "@/lib/store";

const REPORT_STATUS_TONE: Record<ReportStatus, "ai" | "warning" | "success"> = {
  "ai-draft": "ai",
  "in-review": "warning",
  approved: "success",
};

export default function ReportsPage() {
  const studies = listStudies();
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("all");
  const pushToast = useUIStore((s) => s.pushToast);

  const filtered = useMemo(
    () => studies.filter((s) => statusFilter === "all" || s.report.status === statusFilter),
    [studies, statusFilter]
  );

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8 md:py-8">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical/15 text-clinical">
          <FileText className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h1 className="text-section-title text-ink-primary">Reports</h1>
          <p className="text-[12.5px] text-ink-secondary">Clinical reports across all studies — drafted, reviewed, and approved.</p>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReportStatus | "all")} className="w-auto min-w-[160px]">
          <option value="all">All Report Statuses</option>
          <option value="ai-draft">AI Draft</option>
          <option value="in-review">In Review</option>
          <option value="approved">Approved</option>
        </Select>
        <span className="text-[12px] text-ink-muted">{filtered.length} reports</span>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-panel">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={FileText} title="No reports found" description="Try a different status filter." />
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5">Study</th>
                <th className="px-4 py-2.5">Patient</th>
                <th className="px-4 py-2.5">Modality</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Report Status</th>
                <th className="px-4 py-2.5">Version</th>
                <th className="px-4 py-2.5">Reviewer</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-border transition-colors hover:bg-panel-hover">
                  <td className="px-4 py-3">
                    <Link href={`/studies/${s.id}`} className="font-mono text-[12.5px] font-medium text-ink-primary hover:text-clinical">
                      {s.studyId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-secondary">{s.patientAlias}</td>
                  <td className="px-4 py-3">
                    <ModalityBadge modality={s.modality} />
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-secondary tabular-nums">{s.date ? formatDate(s.date) : "Not available"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={REPORT_STATUS_TONE[s.report.status]}>{s.report.status.replace("-", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink-secondary">v{s.report.version}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-secondary">{s.report.reviewer?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        exportStudyReportPDF(s);
                        pushToast({ title: "Report exported", description: `${s.studyId}-report.pdf`, tone: "success" });
                      }}
                    >
                      <Download className="h-3.5 w-3.5" /> PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
