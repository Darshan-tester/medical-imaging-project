"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Flame,
  Layers,
  Sparkles,
  UserRound,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { Study, StudyPriority, StudyStatus, Modality } from "@/lib/types";
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

// Clean Clinical Modality Display
function WorklistModalityDisplay({ modality, datasetSource }: { modality: Modality; datasetSource?: string }) {
  const modalityColors: Record<Modality, { text: string; bg: string; border: string }> = {
    CT: { text: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/25" },
    MRI: { text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/25" },
    PET: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
    "X-Ray": { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
    Ultrasound: { text: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/25" },
    Mammography: { text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/25" },
  };

  const style = modalityColors[modality] || {
    text: "text-slate-300",
    bg: "bg-slate-500/10",
    border: "border-slate-500/25",
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider border",
          style.bg,
          style.text,
          style.border
        )}
      >
        {modality === "PET" && <Flame className="h-3 w-3" />}
        {modality}
      </span>
      <span className="font-mono text-[10.5px] text-slate-400 tracking-tight">
        {datasetSource ? datasetSource : `${modality} Scanner`}
      </span>
    </div>
  );
}

// Clean Clinical Priority
function WorklistPriorityDisplay({ priority }: { priority: StudyPriority }) {
  if (priority === "stat") {
    return (
      <div className="inline-flex items-center gap-1.5 font-sans text-[11.5px] font-semibold text-rose-400 tracking-tight">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
        </span>
        <span>STAT</span>
      </div>
    );
  }

  if (priority === "urgent") {
    return (
      <div className="inline-flex items-center gap-1.5 font-sans text-[11.5px] font-semibold text-amber-400 tracking-tight">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span>Urgent</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 font-sans text-[11.5px] font-medium text-slate-400">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
      <span>Routine</span>
    </div>
  );
}

// Clean Clinical Reading Status
function WorklistStatusDisplay({ status }: { status: StudyStatus }) {
  switch (status) {
    case "approved":
      return (
        <div className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Approved</span>
        </div>
      );
    case "in-review":
      return (
        <div className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-sky-400">
          <Clock className="h-3.5 w-3.5" />
          <span>In review</span>
        </div>
      );
    case "ai-complete":
      return (
        <div className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-purple-400">
          <Sparkles className="h-3.5 w-3.5" />
          <span>AI Complete</span>
        </div>
      );
    case "processing":
      return (
        <div className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-amber-400">
          <span className="h-2 w-2 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <span>Processing</span>
        </div>
      );
    case "queued":
    default:
      return (
        <div className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          <span>Queued</span>
        </div>
      );
  }
}

export function StudyTable({
  studies,
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

  const SortableHeader = ({
    label,
    k,
    className,
  }: {
    label: string;
    k?: SortKey;
    className?: string;
  }) => {
    const isSorted = sortKey === k;
    return (
      <th
        className={cn(
          "px-4 py-3 text-left text-[11px] font-semibold tracking-wider text-slate-400 uppercase select-none border-b border-[#1e293b]",
          className
        )}
      >
        {k && onSort ? (
          <button
            onClick={() => onSort(k)}
            className="group inline-flex items-center gap-1.5 hover:text-slate-100 transition-colors"
          >
            <span>{label}</span>
            {isSorted ? (
              sortDir === "asc" ? (
                <ChevronUp className="h-3.5 w-3.5 text-sky-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-sky-400" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 text-slate-600 group-hover:text-slate-400 transition-colors" />
            )}
          </button>
        ) : (
          <span>{label}</span>
        )}
      </th>
    );
  };

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#1e293b] bg-[#090d16] shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-[#0e1422] border-b border-[#1e293b]">
              <SortableHeader label="Patient" k="patientAlias" className="w-[20%]" />
              <SortableHeader label="Study Date" k="date" className="w-[14%]" />
              <SortableHeader label="Modality" k="modality" className="w-[12%]" />
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wider text-slate-400 uppercase select-none border-b border-[#1e293b] w-[12%]">
                Body Region
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-wider text-slate-400 uppercase select-none border-b border-[#1e293b] w-[24%]">
                Study Description
              </th>
              <SortableHeader label="Status" k="status" className="w-[10%]" />
              <SortableHeader label="Priority" k="priority" className="w-[8%]" />
              <th className="px-4 py-3 text-right text-[11px] font-semibold tracking-wider text-slate-400 uppercase select-none border-b border-[#1e293b] w-[10%]">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151f32]">
            {studies.map((s) => {
              const isSelected = selectedId === s.id;
              const totalSlices = s.series.reduce((sum, ser) => sum + ser.sliceCount, 0);
              const seriesCount = s.series.length;
              const studyTitle =
                s.sourceReport?.indication ||
                s.series[0]?.label ||
                `${s.modality} ${s.bodyRegion ?? "Examination"}`;

              const isStat = s.priority === "stat";

              return (
                <tr
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  onDoubleClick={() => router.push(`/studies/${s.id}`)}
                  className={cn(
                    "group transition-all duration-150 cursor-pointer select-none",
                    isSelected
                      ? "bg-[#101b2e] border-l-2 border-l-sky-500"
                      : "hover:bg-[#0f1728]",
                    isStat && !isSelected && "bg-rose-950/10"
                  )}
                >
                  {/* 1. PATIENT: Patient Name + MRN / Demographics */}
                  <td className="px-4 py-3.5 align-middle">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-slate-400 transition-colors",
                          isSelected
                            ? "border-sky-500/40 bg-sky-500/15 text-sky-300"
                            : "border-[#1e293b] bg-[#111827] group-hover:border-sky-500/30 group-hover:text-sky-300"
                        )}
                      >
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/studies/${s.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-[13.5px] text-slate-100 group-hover:text-sky-400 transition-colors block truncate"
                        >
                          {s.patientAlias}
                        </Link>
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                          <span className="truncate">{s.studyId}</span>
                          {s.accessionNumber && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-300">ACC: {s.accessionNumber}</span>
                            </>
                          )}
                          {(s.age !== undefined || s.sex) && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="font-sans text-slate-400">
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

                  {/* 2. STUDY DATE: Date + Time */}
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <div className="text-[12.5px] font-medium text-slate-200">
                      {s.date ? formatDate(s.date) : "—"}
                    </div>
                    {s.date && (
                      <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                        {new Date(s.date).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </td>

                  {/* 3. MODALITY: Modality tag + Scanner/Source */}
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <WorklistModalityDisplay modality={s.modality} datasetSource={s.datasetSource} />
                  </td>

                  {/* 4. BODY REGION: Clean text, no heavy pills */}
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <span className="text-[12px] font-medium tracking-wide uppercase text-slate-300 font-mono">
                      {s.bodyRegion ?? "Unspecified"}
                    </span>
                  </td>

                  {/* 5. STUDY: Study Title + Series / Slices / AI analyzed */}
                  <td className="px-4 py-3.5 align-middle max-w-[280px]">
                    <p className="text-[13px] font-medium text-slate-100 truncate">
                      {studyTitle}
                    </p>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 mt-0.5">
                      <Layers className="h-3 w-3 text-slate-500 shrink-0" />
                      <span>
                        {seriesCount} {seriesCount === 1 ? "Series" : "Series"} · {totalSlices} Slices
                      </span>
                      {s.findings && s.findings.length > 0 && (
                        <>
                          <span className="text-slate-600">·</span>
                          <span className="text-purple-400 flex items-center gap-0.5 font-sans font-medium">
                            <Sparkles className="h-2.5 w-2.5" />
                            {s.findings.length} AI
                          </span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* 6. STATUS: In review / Queued / Approved */}
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    {editable && onStatusChange ? (
                      <select
                        value={s.status}
                        onChange={(e) => onStatusChange(s.id, e.target.value as StudyStatus)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border border-[#2d3a4f] bg-[#0c1322] px-2 py-1 text-[11px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
                      >
                        {STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt.replace("-", " ")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <WorklistStatusDisplay status={s.status} />
                    )}
                  </td>

                  {/* 7. PRIORITY: Routine / Urgent / STAT */}
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    {editable && onPriorityChange ? (
                      <select
                        value={s.priority}
                        onChange={(e) => onPriorityChange(s.id, e.target.value as StudyPriority)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border border-[#2d3a4f] bg-[#0c1322] px-2 py-1 text-[11px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
                      >
                        {PRIORITY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <WorklistPriorityDisplay priority={s.priority} />
                    )}
                  </td>

                  {/* 8. ACTIONS: Open in Workstation */}
                  <td className="px-4 py-3.5 align-middle text-right whitespace-nowrap">
                    <Link
                      href={`/studies/${s.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all shadow-sm",
                        isSelected
                          ? "bg-sky-600 text-white shadow-sky-950/40"
                          : "border border-[#26354a] bg-[#111827] text-slate-200 hover:bg-sky-600 hover:text-white hover:border-transparent group-hover:border-sky-600/40"
                      )}
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
    </div>
  );
}
