"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Flame,
  Layers,
  Loader2,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { StudyTable, SortKey } from "@/components/studies/StudyTable";
import { StudyCard } from "@/components/studies/StudyCard";
import { IndexStatusBanner } from "@/components/studies/IndexStatusBanner";
import { StudyFilters, DEFAULT_FILTERS, StudyFilterState } from "@/components/studies/StudyFilters";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { fetchStudies, getDataMode } from "@/lib/data-source";
import { DATASET_SOURCE_LABEL } from "@/lib/dataset/types";
import { Modality, Study, StudyPriority, StudyStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODALITY_SHORTCUTS: { label: string; value: Modality | "all" }[] = [
  { label: "All Modalities", value: "all" },
  { label: "CT", value: "CT" },
  { label: "MRI", value: "MRI" },
  { label: "PET / Fusion", value: "PET" },
  { label: "X-Ray", value: "X-Ray" },
  { label: "Ultrasound", value: "Ultrasound" },
];

export default function StudiesPage() {
  const dataMode = getDataMode();
  const [allStudies, setAllStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StudyFilterState>(DEFAULT_FILTERS);
  const [view, setView] = useState<"table" | "grid">("table");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchStudies()
      .then((studies) => {
        if (!cancelled) setAllStudies(studies);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load studies");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute triage counts
  const triageStats = useMemo(() => {
    let statCount = 0;
    let urgentCount = 0;
    let inReviewCount = 0;
    let aiCompleteCount = 0;

    for (const s of allStudies) {
      if (s.priority === "stat") statCount++;
      if (s.priority === "urgent") urgentCount++;
      if (s.status === "in-review") inReviewCount++;
      if (s.status === "ai-complete") aiCompleteCount++;
    }

    return { statCount, urgentCount, inReviewCount, aiCompleteCount, total: allStudies.length };
  }, [allStudies]);

  const filtered = useMemo(() => {
    let result = allStudies.filter((s) => {
      if (filters.modality !== "all" && s.modality !== filters.modality) return false;
      if (filters.status !== "all" && s.status !== filters.status) return false;
      if (filters.priority !== "all" && s.priority !== filters.priority) return false;
      if (filters.radiologist !== "all" && s.assignedRadiologist?.id !== filters.radiologist) return false;
      if (filters.dataset !== "all" && s.datasetSource !== DATASET_SOURCE_LABEL[filters.dataset]) return false;
      if (filters.confidence !== "all") {
        if (s.aiConfidence === null) return false;
        const band = s.aiConfidence >= 88 ? "high" : s.aiConfidence >= 70 ? "moderate" : "low";
        if (band !== filters.confidence) return false;
      }
      if (filters.query.trim()) {
        const q = filters.query.toLowerCase();
        const haystack = `${s.patientAlias} ${s.studyId} ${s.modality} ${s.bodyRegion ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const priorityRank: Record<StudyPriority, number> = { routine: 0, urgent: 1, stat: 2 };
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = +new Date(a.date ?? 0) - +new Date(b.date ?? 0);
      else if (sortKey === "priority") cmp = priorityRank[a.priority] - priorityRank[b.priority];
      else if (sortKey === "aiConfidence") cmp = (a.aiConfidence ?? -1) - (b.aiConfidence ?? -1);
      else if (sortKey === "patientAlias") cmp = a.patientAlias.localeCompare(b.patientAlias);
      else if (sortKey === "modality") cmp = a.modality.localeCompare(b.modality);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [allStudies, filters, sortKey, sortDir]);

  // Reset to first page when filters or sorting change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const onPriorityChange = (id: string, priority: StudyPriority) => {
    setAllStudies((prev) => prev.map((s) => (s.id === id ? { ...s, priority } : s)));
  };
  const onStatusChange = (id: string, status: StudyStatus) => {
    setAllStudies((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-5 md:px-6 md:py-6 space-y-4">
      {/* 1. Header & Clinical Triage Overview */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-semibold tracking-tight text-ink-primary">
              Diagnostic Imaging Worklist
            </h1>
            <span className="rounded-full bg-slate-800/80 px-2.5 py-0.5 font-mono text-[11px] font-medium text-slate-300 border border-slate-700/60">
              {triageStats.total.toLocaleString()} Studies
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Reading-room PACS worklist · Filter, triage, and launch patient examinations
          </p>
        </div>

        {/* Clinical Triage Filter Badges */}
        <div className="flex flex-wrap items-center gap-2">
          {/* STAT Studies Filter Pill */}
          <button
            onClick={() =>
              setFilters((f) => ({
                ...f,
                priority: f.priority === "stat" ? "all" : "stat",
              }))
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold border transition-all shadow-sm",
              filters.priority === "stat"
                ? "bg-rose-500 text-white border-rose-600 shadow-rose-900/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            <span>STAT Emergent</span>
            <span className="rounded bg-black/30 px-1.5 py-0.2 font-mono text-[11px]">
              {triageStats.statCount}
            </span>
          </button>

          {/* In Review Filter Pill */}
          <button
            onClick={() =>
              setFilters((f) => ({
                ...f,
                status: f.status === "in-review" ? "all" : "in-review",
              }))
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-all shadow-sm",
              filters.status === "in-review"
                ? "bg-sky-500 text-white border-sky-600"
                : "bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500/20"
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>In Review</span>
            <span className="rounded bg-black/30 px-1.5 py-0.2 font-mono text-[11px]">
              {triageStats.inReviewCount}
            </span>
          </button>

          {/* AI Complete Filter Pill */}
          <button
            onClick={() =>
              setFilters((f) => ({
                ...f,
                status: f.status === "ai-complete" ? "all" : "ai-complete",
              }))
            }
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium border transition-all shadow-sm",
              filters.status === "ai-complete"
                ? "bg-purple-500 text-white border-purple-600"
                : "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Ready</span>
            <span className="rounded bg-black/30 px-1.5 py-0.2 font-mono text-[11px]">
              {triageStats.aiCompleteCount}
            </span>
          </button>
        </div>
      </div>

      {dataMode === "dataset" && <IndexStatusBanner />}

      {/* 2. Modality Quick Select Strip & Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          {/* Modality Tabs */}
          <div className="flex flex-wrap items-center gap-1">
            {MODALITY_SHORTCUTS.map((m) => (
              <button
                key={m.value}
                onClick={() => setFilters((f) => ({ ...f, modality: m.value }))}
                className={cn(
                  "rounded-md px-3 py-1 text-[12px] font-medium transition-all",
                  filters.modality === m.value
                    ? "bg-clinical text-white font-semibold shadow-sm"
                    : "text-ink-secondary hover:text-ink-primary hover:bg-panel-hover"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Clear Filters Reset */}
          {JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS) && (
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="h-3 w-3" /> Reset Filters
            </button>
          )}
        </div>

        {/* Detailed Search & Filters Row */}
        <StudyFilters
          filters={filters}
          setFilters={setFilters}
          view={view}
          setView={setView}
          resultCount={filtered.length}
          showDatasetFilter={dataMode !== "mock"}
        />
      </div>

      {/* 3. Worklist Table Display */}
      <div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-muted">
            <Loader2 className="h-7 w-7 animate-spin text-clinical mb-2" />
            <span className="text-[13px] font-medium">Loading clinical worklist...</span>
          </div>
        ) : loadError ? (
          <ErrorState title="Unable to load studies" description={loadError} />
        ) : allStudies.length === 0 && dataMode === "dataset" ? (
          <EmptyState
            icon={Activity}
            title="No indexed studies available."
            description="Run `npm run dataset:index` against your local dataset root, then refresh this page."
          />
        ) : allStudies.length === 0 && dataMode === "demo" ? (
          <EmptyState
            icon={Activity}
            title="The demo index could not be read."
            description="`public/demo-data/index.json` is missing or was built by an older version. Run `npm run demo:index`, then refresh this page."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No studies match your filters"
            description="Try adjusting or clearing your search and filter criteria to see more results."
            action={{ label: "Clear filters", onClick: () => setFilters(DEFAULT_FILTERS) }}
          />
        ) : view === "table" ? (
          <div className="flex flex-col gap-3">
            <StudyTable
              studies={paginated}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              editable
              onPriorityChange={onPriorityChange}
              onStatusChange={onStatusChange}
            />

            {filtered.length > pageSize && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={filtered.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginated.map((s) => (
                <StudyCard key={s.id} study={s} />
              ))}
            </div>
            {filtered.length > pageSize && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={filtered.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, currentPage * pageSize);

  const getPages = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2.5 px-3.5 rounded-lg border border-border bg-panel text-[12px] text-ink-secondary">
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-semibold text-ink-primary tabular-nums">{startItem}</span>–<span className="font-semibold text-ink-primary tabular-nums">{endItem}</span> of <span className="font-semibold text-ink-primary tabular-nums">{totalItems}</span> studies
        </span>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-ink-muted">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="rounded border border-border bg-panel-alt px-2 py-0.5 text-[11px] text-ink-primary outline-none focus:border-clinical"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          aria-label="First page"
          title="First page"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
          title="Previous page"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-1 px-1">
          {getPages().map((p, idx) =>
            p === "..." ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-ink-muted select-none">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={cn(
                  "flex h-7 min-w-[28px] px-1.5 items-center justify-center rounded border text-[11px] font-medium tabular-nums transition-colors",
                  currentPage === p
                    ? "border-clinical bg-clinical text-white font-semibold shadow-sm"
                    : "border-border bg-panel-alt hover:bg-panel-hover text-ink-secondary"
                )}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          aria-label="Next page"
          title="Next page"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Last page"
          title="Last page"
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
