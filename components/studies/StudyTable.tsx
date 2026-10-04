"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronRight,
  ExternalLink,
  Flame,
  Layers,
  Sparkles,
  UserRound,
  AlertCircle,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Study, StudyPriority, StudyStatus, Modality } from "@/lib/types";
import { DatasetSourceBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type SortKey = "date" | "priority" | "aiConfidence" | "patientAlias" | "modality" | "status";

const PRIORITY_OPTIONS: StudyPriority[] = ["routine", "urgent", "stat"];
const STATUS_OPTIONS: StudyStatus[] = [
  "queued",
  "processing",
  "ai-complete",
  "in-review",
  "approved",
];

// Clinical Modality Badge with PACS reading room color coding
function WorklistModalityBadge({ modality }: { modality: Modality }) {
  const styles: Record<Modality, { bg: string; text: string; border: string }> = {
    CT: {
      bg: "bg-sky-500/15",
      text: "text-sky-400",
      border: "border-sky-500/30",
    },
    MRI: {
      bg: "bg-violet-500/15",
      text: "text-violet-400",
      border: "border-violet-500/30",
    },
    PET: {
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      border: "border-amber-500/30",
    },
    "X-Ray": {
      bg: "bg-emerald-500/15",
      text: "text-emerald-400",
      border: "border-emerald-500/30",
    },
    Ultrasound: {
      bg: "bg-teal-500/15",
      text: "text-teal-400",
      border: "border-teal-500/30",
    },
    Mammography: {
      bg: "bg-rose-500/15",
      text: "text-rose-400",
      border: "border-rose-500/30",
    },
  };

  const style = styles[modality] || {
    bg: "bg-slate-500/15",
    text: "text-slate-300",
    border: "border-slate-500/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider font-mono border",
        style.bg,
        style.text,
        style.border
      )}
    >
      {modality === "PET" && <Flame className="h-3 w-3" />}
      {modality}
    </span>
  );
}

// Priority Badge with emergency pulse for STAT studies
function WorklistPriorityBadge({ priority }: { priority: StudyPriority }) {
  if (priority === "stat") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-rose-400 border border-rose-500/40 animate-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        STAT
      </span>
    );
  }
  if (priority === "urgent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-400 border border-amber-500/40">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Urgent
      </span>
    );
  }
  return (
    <span className="text-[11px] font-medium text-slate-400">
      Routine
    </span>
  );
}

