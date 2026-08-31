"use client";

import { LayoutGrid, List, Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
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
  { key: "MRI", label: "MRI" },
  { key: "CT", label: "CT" },
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
  /** Only shown in dataset mode — the mock demo studies have no dataset source to filter by. */
  showDatasetFilter?: boolean;
}) {
  const isDefault = JSON.stringify(filters) === JSON.stringify(DEFAULT_FILTERS);

  const set = <K extends keyof StudyFilterState>(key: K, value: StudyFilterState[K]) => setFilters({ ...filters, [key]: value });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
          <Input
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder="Search patient, study ID, modality..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border-strong bg-panel-alt p-0.5">
          <button
            onClick={() => setView("table")}
            className={cn("flex h-7 w-8 items-center justify-center rounded", view === "table" ? "bg-clinical-dim text-clinical" : "text-ink-muted")}
            aria-label="Table view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setView("grid")}
            className={cn("flex h-7 w-8 items-center justify-center rounded", view === "grid" ? "bg-clinical-dim text-clinical" : "text-ink-muted")}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filters.modality} onChange={(e) => set("modality", e.target.value as StudyFilterState["modality"])} className="w-auto min-w-[128px]">
          <option value="all">All Modalities</option>
          {(["CT", "MRI", "X-Ray", "Ultrasound", "PET", "Mammography"] as Modality[]).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>

        <Select value={filters.status} onChange={(e) => set("status", e.target.value as StudyFilterState["status"])} className="w-auto min-w-[128px]">
          <option value="all">All Statuses</option>
          {(["queued", "processing", "ai-complete", "in-review", "approved"] as StudyStatus[]).map((s) => (
            <option key={s} value={s}>
              {s.replace("-", " ")}
            </option>
          ))}
        </Select>

        <Select value={filters.priority} onChange={(e) => set("priority", e.target.value as StudyFilterState["priority"])} className="w-auto min-w-[110px]">
          <option value="all">All Priorities</option>
          {(["routine", "urgent", "stat"] as StudyPriority[]).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>

        {showDatasetFilter && (
          <Select value={filters.dataset} onChange={(e) => set("dataset", e.target.value as StudyFilterState["dataset"])} className="w-auto min-w-[140px]">
            <option value="all">All Sources</option>
            {DATASET_FILTER_OPTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        )}

        <Select value={filters.confidence} onChange={(e) => set("confidence", e.target.value as StudyFilterState["confidence"])} className="w-auto min-w-[140px]">
          <option value="all">Any AI Confidence</option>
          <option value="high">High confidence</option>
          <option value="moderate">Moderate confidence</option>
          <option value="low">Low confidence</option>
        </Select>

        <Select value={filters.radiologist} onChange={(e) => set("radiologist", e.target.value)} className="w-auto min-w-[150px]">
          <option value="all">Any Radiologist</option>
          {RADIOLOGISTS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>

        {!isDefault && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}

        <span className="ml-auto text-[12px] text-ink-muted">{resultCount} studies</span>
      </div>
    </div>
  );
}
