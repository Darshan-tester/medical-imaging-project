"use client";

import { MapPin, Trash2 } from "lucide-react";
import { Marker, SeriesInfo } from "@/lib/types";
import { EmptyState } from "@/components/ui/EmptyState";

export function MarkersPanel({
  markers,
  series,
  activeSeriesId,
  currentSlice,
  onJump,
  onDelete,
}: {
  markers: Marker[];
  series: SeriesInfo[];
  activeSeriesId: string;
  currentSlice: number;
  onJump: (marker: Marker) => void;
  onDelete: (id: string) => void;
}) {
  const seriesLabel = (id: string) => series.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-clinical" />
          <h3 className="text-[13px] font-semibold text-ink-primary">Markers</h3>
        </div>
        <span className="rounded-md bg-clinical/12 px-1.5 py-0.5 font-mono text-[11px] font-medium text-clinical">{markers.length}</span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {markers.length === 0 ? (
          <EmptyState icon={MapPin} title="No markers yet" description="Select the marker tool and click on the image to drop one." />
        ) : (
          markers.map((m, i) => {
            const isCurrent = m.seriesId === activeSeriesId && m.sliceIndex === currentSlice;
            return (
              <div
                key={m.id}
                className={`group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors duration-150 ${
                  isCurrent ? "border-ai/50 bg-ai-dim" : "border-border hover:border-border-strong hover:bg-panel-hover"
                }`}
              >
                <button onClick={() => onJump(m)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ai-strong text-[10px] font-semibold text-canvas">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-ink-primary">{m.note || "Unlabeled marker"}</span>
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
          })
        )}
      </div>
    </div>
  );
}
