"use client";

import { useState, useMemo } from "react";
import {
  MapPin,
  Trash2,
  Ruler,
  Compass,
  Square,
  Circle,
  ArrowUpRight,
  Type,
  Pencil,
  Box,
  Eye,
  EyeOff,
  Crosshair,
  Plus,
  Edit3,
  Layers,
  Sparkles,
  Check,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  ViewerAnnotation,
  Annotation3D,
  ViewerMeasurement,
  SeriesInfo,
  FindingType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AnnotationPanelProps {
  studyId: string;
  annotations: ViewerAnnotation[];
  annotations3D?: Annotation3D[];
  series: SeriesInfo[];
  activeSeriesId: string;
  currentSlice: number;
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onJumpTo2D: (ann: ViewerAnnotation) => void;
  onJumpTo3D?: (ann: ViewerAnnotation | Annotation3D) => void;
  onStartNewAnnotation: () => void;
  onEditFinding?: (id: string) => void;
  activeMode?: "images" | "3d" | "4d" | "ai" | "report";
  onSelectMode?: (mode: "images" | "3d") => void;
}

export function AnnotationPanel({
  studyId,
  annotations,
  annotations3D = [],
  series,
  activeSeriesId,
  currentSlice,
  selectedId,
  onSelectAnnotation,
  onDeleteAnnotation,
  onToggleVisibility,
  onJumpTo2D,
  onJumpTo3D,
  onStartNewAnnotation,
  onEditFinding,
  activeMode = "images",
  onSelectMode,
}: AnnotationPanelProps) {
  const [filter, setFilter] = useState<"all" | "slice" | "2d" | "3d">("all");
  const [findingFilter, setFindingFilter] = useState<string>("all");

  const seriesLabel = (id: string) => series.find((s) => s.id === id)?.label ?? id;

  // Filter annotations
  const filteredAnnotations = useMemo(() => {
    let list = annotations;
    if (filter === "slice") {
      list = list.filter(
        (a) => a.seriesId === activeSeriesId && a.sliceIndex === currentSlice
      );
    }
    if (findingFilter !== "all") {
      list = list.filter(
        (a) => (a.findingType || "Other").toLowerCase() === findingFilter.toLowerCase()
      );
    }
    return list;
  }, [annotations, filter, findingFilter, activeSeriesId, currentSlice]);

  const totalCount = annotations.length + annotations3D.length;

  const getShapeIcon = (type: string) => {
    switch (type) {
      case "freehand":
      case "pen":
        return <Pencil className="h-3.5 w-3.5 text-rose-400" />;
      case "measure":
      case "distance":
      case "measurement":
      case "line":
        return <Ruler className="h-3.5 w-3.5 text-sky-400" />;
      case "polygon":
        return <Layers className="h-3.5 w-3.5 text-amber-400" />;
      case "angle":
        return <Compass className="h-3.5 w-3.5 text-amber-400" />;
      case "rectangle":
      case "rect":
        return <Square className="h-3.5 w-3.5 text-emerald-400" />;
      case "circle":
        return <Circle className="h-3.5 w-3.5 text-purple-400" />;
      case "arrow":
        return <ArrowUpRight className="h-3.5 w-3.5 text-orange-400" />;
      case "text":
        return <Type className="h-3.5 w-3.5 text-blue-400" />;
      default:
        return <MapPin className="h-3.5 w-3.5 text-cyan-400" />;
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0b0f19] text-slate-200 select-none">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#1e293b] px-3 py-2.5 bg-[#0f172a]/60">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-cyan-400" />
          <h3 className="text-[12.5px] font-bold tracking-wide text-white uppercase font-mono">
            Annotations
          </h3>
          <span className="rounded bg-cyan-950/80 border border-cyan-500/40 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-cyan-300">
            {totalCount}
          </span>
        </div>

        {/* View Switcher Shortcut */}
        {onSelectMode && (
          <div className="flex items-center gap-1 rounded border border-[#1e293b] bg-[#111827] p-0.5 text-[10px] font-mono">
            <button
              onClick={() => onSelectMode("images")}
              className={cn(
                "rounded px-1.5 py-0.5 transition-colors font-medium",
                activeMode === "images"
                  ? "bg-sky-600 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              2D
            </button>
            <button
              onClick={() => onSelectMode("3d")}
              className={cn(
                "rounded px-1.5 py-0.5 transition-colors font-medium",
                activeMode === "3d"
                  ? "bg-sky-600 text-white shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              3D
            </button>
          </div>
        )}
      </div>

      {/* Action Bar: New Annotation + Filters */}
      <div className="border-b border-[#1e293b] p-2 space-y-2 bg-[#090d16]">
        <button
          onClick={onStartNewAnnotation}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 px-3 py-1.5 text-[11.5px] font-semibold text-cyan-300 shadow-sm transition-all hover:border-cyan-400 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>+ New Annotation</span>
        </button>

        {/* Scope Filter Tabs */}
        <div className="flex items-center justify-between gap-1 text-[10.5px]">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                filter === "all"
                  ? "bg-[#1e293b] text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              All ({annotations.length})
            </button>
            <button
              onClick={() => setFilter("slice")}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                filter === "slice"
                  ? "bg-[#1e293b] text-white font-medium"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              Slice {currentSlice + 1}
            </button>
            {annotations3D.length > 0 && (
              <button
                onClick={() => setFilter("3d")}
                className={cn(
                  "rounded px-2 py-0.5 transition-colors",
                  filter === "3d"
                    ? "bg-[#1e293b] text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                3D ({annotations3D.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Annotation List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 divide-y divide-[#1e293b]/40">
        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 my-auto">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111827] border border-[#1e293b] text-cyan-400 mb-2.5">
              <Crosshair className="h-5 w-5" />
            </div>
            <p className="text-[12.5px] font-semibold text-white">No annotations yet</p>
            <p className="mt-1 text-[11px] text-slate-400 max-w-[210px] leading-relaxed">
              Select an abnormal region in the 2D viewer to create a linked annotation.
            </p>
            <button
              onClick={onStartNewAnnotation}
              className="mt-3.5 flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-[11px] font-medium text-white shadow transition-colors cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              <span>Create Annotation</span>
            </button>
          </div>
        ) : (
          <>
            {/* 3D-specific volume annotations section if selected */}
            {(filter === "all" || filter === "3d") && annotations3D.length > 0 && (
              <div className="pt-1 pb-1">
                <div className="px-1 py-0.5 text-[9.5px] font-mono uppercase tracking-wider text-sky-400 font-bold">
                  3D Volume Structures
                </div>
                <div className="space-y-1 mt-1">
                  {annotations3D.map((a3, idx) => (
                    <div
                      key={a3.id}
                      className={cn(
                        "group rounded-lg border p-2 transition-all cursor-pointer",
                        selectedId === a3.id
                          ? "border-cyan-400 bg-cyan-950/30 ring-1 ring-cyan-400/40"
                          : "border-[#1e293b] bg-[#111827]/70 hover:border-slate-600 hover:bg-[#111827]"
                      )}
                      onClick={() => {
                        onSelectAnnotation(a3.id);
                        onJumpTo3D?.(a3);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: a3.color || "#00F0FF" }}
                          />
                          <span className="text-[11.5px] font-semibold text-white truncate">
                            {a3.label || `3D Region #${idx + 1}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteAnnotation(a3.id);
                            }}
                            className="rounded p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span>Position: {a3.position.map((v) => v.toFixed(2)).join(", ")}</span>
                        {a3.sliceIndex !== undefined && (
                          <span className="font-mono text-cyan-300">Slice {a3.sliceIndex + 1}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2D Image Annotations */}
            {(filter === "all" || filter === "slice" || filter === "2d") &&
              filteredAnnotations.map((ann, idx) => {
                const isSelected = ann.id === selectedId;
                const isCurrent =
                  ann.seriesId === activeSeriesId && ann.sliceIndex === currentSlice;
                const findingName =
                  ann.finding || ann.label || ann.findingType || "Diagnostic ROI";

                return (
                  <div
                    key={ann.id}
                    className={cn(
                      "group rounded-lg border p-2 transition-all",
                      isSelected
                        ? "border-cyan-400 bg-cyan-950/30 ring-1 ring-cyan-400/40"
                        : isCurrent
                        ? "border-sky-500/50 bg-[#121c2e]/60"
                        : "border-[#1e293b] bg-[#0e1422] hover:border-slate-600 hover:bg-[#111828]"
                    )}
                  >
                    {/* Top Row: Type, Label & Actions */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div
                        className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
                        onClick={() => {
                          onSelectAnnotation(ann.id);
                          onJumpTo2D(ann);
                        }}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0 mt-0.5"
                          style={{ backgroundColor: ann.color }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-bold text-white truncate">
                              {findingName}
                            </span>
                            {ann.findingType && (
                              <span className="rounded bg-sky-950/80 border border-sky-500/30 px-1 py-0.2 font-mono text-[9px] text-sky-300 uppercase">
                                {ann.findingType}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mt-0.5">
                            <span className="truncate">{seriesLabel(ann.seriesId)}</span>
                            <span>·</span>
                            <span
                              className={cn(
                                "font-semibold",
                                isCurrent ? "text-cyan-300" : "text-slate-300"
                              )}
                            >
                              Slice {ann.sliceIndex + 1}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Quick Controls */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {onToggleVisibility && (
                          <button
                            onClick={() => onToggleVisibility(ann.id)}
                            className="rounded p-1 text-slate-400 hover:text-white"
                            title={ann.visible !== false ? "Hide annotation" : "Show annotation"}
                          >
                            {ann.visible !== false ? (
                              <Eye className="h-3 w-3" />
                            ) : (
                              <EyeOff className="h-3 w-3 text-slate-500" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteAnnotation(ann.id)}
                          className="rounded p-1 text-slate-400 hover:text-rose-400"
                          title="Delete annotation"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Measurement & Time Details */}
                    <div className="mt-2 flex items-center justify-between text-[10.5px] border-t border-[#1e293b]/60 pt-1.5">
                      <div className="flex items-center gap-1 font-mono text-cyan-300">
                        {getShapeIcon(ann.type)}
                        {ann.measureValue ? (
                          <span className="font-semibold">{ann.measureValue}</span>
                        ) : (
                          <span className="capitalize text-slate-400">{ann.type}</span>
                        )}
                      </div>

                      {/* "View in 2D" / Jump action */}
                      <div className="flex items-center gap-1">
                        {ann.createdAt && (
                          <span className="text-[9.5px] text-slate-500 font-mono mr-1">
                            {formatTime(ann.createdAt)}
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAnnotation(ann.id);
                            onJumpTo2D(ann);
                          }}
                          className="flex items-center gap-1 rounded bg-[#1e293b] hover:bg-cyan-600 hover:text-white px-2 py-0.5 text-[10px] font-semibold text-cyan-300 transition-colors cursor-pointer"
                          title="Center slice and display ROI"
                        >
                          <Crosshair className="h-2.5 w-2.5" />
                          <span>View in 2D</span>
                        </button>
                      </div>
                    </div>

                    {/* Note preview if present */}
                    {ann.radiologistNote && (
                      <div className="mt-1 text-[10px] italic text-slate-400 bg-[#080d16] rounded px-1.5 py-0.5 border border-[#1e293b]/40 truncate">
                        "{ann.radiologistNote}"
                      </div>
                    )}
                  </div>
                );
              })}
          </>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-[#1e293b] bg-[#090d16] px-3 py-2 text-[10px] text-slate-400 flex items-center justify-between font-mono">
        <span>Study: {studyId}</span>
        <span className="text-cyan-400">Linked 2D/3D Active</span>
      </div>
    </div>
  );
}
