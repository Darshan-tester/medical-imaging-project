import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Study } from "@/lib/types";
import { ModalityBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShieldCheck } from "lucide-react";
import { formatTime } from "@/lib/utils";

export function PriorityQueue({ studies }: { studies: Study[] }) {
  const urgent = studies.filter((s) => s.priority !== "routine" && s.status !== "approved").slice(0, 5);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h3 className="text-card-title text-ink-primary">Priority Queue</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-secondary">Urgent and STAT studies awaiting review</p>
        </div>
        <span className="rounded-md bg-critical-dim px-2 py-0.5 font-mono text-[11px] font-medium text-critical">{urgent.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {urgent.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={ShieldCheck} title="Queue is clear" description="No urgent or STAT studies are currently awaiting review." />
          </div>
        ) : (
          urgent.map((s) => (
            <Link
              key={s.id}
              href={`/studies/${s.id}`}
              className="flex items-center gap-3 border-b border-border px-5 py-3 transition-colors last:border-0 hover:bg-panel-hover"
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${s.priority === "stat" ? "bg-critical-dim text-critical" : "bg-warning-dim text-warning"}`}>
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink-primary">{s.patientAlias}</p>
                <p className="truncate text-[11px] text-ink-muted">
                  {[s.studyId, s.bodyRegion].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <ModalityBadge modality={s.modality} />
                <span className="text-[10.5px] text-ink-muted">{s.date ? formatTime(s.date) : "—"}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
