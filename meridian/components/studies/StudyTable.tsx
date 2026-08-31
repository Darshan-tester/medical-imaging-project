"use client";

import Link from "next/link";
import { ArrowUpDown, ChevronRight, ScanEye, UserRound } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Study, StudyPriority, StudyStatus } from "@/lib/types";
import { DatasetSourceBadge, ModalityBadge, PriorityBadge, StatusBadge } from "@/components/ui/Badge";
import { ConfidenceIndicator } from "@/components/ui/ConfidenceIndicator";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type SortKey = "date" | "priority" | "aiConfidence" | "patientAlias";

const PRIORITY_OPTIONS: StudyPriority[] = ["routine", "urgent", "stat"];
const STATUS_OPTIONS: StudyStatus[] = ["queued", "processing", "ai-complete", "in-review", "approved"];

export function StudyTable({
  studies,
  compact = false,
  sortKey,
  sortDir,
  onSort,
  editable = false,
  onPriorityChange,
  onStatusChange,
}: {
  studies: Study[];
  compact?: boolean;
  sortKey?: SortKey;
  sortDir?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
  editable?: boolean;
  onPriorityChange?: (id: string, priority: StudyPriority) => void;
  onStatusChange?: (id: string, status: StudyStatus) => void;
}) {
  const Header = ({ label, k, className }: { label: string; k?: SortKey; className?: string }) => (
    <th className={cn("px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted", className)}>
      {k && onSort ? (
        <button onClick={() => onSort(k)} className="flex items-center gap-1 hover:text-ink-secondary">
          {label}
          <ArrowUpDown className={cn("h-3 w-3", sortKey === k ? "text-clinical" : "text-ink-muted/50")} />
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <Header label="Study" />
            <Header label="Patient" k="patientAlias" />
            <Header label="Modality" />
            {!compact && <Header label="Region" />}
            <Header label="Date" k="date" />
            <Header label="Status" />
            <Header label="Priority" k="priority" />
            <Header label="AI Confidence" k="aiConfidence" />
            <th className="w-8" />
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {studies.map((s) => (
            <tr key={s.id} className="group border-b border-border transition-colors duration-150 hover:bg-panel-hover">
              <td className="px-4 py-3">
                <Link href={`/studies/${s.id}`} className="font-mono text-[12.5px] font-medium text-ink-primary hover:text-clinical">
                  {s.studyId}
                </Link>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--overlay-hover)/0.06)] text-ink-muted">
                    <UserRound className="h-3 w-3" />
                  </div>
                  <div>
                    <p className="text-[12.5px] text-ink-primary">{s.patientAlias}</p>
                    <p className="text-[10.5px] text-ink-muted">
                      {s.age !== undefined || s.sex ? [s.age !== undefined ? `${s.age}y` : undefined, s.sex].filter(Boolean).join(" · ") : "Not available"}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <ModalityBadge modality={s.modality} />
                  {s.datasetSource && <DatasetSourceBadge source={s.datasetSource} />}
                </div>
              </td>
              {!compact && <td className="px-4 py-3 text-[12.5px] text-ink-secondary">{s.bodyRegion ?? "Not available"}</td>}
              <td className="px-4 py-3 text-[12.5px] text-ink-secondary tabular-nums">{s.date ? formatDate(s.date) : "Not available"}</td>
              <td className="px-4 py-3">
                {editable && onStatusChange ? (
                  <select
                    value={s.status}
                    onChange={(e) => onStatusChange(s.id, e.target.value as StudyStatus)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-border-strong bg-panel-alt px-1.5 py-1 text-[11px] text-ink-primary outline-none focus:border-clinical/60"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt.replace("-", " ")}
                      </option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge status={s.status} />
                )}
              </td>
              <td className="px-4 py-3">
                {editable && onPriorityChange ? (
                  <select
                    value={s.priority}
                    onChange={(e) => onPriorityChange(s.id, e.target.value as StudyPriority)}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-md border border-border-strong bg-panel-alt px-1.5 py-1 text-[11px] text-ink-primary outline-none focus:border-clinical/60"
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <PriorityBadge priority={s.priority} />
                )}
              </td>
              <td className="px-4 py-3">
                {s.aiConfidence !== null ? (
                  <ConfidenceIndicator value={s.aiConfidence} band={s.aiConfidence >= 88 ? "high" : s.aiConfidence >= 70 ? "moderate" : "low"} />
                ) : (
                  <span className="text-[12px] text-ink-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <Tooltip label="View scan">
                  <Link
                    href={`/studies/${s.id}?tab=analysis`}
                    aria-label={`View scan for ${s.studyId}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 hover:bg-clinical-dim hover:text-clinical"
                  >
                    <ScanEye className="h-3.5 w-3.5" />
                  </Link>
                </Tooltip>
              </td>
              <td className="px-4 py-3">
                <Link href={`/studies/${s.id}`}>
                  <ChevronRight className="h-4 w-4 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
