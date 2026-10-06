import { Study, ReportSection } from "@/lib/types";
import { StudySummaryCard } from "./StudySummaryCard";
import { ReportEditor } from "./ReportEditor";
import { ApprovalPanel } from "./ApprovalPanel";
import { ExportButton } from "./ExportButton";
import { ConfidenceBand } from "@/components/ui/Badge";

export function ReportTab({
  study,
  onChangeSections,
  onApprove,
}: {
  study: Study;
  onChangeSections: (sections: ReportSection) => void;
  onApprove: () => void;
}) {
  const positiveFindings = study.findings.filter((f) => !f.label.toLowerCase().startsWith("no "));

  return (
    <div className="mx-auto grid max-w-[1300px] grid-cols-1 gap-5 p-5 lg:grid-cols-[260px_1fr_300px]">
      <div className="order-2 rounded-xl border border-border bg-panel lg:order-1">
        <StudySummaryCard study={study} />
      </div>

      <div className="order-1 rounded-xl border border-border bg-panel p-5 lg:order-2">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-section-title text-ink-primary">Clinical Report</h2>
          <ExportButton study={study} />
        </div>
        <ReportEditor report={study.report} study={study} onChange={onChangeSections} />
      </div>

      <div className="order-3 space-y-5">
        <ApprovalPanel report={study.report} study={study} onApprove={onApprove} />

        <div className="rounded-xl border border-border bg-panel">
          <div className="border-b border-border px-4 py-3.5 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-ink-primary">AI Decision Support</h3>
            <span className="text-[10px] font-mono text-ink-muted">Traceable Candidates</span>
          </div>
          <div className="space-y-2.5 p-3">
            {positiveFindings.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-ink-secondary">No candidate findings were suggested by the AI model.</p>
            ) : (
              positiveFindings.map((f) => {
                const confLabel =
                  f.confidenceLevel === "high" || f.band === "high"
                    ? "High confidence"
                    : f.confidenceLevel === "moderate" || f.band === "moderate"
                    ? "Moderate confidence"
                    : "Low confidence";
                return (
                  <div key={f.id} className="rounded-lg border border-border bg-panel-alt p-3 text-[12px] space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12.5px] font-semibold text-ink-primary leading-snug">{f.label}</p>
                      <span className="text-[10px] font-medium text-amber-300 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded shrink-0">
                        {confLabel}
                      </span>
                    </div>
                    {f.anatomicalLocation && (
                      <p className="text-[11px] text-ink-secondary">Location: {f.anatomicalLocation}</p>
                    )}
                    <div className="flex items-center justify-between text-[10.5px] text-ink-muted font-mono pt-1 border-t border-border/50">
                      <span>{f.seriesLabel || "FLAIR"} · Slice {f.sliceIndex !== undefined ? f.sliceIndex + 1 : "Vol"}</span>
                      <span className="capitalize">{f.status === "accepted" ? "✓ Added to Report" : f.status.replace("_", " ")}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
