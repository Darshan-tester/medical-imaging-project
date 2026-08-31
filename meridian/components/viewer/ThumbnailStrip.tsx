"use client";

import { useEffect, useRef } from "react";
import { Modality } from "@/lib/types";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { cn } from "@/lib/utils";

// Only ever mount this many thumbnails at once, centered on the current
// slice. A 220-slice CT series never renders more than WINDOW*2+1 DOM nodes
// / SVG filters — scrolling further re-centers the window instead of
// growing it, which is what keeps this responsive on very large studies.
const WINDOW = 20;

export function ThumbnailStrip({
  modality,
  thumbnailSeed,
  total,
  current,
  onChange,
  getImageUrl,
}: {
  modality: Modality;
  thumbnailSeed: number;
  total: number;
  current: number;
  onChange: (index: number) => void;
  /** Optional real image for a given slice index, if the study has uploaded files. */
  getImageUrl?: (index: number) => string | undefined;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [current]);

  if (total <= 1) return null;

  const start = Math.max(0, Math.min(current - WINDOW, total - (WINDOW * 2 + 1)));
  const end = Math.min(total, start + WINDOW * 2 + 1);
  const indices = Array.from({ length: end - start }, (_, i) => start + i);

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-border-strong bg-panel-alt px-2 py-1.5"
      role="listbox"
      aria-label="Slice thumbnails"
    >
      {start > 0 && <span className="shrink-0 px-1 font-mono text-[10px] text-ink-muted">···</span>}
      {indices.map((i) => (
        <button
          key={i}
          ref={i === current ? activeRef : undefined}
          role="option"
          aria-selected={i === current}
          aria-label={`Go to slice ${i + 1}`}
          onClick={() => onChange(i)}
          className={cn(
            "relative h-11 w-11 shrink-0 overflow-hidden rounded border transition-colors duration-100",
            i === current ? "border-clinical ring-1 ring-clinical" : "border-border-strong opacity-70 hover:opacity-100"
          )}
        >
          <ScanThumbnail seed={thumbnailSeed + i} modality={modality} imageUrl={getImageUrl?.(i)} className="h-full w-full" />
          <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 font-mono text-[8.5px] leading-tight text-white">{i + 1}</span>
        </button>
      ))}
      {end < total && <span className="shrink-0 px-1 font-mono text-[10px] text-ink-muted">···</span>}
    </div>
  );
}
