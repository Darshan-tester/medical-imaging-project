"use client";

import { memo, useState, useMemo } from "react";
import {
  Layers,
  ChevronDown,
  ChevronRight,
  Info,
  Search,
  Check,
  Compass,
  FileSpreadsheet,
  AlertCircle,
  FolderOpen,
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

export type SequenceCategory = "ALL" | "FLAIR" | "T1" | "T2" | "DWI" | "ADC" | "SWI" | "MRA" | "OTHER";

interface ParsedSeriesInfo {
  series: SeriesInfo;
  category: SequenceCategory;
  displayPlane: string;
  isMpr: boolean;
  sliceThickness?: string;
}

function parseSeriesMetadata(s: SeriesInfo): ParsedSeriesInfo {
  const lbl = s.label.toLowerCase();

  let category: SequenceCategory = "OTHER";
  if (lbl.includes("flair")) category = "FLAIR";
  else if (/\bt1w?\b/.test(lbl)) category = "T1";
  else if (/\bt2w?\b/.test(lbl)) category = "T2";
  else if (lbl.includes("dwi") || lbl.includes("diff")) category = "DWI";
  else if (lbl.includes("adc")) category = "ADC";
  else if (lbl.includes("swi") || lbl.includes("suscept")) category = "SWI";
  else if (lbl.includes("mra") || lbl.includes("angio")) category = "MRA";
  else if (lbl.includes("thorax") || lbl.includes("chest") || lbl.includes("ct")) category = "OTHER";

  // Check if MPR
  const isMpr = lbl.includes("mpr") || s.orientation === "Coronal" || s.orientation === "Sagittal";

  // Extract slice thickness string if present in label e.g. "6.6 mm" or "0.80"
  const thicknessMatch = s.label.match(/(\d+(?:\.\d+)?)\s*mm/i);
  let sliceThickness = thicknessMatch ? `${thicknessMatch[1]} mm` : undefined;
  if (!sliceThickness && s.pixelSpacing) {
    sliceThickness = `${s.pixelSpacing[0].toFixed(1)} mm`;
  }

  // Display plane
  let displayPlane: string = s.orientation;
  if (isMpr && (s.orientation === "Coronal" || s.orientation === "Sagittal")) {
    displayPlane = `${s.orientation} MPR`;
  }

  return {
    series: s,
    category,
    displayPlane,
    isMpr,
    sliceThickness,
  };
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
  const [selectedCategory, setSelectedCategory] = useState<SequenceCategory>("ALL");

  const parsedList = useMemo(() => {
    return series.map(parseSeriesMetadata);
  }, [series]);

  // Detected sequence categories in this study
  const availableCategories = useMemo(() => {
    const cats = new Set<SequenceCategory>();
    for (const item of parsedList) {
      if (item.category !== "OTHER") cats.add(item.category);
    }
    return Array.from(cats);
  }, [parsedList]);

  // Check if study is MRI and whether DWI / ADC are present
  const isMri = study.modality === "MRI";
  const hasDwi = parsedList.some((p) => p.category === "DWI");
  const hasAdc = parsedList.some((p) => p.category === "ADC");

  // Filtered series
  const filteredParsed = useMemo(() => {
    return parsedList.filter((item) => {
      if (selectedCategory !== "ALL" && item.category !== selectedCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.series.label.toLowerCase().includes(q) ||
        item.series.orientation.toLowerCase().includes(q) ||
        item.series.id.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [parsedList, selectedCategory, searchQuery]);

  // Hierarchical grouping
  const groupedSeries = useMemo(() => {
    const groups: { title: string; category: SequenceCategory; items: ParsedSeriesInfo[] }[] = [];
    const map = new Map<string, ParsedSeriesInfo[]>();

    for (const item of filteredParsed) {
      const key = item.category === "OTHER" ? (study.modality === "CT" ? "VOLUMETRIC ACQUISITIONS" : "OTHER SEQUENCES") : item.category;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }

    // Ordered sequence groups
    const order = ["FLAIR", "T1", "T2", "DWI", "ADC", "SWI", "MRA", "VOLUMETRIC ACQUISITIONS", "OTHER SEQUENCES"];
    for (const cat of order) {
      if (map.has(cat)) {
        groups.push({
          title: cat,
          category: (cat.startsWith("VOLUMETRIC") || cat.startsWith("OTHER") ? "OTHER" : cat) as SequenceCategory,
          items: map.get(cat)!,
        });
      }
    }

    // Any remaining
    for (const [key, items] of map.entries()) {
      if (!order.includes(key)) {
        groups.push({ title: key, category: "OTHER", items });
      }
    }

    return groups;
  }, [filteredParsed, study.modality]);

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
      {/* Patient & Study Header */}
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
              <span className="text-sky-300 font-sans font-medium uppercase text-[10px] tracking-wide">
                {study.bodyRegion}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Quick Sequence Filter Tabs */}
      <div className="shrink-0 p-2.5 border-b border-[#1e293b] bg-[#0d121c] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-200">
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span>Sequences ({series.length})</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            {filteredParsed.length} visible
          </span>
        </div>

        {/* Sequence Filter Buttons */}
        {availableCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            <button
              onClick={() => setSelectedCategory("ALL")}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors",
                selectedCategory === "ALL"
                  ? "bg-sky-600 text-white"
                  : "bg-[#131d2e] text-slate-400 hover:text-slate-200 hover:bg-[#1a2940]"
              )}
            >
              ALL
            </button>
            {availableCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors",
                  selectedCategory === cat
                    ? "bg-sky-600 text-white"
                    : "bg-[#131d2e] text-slate-400 hover:text-slate-200 hover:bg-[#1a2940]"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* DWI / ADC Availability Status for Brain Studies */}
        {isMri && (!hasDwi || !hasAdc) && (
          <div className="flex items-center gap-1.5 rounded bg-slate-900/80 border border-slate-800 px-2 py-1 text-[10px] text-slate-400">
            <Info className="h-3 w-3 text-slate-500 shrink-0" />
            <span>
              {!hasDwi && !hasAdc
                ? "DWI & ADC sequences unavailable"
                : !hasDwi
                ? "DWI unavailable"
                : "ADC unavailable"}
            </span>
          </div>
        )}

        {/* Search input if multiple series */}
        {series.length > 4 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search series or plane..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border border-[#1e293b] bg-[#111827] pl-8 pr-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/70"
            />
          </div>
        )}
      </div>

      {/* Hierarchical Grouped Series List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {groupedSeries.length === 0 ? (
          <div className="p-4 text-center text-[11.5px] text-slate-500">
            No matching series found.
          </div>
        ) : (
          groupedSeries.map((group) => (
            <div key={group.title} className="space-y-1">
              {/* Group Section Header */}
              <div className="flex items-center justify-between px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                <span className="flex items-center gap-1.5">
                  <FolderOpen className="h-3 w-3 text-sky-400/80" />
                  <span>{group.title}</span>
                </span>
                <span className="text-slate-500">{group.items.length}</span>
              </div>

              {/* Group Series Items */}
              <div className="space-y-1 pl-1">
                {group.items.map(({ series: s, displayPlane, isMpr, sliceThickness }) => {
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
                      <div className="relative h-11 w-11 shrink-0 rounded overflow-hidden bg-black border border-[#1e293b] flex items-center justify-center">
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
                        <span className="absolute bottom-0 right-0 rounded-tl bg-black/90 px-1 py-0.2 font-mono text-[8px] text-slate-200">
                          {s.sliceCount}
                        </span>
                      </div>

                      {/* Series Clinical Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p
                            className={cn(
                              "truncate text-[11.5px] font-semibold leading-tight",
                              isActive ? "text-sky-300" : "text-slate-200 group-hover:text-white"
                            )}
                          >
                            {displayPlane}
                          </p>
                          {isActive && <Check className="h-3 w-3 text-sky-400 shrink-0 ml-1" />}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.2 border text-[9px] font-mono font-bold uppercase",
                              orientationColors[s.orientation] || "bg-[#1e293b] text-slate-400 border-slate-700"
                            )}
                          >
                            {s.orientation || "AX"}
                          </span>
                          <span className="font-mono text-slate-400">
                            {s.sliceCount > 1 ? `${s.sliceCount} sl` : "1 frame"}
                          </span>
                          {sliceThickness && (
                            <span className="font-mono text-slate-400">
                              · {sliceThickness}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Expandable Technical DICOM Details Section */}
      <div className="shrink-0 border-t border-[#1e293b] bg-[#0d121c]">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full flex items-center justify-between px-3.5 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-[#111827] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3 text-slate-500" />
            <span>Technical Sequence Metadata</span>
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
              <span className="text-slate-500">Series:</span>
              <span className="truncate max-w-[140px] text-slate-300" title={activeSeries.label}>
                {activeSeries.label}
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
                {activeSeries.volumeAvailable ? "Available" : "Planar only"}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});
