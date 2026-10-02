"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";
import { StudyTable, SortKey } from "@/components/studies/StudyTable";
import { StudyCard } from "@/components/studies/StudyCard";
import { IndexStatusBanner } from "@/components/studies/IndexStatusBanner";
import { StudyFilters, DEFAULT_FILTERS, StudyFilterState } from "@/components/studies/StudyFilters";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { fetchStudies, getDataMode } from "@/lib/data-source";
import { DATASET_SOURCE_LABEL } from "@/lib/dataset/types";
import { Study, StudyPriority, StudyStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 md:py-8">
      <div>
        <h1 className="text-page-title text-ink-primary">Studies</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-secondary">Search, triage, and manage imaging studies across your workspace.</p>
      </div>

      {dataMode === "dataset" && <IndexStatusBanner />}

      <div className="mt-6 rounded-xl border border-border bg-panel p-4">
        {/*
          The dataset filter selects between real corpora (Perle CT, MR-RATE, PET,
          ROCOv2), so it is meaningful in demo mode too — the committed studies
          span four of them. Only `mock` has a single invented source, where the
          control would offer one choice that filters nothing.
        */}
        <StudyFilters filters={filters} setFilters={setFilters} view={view} setView={setView} resultCount={filtered.length} showDatasetFilter={dataMode !== "mock"} />
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
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
          /*
           * Demo mode has one failure mode and it is not "no data": the studies
           * are committed under `public/demo-data`, so an empty list means
           * `public/demo-data/index.json` is missing or was written by a
           * different index version. Naming the file is the fix.
           */
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
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-xl border border-border bg-panel">
              <StudyTable
                studies={paginated}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                editable
                onPriorityChange={onPriorityChange}
                onStatusChange={onStatusChange}
              />
            </div>
            {filtered.length > 25 && (
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
            {filtered.length > 25 && (
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
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-3 rounded-xl border border-border bg-panel text-[12px] text-ink-secondary">
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-medium text-ink-primary tabular-nums">{startItem}</span>–<span className="font-medium text-ink-primary tabular-nums">{endItem}</span> of <span className="font-medium text-ink-primary tabular-nums">{totalItems}</span> studies
        </span>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-ink-muted">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="rounded-md border border-border bg-panel-alt px-2 py-1 text-[11px] text-ink-primary outline-none focus:border-clinical/60"
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
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          aria-label="Previous page"
          title="Previous page"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
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
                  "flex h-7 min-w-[28px] px-1.5 items-center justify-center rounded-md border text-[11px] font-medium tabular-nums transition-colors",
                  currentPage === p
                    ? "border-clinical bg-clinical text-white font-semibold"
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
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          aria-label="Last page"
          title="Last page"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel-alt hover:bg-panel-hover disabled:opacity-30 disabled:pointer-events-none transition-colors text-ink-secondary"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
