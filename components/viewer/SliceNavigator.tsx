"use client";

import { ChevronLeft, ChevronRight, Play, Pause, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

/**
 * Cine rate multipliers, applied to `FRAME_MS`.
 *
 * A radiologist scrubbing a 512-slice MPR stack wants to run it faster than the
 * default; someone reading a short thick-slice series wants it slower. The set is
 * deliberately small and symmetric around 1× so the control stays a glance-sized
 * segmented button rather than a dropdown.
 */
const SPEEDS = [0.5, 1, 1.5, 2] as const;

/** Base cine interval at 1×: ~11 fps, the rate this viewer has always used. */
const FRAME_MS = 90;

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
  ready?: boolean | (() => boolean);
}) {
  const raf = useRef<number | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  /*
   * Read through a ref inside the loop, the same way `current` and `ready` are:
   * changing speed mid-playback then takes effect on the next frame instead of
   * tearing down and restarting the requestAnimationFrame loop.
   */
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing || total <= 1) return;
    let last = performance.now();
    const tick = (t: number) => {
      // Advance on whichever is later: the frame interval, or the moment the
      // current frame actually finished decoding. Speed scales the interval only
      // — the readiness gate still applies, so 2× on a series whose planes are
      // resliced on demand runs as fast as the pixels arrive and no faster.
      const isReady = typeof readyRef.current === "function" ? readyRef.current() : (readyRef.current ?? true);
      if (t - last > FRAME_MS / speedRef.current && isReady) {
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

      {/*
       * Playback speed, next to the transport control it modifies rather than off
       * in the toolbar. Hidden below `sm` for the same reason the first/last-slice
       * jumps are: on a phone the slider needs the width more than the multipliers
       * do, and cine is still fully usable at 1×.
       */}
      <Tooltip label="Cine playback speed">
        <div
          className="hidden shrink-0 items-center gap-px rounded-md border border-border-strong bg-panel p-px sm:flex"
          role="group"
          aria-label="Cine playback speed"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              aria-pressed={s === speed}
              aria-label={`${s}× playback speed`}
              className={cn(
                "rounded-[5px] px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-clinical",
                s === speed
                  ? "bg-clinical/15 text-clinical"
                  : "text-ink-muted hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary"
              )}
            >
              {s}x
            </button>
          ))}
        </div>
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
