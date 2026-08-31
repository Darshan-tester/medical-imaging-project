import { IncidentReport } from "@/lib/types";
import { SeverityBadge, IncidentStatusBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import { UserRound } from "lucide-react";

export function IncidentCard({ incident }: { incident: IncidentReport }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink-primary">{incident.incidentType}</h3>
          <p className="mt-1 text-[11.5px] text-ink-muted">
            {incident.studyId ? `Study ${incident.studyId} · ` : ""}
            {formatDateTime(incident.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <IncidentStatusBadge status={incident.status} />
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-[12.5px]">
        <div>
          <dt className="font-medium text-ink-secondary">Description</dt>
          <dd className="mt-1 leading-relaxed text-ink-primary">{incident.description}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink-secondary">Findings</dt>
          <dd className="mt-1 leading-relaxed text-ink-primary">{incident.findings}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink-secondary">Action Taken</dt>
          <dd className="mt-1 leading-relaxed text-ink-primary">{incident.actionTaken}</dd>
        </div>
      </dl>

      {incident.reviewer && (
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/15 text-ai">
            <UserRound className="h-3 w-3" />
          </div>
          <span className="text-[11.5px] text-ink-secondary">Reviewed by {incident.reviewer.name}</span>
        </div>
      )}
    </div>
  );
}
