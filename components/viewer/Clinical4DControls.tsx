"use client";

import { memo } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Repeat,
  Heart,
  Activity,
  Sliders,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Clinical4DControlsProps {
  activePhase: number;
  totalPhases: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPhaseChange: (phase: number) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  cardiacMetrics?: {
    EDV?: { value: number; unit: string };
    ESV?: { value: number; unit: string };
    strokeVolume?: { value: number; unit: string };
    LVEF?: { value: number; unit: string; status: string };
  };
  phaseLabel?: string;
  className?: string;
}

export const Clinical4DControls = memo(function Clinical4DControls({
  activePhase,
  totalPhases = 8,
  isPlaying,
  onTogglePlay,
  onPhaseChange,
  fps = 4,
  onFpsChange,
  cardiacMetrics,
  phaseLabel,
  className,
}: Clinical4DControlsProps) {
  const stepPrev = () => {
    onPhaseChange((activePhase - 1 + totalPhases) % totalPhases);
  };

  const stepNext = () => {
    onPhaseChange((activePhase + 1) % totalPhases);
  };

  const fpsOptions = [2, 4, 8, 12, 16];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-panel/95 p-3.5 shadow-lg backdrop-blur-md text-ink-primary select-none",
        className
      )}
    >
      {/* 1. Header & Phase Counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-clinical/15 text-clinical">
            <Heart className="h-3.5 w-3.5 animate-pulse" />
          </div>
          <span className="font-semibold text-[12px] text-ink-primary">
            4D Temporal Cine Sequence
          </span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px] text-clinical-strong bg-clinical-dim px-2 py-0.5 rounded border border-clinical/30">
          <span>Phase</span>
          <span className="font-bold">{activePhase + 1}</span>
          <span className="text-ink-muted">/</span>
          <span>{totalPhases}</span>
        </div>
      </div>

      {/* Phase Descriptive Label */}
      {phaseLabel && (
        <p className="text-[11px] font-medium text-ink-secondary bg-base/50 px-2.5 py-1 rounded border border-border/60">
          {phaseLabel}
        </p>
      )}

      {/* 2. Timeline Scrubber */}
      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalPhases - 1)}
          value={activePhase}
          onChange={(e) => onPhaseChange(parseInt(e.target.value, 10))}
          className="w-full h-2 accent-clinical cursor-pointer"
        />
        <div className="flex justify-between text-[9px] font-mono text-ink-muted">
          <span>Diastole (P1)</span>
          <span>Systole (P{Math.floor(totalPhases / 2)})</span>
          <span>Diastole (P{totalPhases})</span>
        </div>
      </div>

      {/* 3. Transport Controls */}
      <div className="flex items-center justify-between pt-1 border-t border-border/60">
        <div className="flex items-center gap-1">
          <button
            onClick={stepPrev}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-panel-hover hover:text-ink-primary transition-colors"
            title="Previous Phase"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={onTogglePlay}
            className={cn(
              "flex h-8 px-3 items-center gap-1.5 rounded-md font-semibold text-[11px] transition-colors",
              isPlaying
                ? "bg-warning text-white"
                : "bg-clinical text-white"
            )}
            title={isPlaying ? "Pause Cine" : "Play Cine Loop"}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Play Cine</span>
              </>
            )}
          </button>

          <button
            onClick={stepNext}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-panel-hover hover:text-ink-primary transition-colors"
            title="Next Phase"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Speed Selector */}
        <div className="flex items-center gap-1 text-[10.5px]">
          <span className="text-ink-muted">Speed:</span>
          <div className="flex items-center rounded border border-border bg-base p-0.5">
            {fpsOptions.map((f) => (
              <button
                key={f}
                onClick={() => onFpsChange(f)}
                className={cn(
                  "px-1.5 py-0.5 rounded font-mono text-[9.5px]",
                  fps === f ? "bg-clinical text-white font-bold" : "text-ink-secondary hover:text-ink-primary"
                )}
              >
                {f}fps
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Quantitative Cardiac Volumetrics (When available) */}
      {cardiacMetrics && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-[10.5px]">
          {cardiacMetrics.EDV && (
            <div className="rounded border border-border/70 bg-base p-1.5">
              <span className="text-ink-muted text-[9.5px] block">End-Diastolic Vol (EDV)</span>
              <span className="font-mono font-semibold text-ink-primary">
                {cardiacMetrics.EDV.value} {cardiacMetrics.EDV.unit}
              </span>
            </div>
          )}
          {cardiacMetrics.ESV && (
            <div className="rounded border border-border/70 bg-base p-1.5">
              <span className="text-ink-muted text-[9.5px] block">End-Systolic Vol (ESV)</span>
              <span className="font-mono font-semibold text-ink-primary">
                {cardiacMetrics.ESV.value} {cardiacMetrics.ESV.unit}
              </span>
            </div>
          )}
          {cardiacMetrics.strokeVolume && (
            <div className="rounded border border-border/70 bg-base p-1.5">
              <span className="text-ink-muted text-[9.5px] block">Stroke Volume (SV)</span>
              <span className="font-mono font-semibold text-ink-primary">
                {cardiacMetrics.strokeVolume.value} {cardiacMetrics.strokeVolume.unit}
              </span>
            </div>
          )}
          {cardiacMetrics.LVEF && (
            <div className="rounded border border-border/70 bg-base p-1.5">
              <span className="text-ink-muted text-[9.5px] block">Ejection Fraction (LVEF)</span>
              <span className="font-mono font-semibold text-clinical-strong">
                {cardiacMetrics.LVEF.value}% ({cardiacMetrics.LVEF.status})
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
