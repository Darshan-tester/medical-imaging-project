"use client";

import { memo } from "react";
import { Layers } from "lucide-react";
import { SeriesInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export const SeriesNavigator = memo(function SeriesNavigator({
  series,
  activeSeriesId,
  onSelect,
}: {
  series: SeriesInfo[];
  activeSeriesId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <Layers className="h-3.5 w-3.5 text-clinical" />
        <h3 className="text-[13px] font-semibold text-ink-primary">Series</h3>
      </div>
      <div className="space-y-1.5 p-3">
        {series.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              "w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
              s.id === activeSeriesId ? "border-clinical/50 bg-clinical-dim" : "border-border hover:border-border-strong hover:bg-panel-hover"
            )}
          >
            <p className={cn("text-[12.5px] font-medium", s.id === activeSeriesId ? "text-clinical-strong" : "text-ink-primary")}>{s.label}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {s.sliceCount > 1 ? `${s.sliceCount} slices` : "Single image"} · {s.orientation}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
});
