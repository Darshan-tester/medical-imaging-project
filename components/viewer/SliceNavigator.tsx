"use client";

import { ChevronLeft, ChevronRight, Play, Pause, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export function SliceNavigator({
  current,
  total,
  onChange,
  orientation,
  playing,
  onTogglePlay,
  ready = true,
}: {
  current: number;
  total: number;
  /** Manual step — never wraps. Clamped to [0, total-1] by the caller/here. */
  onChange: (n: number) => void;
  orientation: string;
  /** Cine playback state, lifted so it can also be toggled via the Space key at the page level. */
  playing: boolean;
  onTogglePlay: () => void;
  /**
   * False while the current frame's pixels are still in flight. Cine waits for
   * it instead of advancing on a fixed 90 ms timer: a reconstructed CT plane is
   * resliced on demand, and a timer that outruns the server just queues frames
   * that arrive after the UI has moved past them, which presents as a stall.
   * Defaults true so callers that render pre-loaded rasters behave as before.
   */
  ready?: boolean;
}) {
  const raf = useRef<number | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (!playing || total <= 1) return;
    let last = performance.now();
    const tick = (t: number) => {
      // Advance on whichever is later: the frame interval, or the moment the
      // current frame actually finished decoding.
      if (t - last > 90 && readyRef.current) {
        // Cine playback loops — this is the one place wraparound is intentional.
        onChange((currentRef.current + 1) % total);
        last = t;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  if (total <= 1) return null;

  const atStart = current <= 0;
  const atEnd = current >= total - 1;

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border-strong bg-panel-alt px-3 py-2"
      role="group"
      aria-label="Slice navigation"
    >
      <Tooltip label={playing ? "Pause cine (Space)" : "Play cine (Space)"}>
        <button
          onClick={onTogglePlay}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-clinical"
          aria-label={playing ? "Pause cine playback" : "Play cine playback"}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </Tooltip>

      <div className="mx-0.5 h-5 w-px shrink-0 bg-border-strong" />

      <Tooltip label="First slice">
        <button
          onClick={() => onChange(0)}
          disabled={atStart}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30 sm:flex"
          aria-label="Jump to first slice"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      <Tooltip label="Previous slice (←)">
        <button
          onClick={() => onChange(Math.max(0, current - 1))}
          disabled={atStart}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30"
          aria-label="Previous slice"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </Tooltip>

      <input
        type="range"
        min={0}
        max={total - 1}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn("h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.1)] accent-clinical")}
        aria-label="Slice slider"
        aria-valuetext={`Slice ${current + 1} of ${total}`}
      />

      <Tooltip label="Next slice (→)">
        <button
          onClick={() => onChange(Math.min(total - 1, current + 1))}
          disabled={atEnd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next slice"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip label="Last slice">
        <button
          onClick={() => onChange(total - 1)}
          disabled={atEnd}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30 sm:flex"
          aria-label="Jump to last slice"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      <span className="w-24 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink-secondary" aria-hidden>
        {orientation} · {current + 1}/{total}
      </span>
    </div>
  );
}