// Reading Status Badge
function WorklistStatusBadge({ status }: { status: StudyStatus }) {
  switch (status) {
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      );
    case "in-review":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-sky-400 bg-sky-500/10 border border-sky-500/20">
          <Clock className="h-3 w-3" />
          In Review
        </span>
      );
    case "ai-complete":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-purple-400 bg-purple-500/10 border border-purple-500/20">
          <Sparkles className="h-3 w-3" />
          AI Complete
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20">
          <span className="h-1.5 w-1.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          Processing
        </span>
      );
    case "queued":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 bg-slate-500/10 border border-slate-500/20">
          Queued
        </span>
      );
  }
}

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
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const Header = ({
    label,
    k,
    className,
  }: {
    label: string;
    k?: SortKey;
    className?: string;
  }) => (
    <th
      className={cn(
        "px-3.5 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 select-none",
        className
      )}
    >
      {k && onSort ? (
        <button
          onClick={() => onSort(k)}
          className="flex items-center gap-1.5 hover:text-slate-200 transition-colors group"
        >
          <span>{label}</span>
          <ArrowUpDown
            className={cn(
              "h-3 w-3 transition-colors",
              sortKey === k ? "text-sky-400" : "text-slate-600 group-hover:text-slate-400"
            )}
          />
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-[#1e293b] bg-[#0b0f19]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[#1e293b] bg-[#080c14]/80">
            <Header label="Patient" k="patientAlias" />
            <Header label="Study Date" k="date" />
            <Header label="Modality" k="modality" />
            <Header label="Body Region" />
            <Header label="Study Description" />
            <Header label="Status" k="status" />
            <th className="px-3 py-2.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1e293b]/70 font-sans">
          {studies.map((s) => {
            const isSelected = selectedId === s.id;
            const totalSlices = s.series.reduce((sum, ser) => sum + ser.sliceCount, 0);
            const seriesCount = s.series.length;
            const studyDescription =
              s.sourceReport?.indication ||
              s.series[0]?.label ||
              `${s.modality} ${s.bodyRegion ?? "Examination"}`;

            return (
              <tr
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                onDoubleClick={() => router.push(`/studies/${s.id}`)}
                className={cn(
                  "group transition-colors cursor-pointer select-none",
                  isSelected
                    ? "bg-sky-500/10 border-l-2 border-l-sky-500"
                    : "hover:bg-[#131b2e]/60"
                )}
              >
                {/* 1. Patient: Name, MRN/ID, Age/Sex */}
                <td className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400 group-hover:bg-sky-950 group-hover:text-sky-300 transition-colors">
                      <UserRound className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/studies/${s.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-[13px] text-slate-100 hover:text-sky-400 transition-colors truncate"
                        >
                          {s.patientAlias}
                        </Link>
                        {s.priority === "stat" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                        <span className="truncate">{s.studyId}</span>
                        {(s.age !== undefined || s.sex) && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-400 font-sans">
                              {[s.age !== undefined ? `${s.age}y` : undefined, s.sex]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* 2. Study Date & Time */}
                <td className="px-3.5 py-2.5 whitespace-nowrap">
                  <div className="font-mono text-[12px] text-slate-300 tabular-nums">
                    {s.date ? formatDate(s.date) : "—"}
                  </div>
                  {s.date && (
                    <div className="font-mono text-[10.5px] text-slate-500">
                      {new Date(s.date).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </td>

                {/* 3. Modality & Source */}
                <td className="px-3.5 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <WorklistModalityBadge modality={s.modality} />
                    {s.datasetSource && <DatasetSourceBadge source={s.datasetSource} />}
                  </div>
                </td>

                {/* 4. Body Region */}
                <td className="px-3.5 py-2.5 whitespace-nowrap">
                  <span className="rounded bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700/60">
                    {s.bodyRegion ?? "Unspecified"}
                  </span>
                </td>

                {/* 5. Study Description & Acquisition Info */}
                <td className="px-3.5 py-2.5 max-w-[320px]">
                  <p className="text-[12.5px] text-slate-200 truncate font-medium">
                    {studyDescription}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5 mt-0.5">
                    <Layers className="h-3 w-3 text-slate-500" />
                    <span>
                      {seriesCount} {seriesCount === 1 ? "Series" : "Series"} · {totalSlices} Slices
                    </span>
                    {s.findings && s.findings.length > 0 && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-purple-400 flex items-center gap-0.5">
                          <Sparkles className="h-2.5 w-2.5" />
                          {s.findings.length} AI
                        </span>
                      </>
                    )}
                  </p>
                </td>

                {/* 6. Status & Priority */}
                <td className="px-3.5 py-2.5 whitespace-nowrap">
                  <div className="flex flex-col gap-1 items-start">
                    <div className="flex items-center gap-2">
                      {editable && onStatusChange ? (
                        <select
                          value={s.status}
                          onChange={(e) =>
                            onStatusChange(s.id, e.target.value as StudyStatus)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-[#334155] bg-[#0f172a] px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-sky-500"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt.replace("-", " ")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <WorklistStatusBadge status={s.status} />
                      )}

                      {editable && onPriorityChange ? (
                        <select
                          value={s.priority}
                          onChange={(e) =>
                            onPriorityChange(s.id, e.target.value as StudyPriority)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-[#334155] bg-[#0f172a] px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-sky-500"
                        >
                          {PRIORITY_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <WorklistPriorityBadge priority={s.priority} />
                      )}
                    </div>
                  </div>
                </td>

                {/* 7. Action / Quick Open */}
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <Link
                    href={`/studies/${s.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#1e293b] px-2.5 py-1 text-[11.5px] font-medium text-slate-200 hover:bg-sky-600 hover:text-white transition-all shadow-sm group-hover:bg-sky-600/80 group-hover:text-white"
                  >
                    <span>Read</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
