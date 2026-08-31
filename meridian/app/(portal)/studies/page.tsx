"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { StudyTable, SortKey } from "@/components/studies/StudyTable";
import { StudyCard } from "@/components/studies/StudyCard";
import { StudyFilters, DEFAULT_FILTERS, StudyFilterState } from "@/components/studies/StudyFilters";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { fetchStudies, getDataMode } from "@/lib/data-source";
import { DATASET_SOURCE_LABEL } from "@/lib/dataset/types";
import { Study, StudyPriority, StudyStatus } from "@/lib/types";

export default function StudiesPage() {
  const dataMode = getDataMode();
  const [allStudies, setAllStudies] = useState<Study[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StudyFilterState>(DEFAULT_FILTERS);
  const [view, setView] = useState<"table" | "grid">("table");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

      <div className="mt-6 rounded-xl border border-border bg-panel p-4">
        <StudyFilters filters={filters} setFilters={setFilters} view={view} setView={setView} resultCount={filtered.length} showDatasetFilter={dataMode === "dataset"} />
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
            description="Run `npm run dataset:index` against your local ScanLab dataset, then refresh this page."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No studies match your filters"
            description="Try adjusting or clearing your search and filter criteria to see more results."
            action={{ label: "Clear filters", onClick: () => setFilters(DEFAULT_FILTERS) }}
          />
        ) : view === "table" ? (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <StudyTable
              studies={filtered}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              editable
              onPriorityChange={onPriorityChange}
              onStatusChange={onStatusChange}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((s) => (
              <StudyCard key={s.id} study={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
