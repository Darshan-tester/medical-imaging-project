"use client";

import { ChevronLeft, ChevronRight, Play, Pause, ChevronsLeft, ChevronsRight, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import type { PlaybackState } from "@/lib/viewer/playback-buffer";

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
  playbackState = "READY",
  bufferedCount,
  totalTarget,
  progressPercent,
  isBufferReady = true,
  failedFrames = [],
  onRetryBuffer,
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
   * it instead of advancing on a fixed 90 ms timer.
   */
  ready?: boolean | (() => boolean);
  /** Explicit playback pipeline state: INITIALIZING, LOADING, DECODING, READY, PLAYING, PAUSED, ERROR */
  playbackState?: PlaybackState;
  bufferedCount?: number;
  totalTarget?: number;
  progressPercent?: number;
  isBufferReady?: boolean;
  failedFrames?: number[];
  onRetryBuffer?: () => void;
}) {
  const raf = useRef<number | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const bufferReadyRef = useRef(isBufferReady);
  bufferReadyRef.current = isBufferReady;
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing || total <= 1) return;
    let last = performance.now();
    const tick = (t: number) => {
      const isReady = typeof readyRef.current === "function" ? readyRef.current() : (readyRef.current ?? true);
      const isBuffered = bufferReadyRef.current;
      if (t - last > FRAME_MS / speedRef.current && isReady && isBuffered) {
        onChange((currentRef.current + 1) % total);
        last = t;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, total, onChange]);

  if (total <= 1) return null;

  const atStart = current <= 0;
  const atEnd = current >= total - 1;

  const isPlayDisabled =
    (!isBufferReady && playbackState !== "READY" && playbackState !== "PLAYING" && playbackState !== "PAUSED") ||
    playbackState === "ERROR";

  const playTooltip =
    playbackState === "ERROR"
      ? "Playback unavailable - buffering error"
      : isPlayDisabled
      ? `Buffering slices for smooth playback (${progressPercent ?? 0}%)`
      : playing
      ? "Pause cine (Space)"
      : "Play cine (Space)";

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border-strong bg-panel-alt px-3 py-2"
      role="group"
      aria-label="Slice navigation"
    >
      <Tooltip label={playTooltip}>
        <button
          onClick={onTogglePlay}
          disabled={isPlayDisabled}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-clinical disabled:opacity-40 disabled:pointer-events-none"
          aria-label={playing ? "Pause cine playback" : "Play cine playback"}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5 text-clinical" />
          ) : playbackState === "LOADING" || playbackState === "DECODING" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-clinical" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
      </Tooltip>

      {/* Buffer status badge */}
      {(playbackState === "LOADING" || playbackState === "DECODING") && (
        <div className="hidden items-center gap-1.5 rounded bg-clinical/10 border border-clinical/20 px-2 py-0.5 text-[10.5px] font-mono text-clinical sm:flex">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>
            Buffering {bufferedCount ?? 0}/{totalTarget ?? total} ({progressPercent ?? 0}%)
          </span>
        </div>
      )}
      {playbackState === "READY" && progressPercent !== undefined && progressPercent >= 100 && total > 1 && (
        <div className="hidden items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-mono font-medium text-emerald-400 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>READY</span>
        </div>
      )}
      {playbackState === "ERROR" && onRetryBuffer && (
        <button
          onClick={onRetryBuffer}
          className="flex items-center gap-1 rounded bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 text-[10px] font-mono text-rose-400 hover:bg-rose-500/20"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>Retry Buffer</span>
        </button>
      )}

      {/*
       * Playback speed, next to the transport control it modifies rather than off
       * in the toolbar.
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
