"use client";

import { MapPin, Trash2, Ruler, Compass, Square, Circle, ArrowUpRight, Type, Pencil, Box } from "lucide-react";
import { Marker, SeriesInfo, ViewerAnnotation, ViewerMeasurement, Annotation3D } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

export function MarkersPanel({
  markers,
  series,
  activeSeriesId,
  currentSlice,
  onJump,
  onDelete,
  annotations = [],
  measurements = [],
  annotations3D = [],
  onDeleteAnnotation,
  onJumpToAnnotation,
}: {
  markers: Marker[];
  series: SeriesInfo[];
  activeSeriesId: string;
  currentSlice: number;
  onJump: (marker: Marker) => void;
  onDelete: (id: string) => void;
  annotations?: ViewerAnnotation[];
  measurements?: ViewerMeasurement[];
  annotations3D?: Annotation3D[];
  onDeleteAnnotation?: (id: string) => void;
  onJumpToAnnotation?: (ann: ViewerAnnotation) => void;
}) {
  const seriesLabel = (id: string) => series.find((s) => s.id === id)?.label ?? id;

  const totalCount = markers.length + annotations.length + measurements.length + annotations3D.length;

  const getShapeIcon = (type: string) => {
    switch (type) {
      case "freehand":
      case "pen":
        return <Pencil className="h-3.5 w-3.5 text-rose-400" />;
      case "measure":
      case "distance":
      case "line":
        return <Ruler className="h-3.5 w-3.5 text-sky-400" />;
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
        return <MapPin className="h-3.5 w-3.5 text-clinical" />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-clinical" />
          <h3 className="text-[13px] font-semibold text-ink-primary">Annotations & Measurements</h3>
        </div>
        <span className="rounded-md bg-clinical/12 px-1.5 py-0.5 font-mono text-[11px] font-medium text-clinical">
          {totalCount}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {totalCount === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No annotations yet"
            description="Use toolbar tools to measure distances, angles, draw ROIs, or drop markers."
          />
        ) : (
          <>
            {/* 3D Annotations Section */}
            {annotations3D.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">3D Volume Markers</div>
                {annotations3D.map((a3) => (
                  <div
                    key={a3.id}
                    className="group flex items-center justify-between rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 mb-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Box className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      <span className="truncate text-xs font-medium text-ink-primary">{a3.label || "3D Marker"}</span>
                    </div>
                    {onDeleteAnnotation && (
                      <button
                        onClick={() => onDeleteAnnotation(a3.id)}
                        className="rounded p-1 text-ink-muted hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Geometric / Drawing Annotations */}
            {annotations.map((ann) => {
              const isCurrent = ann.seriesId === activeSeriesId && ann.sliceIndex === currentSlice;
              return (
                <div
                  key={ann.id}
                  className={cn(
                    "group flex items-center justify-between rounded-lg border px-2.5 py-1.5 transition-colors",
                    isCurrent ? "border-clinical bg-clinical-dim" : "border-border hover:border-border-strong hover:bg-panel-hover"
                  )}
                >
                  <button
                    onClick={() => onJumpToAnnotation?.(ann)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {getShapeIcon(ann.type)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-[11.5px] font-medium text-ink-primary">
                        <span className="capitalize">{ann.type}</span>
                        {ann.measureValue && (
                          <span className="font-mono text-clinical font-semibold">({ann.measureValue})</span>
                        )}
                        {ann.text && <span className="text-ink-secondary truncate">"{ann.text}"</span>}
                      </div>
                      <div className="text-[10px] text-ink-muted">
                        {seriesLabel(ann.seriesId)} · Slice {ann.sliceIndex + 1}
                      </div>
                    </div>
                  </button>
                  {onDeleteAnnotation && (
                    <button
                      onClick={() => onDeleteAnnotation(ann.id)}
                      className="shrink-0 rounded p-1 text-ink-muted hover:text-critical opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete annotation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Point Markers */}
            {markers.map((m, i) => {
              const isCurrent = m.seriesId === activeSeriesId && m.sliceIndex === currentSlice;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                    isCurrent ? "border-clinical bg-clinical-dim" : "border-border hover:border-border-strong hover:bg-panel-hover"
                  )}
                >
                  <button onClick={() => onJump(m)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                    <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-clinical text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink-primary">
                        {m.note || `Point Marker ${i + 1}`}
                      </span>
                      <span className="block text-[10.5px] text-ink-muted">
                        {seriesLabel(m.seriesId)} · Slice {m.sliceIndex + 1}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(m.id)}
                    aria-label="Delete marker"
                    className="shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-critical group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
