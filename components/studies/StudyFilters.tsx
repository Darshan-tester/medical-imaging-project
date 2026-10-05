"use client";

import { useEffect, useRef } from "react";
import { LayoutGrid, List, Search, X, SlidersHorizontal } from "lucide-react";
import { Modality, StudyPriority, StudyStatus } from "@/lib/types";
import { RADIOLOGISTS } from "@/lib/mock-data";
import { DATASET_SOURCE_LABEL, DatasetSourceId } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

export interface StudyFilterState {
  query: string;
  modality: Modality | "all";
  status: StudyStatus | "all";
  priority: StudyPriority | "all";
  radiologist: string | "all";
  confidence: "all" | "high" | "moderate" | "low";
  dataset: DatasetSourceId | "all";
}

export const DEFAULT_FILTERS: StudyFilterState = {
  query: "",
  modality: "all",
  status: "all",
  priority: "all",
  radiologist: "all",
  confidence: "all",
  dataset: "all",
};

const DATASET_FILTER_OPTIONS: { key: DatasetSourceId; label: string }[] = [
  { key: "MRI", label: "MRI Source" },
  { key: "CT", label: "CT Source" },
  { key: "CHEST_XRAY", label: "Chest X-Ray" },
  { key: "ULTRASOUND", label: "Ultrasound" },
  { key: "PET", label: "PET" },
  { key: "ROCOV2", label: "ROCOv2" },
];

export function StudyFilters({
  filters,
  setFilters,
  view,
  setView,
  resultCount,
  showDatasetFilter = false,
}: {
  filters: StudyFilterState;
  setFilters: (f: StudyFilterState) => void;
  view: "table" | "grid";
  setView: (v: "table" | "grid") => void;
  resultCount: number;
  showDatasetFilter?: boolean;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  const set = <K extends keyof StudyFilterState>(key: K, value: StudyFilterState[K]) =>
    setFilters({ ...filters, [key]: value });

  // Keyboard shortcut '/' focuses search field
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement)?.isContentEditable
        )
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="space-y-3">
      {/* Primary Row: Clinical Search Bar + View Switcher */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search by Patient name, MRN, Study ID, Modality, Body Region..."
            className="w-full rounded-lg border border-[#223049] bg-[#0c121e] pl-10 pr-20 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-400 focus:border-sky-500 focus:bg-[#0e1626] focus:outline-none focus:ring-1 focus:ring-sky-500/50 transition-all shadow-inner"
          />
          {filters.query ? (
            <button
              onClick={() => set("query", "")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400 rounded bg-[#162032] border border-[#233149] px-1.5 py-0.5">
              /
            </span>
          )}
        </div>

        {/* View toggle & count */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center rounded-lg border border-[#223049] bg-[#0c121e] p-0.5">
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex h-8 items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-colors",
                view === "table"
                  ? "bg-sky-600 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              )}
              aria-label="Table view"
              title="Table view"
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden md:inline">List</span>
            </button>
            <button
              onClick={() => setView("grid")}
              className={cn(
                "flex h-8 items-center gap-1.5 px-3 rounded-md text-[12px] font-medium transition-colors",
                view === "grid"
                  ? "bg-sky-600 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              )}
              aria-label="Grid view"
              title="Grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Cards</span>
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Row: Compact, Clinical Filter Selects */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400 mr-1 select-none">
          <SlidersHorizontal className="h-3 w-3 text-sky-400" />
          <span>Filter:</span>
        </div>

        {/* Modality Select */}
        <select
          value={filters.modality}
          onChange={(e) => set("modality", e.target.value as StudyFilterState["modality"])}
          className="rounded-md border border-[#223049] bg-[#0c121e] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
        >
          <option value="all">All Modalities</option>
          {(["CT", "MRI", "PET", "X-Ray", "Ultrasound", "Mammography"] as Modality[]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* Status Select */}
        <select
          value={filters.status}
          onChange={(e) => set("status", e.target.value as StudyFilterState["status"])}
          className="rounded-md border border-[#223049] bg-[#0c121e] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
        >
          <option value="all">All Statuses</option>
          {(["queued", "processing", "ai-complete", "in-review", "approved"] as StudyStatus[]).map((s) => (
            <option key={s} value={s}>
              {s === "in-review" ? "In review" : s.replace("-", " ")}
            </option>
          ))}
        </select>

        {/* Priority Select */}
        <select
          value={filters.priority}
          onChange={(e) => set("priority", e.target.value as StudyFilterState["priority"])}
          className="rounded-md border border-[#223049] bg-[#0c121e] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
        >
          <option value="all">All Priorities</option>
          {(["routine", "urgent", "stat"] as StudyPriority[]).map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>

        {/* Dataset Source */}
        {showDatasetFilter && (
          <select
            value={filters.dataset}
            onChange={(e) => set("dataset", e.target.value as StudyFilterState["dataset"])}
            className="rounded-md border border-[#223049] bg-[#0c121e] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="all">All Sources</option>
            {DATASET_FILTER_OPTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        )}

        {/* Radiologist */}
        <select
          value={filters.radiologist}
          onChange={(e) => set("radiologist", e.target.value)}
          className="rounded-md border border-[#223049] bg-[#0c121e] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 outline-none focus:border-sky-500 cursor-pointer"
        >
          <option value="all">Any Radiologist</option>
          {RADIOLOGISTS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        {!isDefault && (
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-medium text-slate-400 hover:text-slate-100 hover:bg-[#162032] border border-transparent hover:border-[#233149] transition-all"
          >
            <X className="h-3 w-3" />
            <span>Reset filters</span>
          </button>
        )}

        <div className="ml-auto font-mono text-[11.5px] text-slate-400">
          <span className="font-semibold text-slate-200 tabular-nums">{resultCount.toLocaleString()}</span> studies found
        </div>
      </div>
    </div>
  );
}
