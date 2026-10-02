"use client";

import { memo, useEffect, useRef } from "react";
import { Modality } from "@/lib/types";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { PRIORITY } from "@/lib/viewer/request-queue";
import { cn } from "@/lib/utils";

// Only ever mount this many thumbnails on each side of the current slice.
// This was 20 (41 tiles). Every tile is a distinct server render, so each slice
// change re-requested up to 41 images — on a reslice-on-demand CT series that
// is 41 volume reads competing with the one render the user is actually waiting
// for, which is the bulk of the "images are slow" complaint. 6 (13 tiles) is
// still more context than the strip can show at once on a normal viewport.
const WINDOW = 6;

/** Longest edge served for a 44 px tile. 96 covers 2x DPI without paying for a full-resolution reslice. */
const THUMB_EDGE = 96;

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
        <ThumbnailTile
          key={i}
          index={i}
          isCurrent={i === current}
          modality={modality}
          seed={thumbnailSeed + i}
          imageUrl={thumbEdge(getImageUrl?.(i))}
          distance={Math.abs(i - current)}
          onChange={onChange}
          activeRef={i === current ? activeRef : undefined}
        />
      ))}
      {end < total && <span className="shrink-0 px-1 font-mono text-[10px] text-ink-muted">···</span>}
    </div>
  );
}

const ThumbnailTile = memo(function ThumbnailTile({
  index,
  isCurrent,
  modality,
  seed,
  imageUrl,
  distance,
  onChange,
  activeRef,
}: {
  index: number;
  isCurrent: boolean;
  modality: Modality;
  seed: number;
  imageUrl?: string;
  distance: number;
  onChange: (index: number) => void;
  activeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={activeRef}
      role="option"
      aria-selected={isCurrent}
      aria-label={`Go to slice ${index + 1}`}
      onClick={() => onChange(index)}
      className={cn(
        "relative h-11 w-11 shrink-0 overflow-hidden rounded border transition-colors duration-100",
        isCurrent ? "border-clinical ring-1 ring-clinical" : "border-border-strong opacity-70 hover:opacity-100"
      )}
    >
      <ScanThumbnail
        seed={seed}
        modality={modality}
        imageUrl={imageUrl}
        loading="lazy"
        priority={PRIORITY.thumbnail + distance}
        className="h-full w-full"
      />
      <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 font-mono text-[8.5px] leading-tight text-white">{index + 1}</span>
    </button>
  );
});

/**
 * Asks the image route for a tile-sized render (`?w=`). The route ignores the
 * hint for source JPEGs, so this never degrades a raster study — it only stops a
 * 44 px box from downloading a full-resolution DICOM reslice. Left untouched if
 * the caller already pinned a width.
 */
function thumbEdge(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/[?&]w=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${THUMB_EDGE}`;
}
