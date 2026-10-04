"use client";

import { memo, useState, useMemo } from "react";
import {
  Layers,
  ChevronDown,
  ChevronRight,
  Info,
  Calendar,
  Search,
  Check,
  Box,
  Compass,
  FileSpreadsheet,
} from "lucide-react";
import { SeriesInfo, Study } from "@/lib/types";
import { ModalityBadge } from "@/components/ui/Badge";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { cn } from "@/lib/utils";

interface ClinicalSeriesSidebarProps {
  study: Study;
  series: SeriesInfo[];
  activeSeriesId: string;
  onSelectSeries: (seriesId: string) => void;
  className?: string;
}

export const ClinicalSeriesSidebar = memo(function ClinicalSeriesSidebar({
  study,
  series,
  activeSeriesId,
  onSelectSeries,
  className,
}: ClinicalSeriesSidebarProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSeries = useMemo(() => {
    if (!searchQuery.trim()) return series;
    const q = searchQuery.toLowerCase();
    return series.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.orientation.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    );
  }, [series, searchQuery]);

  const activeSeries = series.find((s) => s.id === activeSeriesId) ?? series[0];

  const orientationColors: Record<string, string> = {
    Axial: "bg-sky-950/80 text-sky-400 border-sky-800/60",
    Coronal: "bg-emerald-950/80 text-emerald-400 border-emerald-800/60",
    Sagittal: "bg-amber-950/80 text-amber-400 border-amber-800/60",
    "3D": "bg-purple-950/80 text-purple-400 border-purple-800/60",
  };

  return (
    <aside
      className={cn(
        "flex flex-col h-full border-r border-[#1e293b] bg-[#0b0f19] text-slate-200 select-none",
        className
      )}
    >
      {/* Patient & Study Summary Header */}
      <div className="shrink-0 p-3.5 border-b border-[#1e293b] bg-[#0f172a]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            SERIES BROWSER
          </span>
          <ModalityBadge modality={study.modality} />
        </div>

        <h2 className="text-[13.5px] font-bold text-white truncate">
          {study.patientAlias}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 font-mono">
          <span>{study.studyId}</span>
          <span>·</span>
          <span>
            {[study.age !== undefined ? `${study.age}y` : undefined, study.sex].filter(Boolean).join(" ")}
          </span>
          {study.bodyRegion && (
            <>
              <span>·</span>
              <span className="text-slate-300 font-sans font-medium">{study.bodyRegion}</span>
            </>
          )}
        </div>
      </div>

      {/* Series Filter & Count Bar */}
      <div className="shrink-0 p-2.5 border-b border-[#1e293b] bg-[#0d121c] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-200">
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span>Available Series ({series.length})</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Select to review</span>
        </div>

        {series.length > 3 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter series..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-[#1e293b] bg-[#111827] pl-8 pr-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/70"
            />
          </div>
        )}
      </div>

      {/* Series List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSeries.map((s) => {
          const isActive = s.id === activeSeriesId;
          const previewUrl =
            s.images && s.images.length > 0
              ? s.images[Math.floor(s.images.length / 2)]?.imageUrl ?? s.images[0]?.imageUrl
              : study.imageUrls?.[0];

          return (
            <button
              key={s.id}
              onClick={() => onSelectSeries(s.id)}
              className={cn(
                "group relative w-full flex items-start gap-2.5 rounded-lg p-2 text-left transition-all",
                isActive
                  ? "border border-sky-500/80 bg-[#13233d] shadow-sm shadow-sky-950"
                  : "border border-transparent hover:border-[#1e293b] hover:bg-[#111827]"
              )}
            >
              {/* Active Indicator Bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[2.5px] rounded-r bg-sky-400" />
              )}

              {/* Series Thumbnail / Preview */}
              <div className="relative h-12 w-12 shrink-0 rounded overflow-hidden bg-black border border-[#1e293b] flex items-center justify-center">
                {previewUrl ? (
                  <ScanThumbnail
                    imageUrl={previewUrl}
                    modality={study.modality}
                    seed={study.thumbnailSeed}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Layers className="h-4 w-4 text-slate-500" />
                )}
                <span className="absolute bottom-0 right-0 rounded-tl bg-black/90 px-1 py-0.2 font-mono text-[8.5px] text-slate-200">
                  {s.sliceCount}
                </span>
              </div>

              {/* Series Clinical Details */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p
                    className={cn(
                      "truncate text-[12px] font-semibold leading-tight",
                      isActive ? "text-sky-300" : "text-slate-200 group-hover:text-white"
                    )}
                  >
                    {s.label}
                  </p>
                  {isActive && <Check className="h-3 w-3 text-sky-400 shrink-0 ml-1" />}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 border text-[9.5px] font-mono font-bold uppercase",
                      orientationColors[s.orientation] || "bg-[#1e293b] text-slate-400 border-slate-700"
                    )}
                  >
                    {s.orientation || "AX"}
                  </span>
                  <span className="font-mono text-slate-400">
                    {s.sliceCount > 1 ? `${s.sliceCount} sl` : "1 frame"}
                  </span>
                  {s.pixelSpacing && (
                    <span className="font-mono text-slate-500">
                      · {s.pixelSpacing[0]?.toFixed(1)}mm
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expandable Advanced Metadata Section */}
      <div className="shrink-0 border-t border-[#1e293b] bg-[#0d121c]">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full flex items-center justify-between px-3.5 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-[#111827] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3 text-slate-500" />
            <span>Technical DICOM Details</span>
          </div>
          {detailsOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>

        {detailsOpen && activeSeries && (
          <div className="px-3.5 pb-3 text-[10.5px] font-mono text-slate-400 space-y-1.5 bg-[#090d16] border-t border-[#1e293b]">
            <div className="pt-2 flex justify-between">
              <span className="text-slate-500">Series UID:</span>
              <span className="truncate max-w-[140px] text-slate-300" title={activeSeries.id}>
                {activeSeries.id}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Plane:</span>
              <span className="text-slate-300">{activeSeries.orientation}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Slice Count:</span>
              <span className="text-slate-300">{activeSeries.sliceCount}</span>
            </div>
            {activeSeries.pixelSpacing && (
              <div className="flex justify-between">
                <span className="text-slate-500">Pixel Spacing:</span>
                <span className="text-slate-300">
                  {activeSeries.pixelSpacing[0]?.toFixed(2)} × {activeSeries.pixelSpacing[1]?.toFixed(2)} mm
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">3D Volumetric:</span>
              <span className="text-slate-300">
                {activeSeries.volumeAvailable ? "Yes" : "No"}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});
