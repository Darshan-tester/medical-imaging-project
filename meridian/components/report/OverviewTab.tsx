import { Study } from "@/lib/types";
import { StudySummaryCard } from "./StudySummaryCard";
import { StudyPipeline } from "./StudyPipeline";
import { Layers, ShieldAlert, Sparkles, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function OverviewTab({ study, onOpenViewer }: { study: Study; onOpenViewer?: () => void }) {
  const accepted = study.findings.filter((f) => f.status === "accepted").length;
  const rejected = study.findings.filter((f) => f.status === "rejected").length;
  const positive = study.findings.filter((f) => !f.label.toLowerCase().startsWith("no ")).length;

  return (
    <div className="mx-auto max-w-[1200px] grid grid-cols-1 gap-5 p-5 lg:grid-cols-[280px_1fr]">
      <div className="rounded-xl border border-border bg-panel">
        <StudySummaryCard study={study} />
      </div>

      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="text-card-title text-ink-primary">Processing Pipeline</h3>
          <div className="mt-4">
            <StudyPipeline status={study.status} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-ink-muted">
              <Layers className="h-3.5 w-3.5" />
              <span className="text-[11.5px] font-medium">Series</span>
            </div>
            <p className="mt-2 font-mono text-[22px] font-semibold text-ink-primary">{study.series.length}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">{study.series.reduce((a, s) => a + s.sliceCount, 0)} total images</p>
          </div>
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-ink-muted">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="text-[11.5px] font-medium">Findings</span>
            </div>
            <p className="mt-2 font-mono text-[22px] font-semibold text-ink-primary">{positive}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {accepted} accepted · {rejected} rejected
            </p>
          </div>
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-center gap-2 text-ink-muted">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="text-[11.5px] font-medium">Report Status</span>
            </div>
            <p className="mt-2 text-[15px] font-semibold capitalize text-ink-primary">{study.report.status.replace("-", " ")}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">Version v{study.report.version}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-card-title text-ink-primary">Series</h3>
            {onOpenViewer && (
              <Button size="sm" variant="primary" onClick={onOpenViewer}>
                <ScanEye className="h-3.5 w-3.5" /> Open Viewer
              </Button>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {study.series.map((s) => (
              <button
                key={s.id}
                onClick={onOpenViewer}
                disabled={!onOpenViewer}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-panel-alt px-3.5 py-2.5 text-left transition-colors duration-150 hover:border-clinical/40 hover:bg-clinical-dim disabled:pointer-events-none"
              >
                <div>
                  <p className="text-[12.5px] font-medium text-ink-primary">{s.label}</p>
                  <p className="text-[11px] text-ink-muted">{s.orientation}</p>
                </div>
                <span className="font-mono text-[11.5px] text-ink-secondary">{s.sliceCount > 1 ? `${s.sliceCount} slices` : "1 image"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
