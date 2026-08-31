import { Study } from "@/lib/types";
import { DatasetSourceBadge, ModalityBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { formatDateTime } from "@/lib/utils";
import { UserRound } from "lucide-react";

export function StudySummaryCard({ study }: { study: Study }) {
  const rows: [string, React.ReactNode][] = [
    ["Study ID", <span key="1" className="font-mono">{study.studyId}</span>],
    ["Patient", study.patientAlias],
    ["Age / Sex", study.age !== undefined || study.sex ? `${study.age !== undefined ? `${study.age}y` : "Not available"} / ${study.sex ?? "Not available"}` : "Not available"],
    ["Modality", <ModalityBadge key="2" modality={study.modality} />],
    ["Region", study.bodyRegion ?? "Not available"],
    ["Study Date", study.date ? formatDateTime(study.date) : "Not available"],
    ["Priority", <PriorityBadge key="3" priority={study.priority} />],
    ["Status", <StatusBadge key="4" status={study.status} />],
    ...(study.datasetSource ? ([["Source", <DatasetSourceBadge key="5" source={study.datasetSource} />]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <div>
      <div className="border-b border-border px-4 py-3.5">
        <h3 className="text-[13px] font-semibold text-ink-primary">Study Summary</h3>
      </div>
      <ScanThumbnail
        seed={study.thumbnailSeed}
        modality={study.modality}
        imageUrl={study.imageUrls?.[0]}
        animated
        className="h-36 w-full border-b border-border"
      />
      <div className="space-y-3 p-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-muted">{label}</span>
            <span className="text-[12.5px] font-medium text-ink-primary">{value}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-panel-alt px-3 py-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ai/15 text-ai">
            <UserRound className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-medium text-ink-primary">{study.assignedRadiologist?.name ?? "Unassigned"}</p>
            <p className="text-[10.5px] text-ink-muted">{study.assignedRadiologist?.role ?? "Awaiting assignment"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
