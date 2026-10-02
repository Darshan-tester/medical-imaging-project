"use client";

import { useState } from "react";
import { Sun, Contrast, Sliders, RotateCcw, Check, Sparkles } from "lucide-react";
import { WindowLevelPreset } from "@/lib/types";
import { ViewerState } from "./ViewerToolbar";
import { cn } from "@/lib/utils";

export const WINDOW_LEVEL_PRESETS: (WindowLevelPreset & { category: "CT" | "MRI" | "General" })[] = [
  // General
  { id: "default", name: "Default", description: "Standard clinical window", windowWidth: 400, windowCenter: 40, brightness: 100, contrast: 100, category: "General" },
  { id: "high-contrast", name: "High Contrast", description: "High dynamic range & steep curve", windowWidth: 160, windowCenter: 60, brightness: 105, contrast: 150, category: "General" },
  { id: "low-contrast", name: "Low Contrast", description: "Smooth gradient for wide density", windowWidth: 800, windowCenter: 40, brightness: 95, contrast: 80, category: "General" },
  // CT Modality Presets
  { id: "brain", name: "Brain (CT)", description: "Gray/white matter differentiation", windowWidth: 80, windowCenter: 40, brightness: 110, contrast: 140, category: "CT" },
  { id: "bone", name: "Bone (CT)", description: "Cortical definition & fracture line", windowWidth: 2000, windowCenter: 500, brightness: 90, contrast: 130, category: "CT" },
  { id: "lung", name: "Lung (CT)", description: "Parenchymal air-tissue contrast", windowWidth: 1500, windowCenter: -600, brightness: 125, contrast: 130, category: "CT" },
  { id: "abdomen", name: "Soft Tissue (CT)", description: "Visceral soft tissue margins", windowWidth: 350, windowCenter: 50, brightness: 100, contrast: 110, category: "CT" },
  // MRI Presets
  { id: "mri-t1", name: "T1 Weighted (MRI)", description: "Fat bright, CSF dark anatomical", windowWidth: 500, windowCenter: 250, brightness: 105, contrast: 115, category: "MRI" },
  { id: "mri-t2", name: "T2 / FLAIR (MRI)", description: "Fluid and edema hyperintensity", windowWidth: 600, windowCenter: 350, brightness: 115, contrast: 125, category: "MRI" },
];

export function WindowLevelControls({
  state,
  setState,
  onClose,
}: {
  state: ViewerState;
  setState: (updater: (prev: ViewerState) => ViewerState) => void;
  onClose: () => void;
}) {
  const [activePreset, setActivePreset] = useState<string>("default");
  const [activeCategory, setActiveCategory] = useState<"All" | "CT" | "MRI" | "General">("All");

  const applyPreset = (preset: WindowLevelPreset) => {
    setActivePreset(preset.id);
    setState((s) => ({
      ...s,
      windowWidth: preset.windowWidth,
      windowCenter: preset.windowCenter,
      brightness: preset.brightness,
      contrast: preset.contrast,
    }));
  };

  const resetWindow = () => {
    applyPreset(WINDOW_LEVEL_PRESETS[0]);
  };

  const filteredPresets =
    activeCategory === "All"
      ? WINDOW_LEVEL_PRESETS
      : WINDOW_LEVEL_PRESETS.filter((p) => p.category === activeCategory);

  return (
    <div className="w-84 rounded-xl border border-border-strong bg-panel/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between border-b border-border-strong pb-2">
        <div className="flex items-center gap-1.5 font-medium text-ink-primary text-xs">
          <Sliders className="h-4 w-4 text-clinical" />
          <span>Window & Contrast Controls</span>
        </div>
        <button
          onClick={resetWindow}
          title="Reset to default window"
          className="flex items-center gap-1 text-[11px] text-ink-muted transition-colors hover:text-ink-primary"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Category selector */}
      <div className="mb-2 flex items-center gap-1">
        {(["All", "CT", "MRI", "General"] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              activeCategory === cat
                ? "bg-clinical text-white font-semibold"
                : "bg-base text-ink-secondary hover:text-ink-primary"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Preset buttons */}
      <div className="mb-4">
        <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
          {filteredPresets.map((p) => {
            const isSelected = activePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={cn(
                  "flex flex-col items-start rounded-md border p-1.5 text-left transition-all",
                  isSelected
                    ? "border-clinical bg-clinical-dim text-clinical-strong"
                    : "border-border-strong/60 bg-base/50 text-ink-secondary hover:border-border-strong hover:bg-base hover:text-ink-primary"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="truncate text-[10px] font-medium">{p.name}</span>
                  {isSelected && <Check className="h-2.5 w-2.5 shrink-0 text-clinical" />}
                </div>
                <span className="font-mono text-[8.5px] text-ink-muted opacity-80">
                  W:{p.windowWidth} L:{p.windowCenter}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Real-time Sliders */}
      <div className="space-y-2.5 border-t border-border-strong pt-3">
        {/* Window Width */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-ink-secondary font-medium">Window Width (WW)</span>
            <span className="font-mono text-[10.5px] text-ink-primary">{state.windowWidth ?? 400}</span>
          </div>
          <input
            type="range"
            min={10}
            max={2500}
            step={10}
            value={state.windowWidth ?? 400}
            onChange={(e) => {
              setActivePreset("custom");
              const val = Number(e.target.value);
              // Map window width to contrast for standard web display
              const approxContrast = Math.round(Math.max(50, Math.min(220, 100 + (400 - val) * 0.05)));
              setState((s) => ({ ...s, windowWidth: val, contrast: approxContrast }));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
          />
        </div>

        {/* Window Center / Level */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-ink-secondary font-medium">Window Level (WL)</span>
            <span className="font-mono text-[10.5px] text-ink-primary">{state.windowCenter ?? 40}</span>
          </div>
          <input
            type="range"
            min={-700}
            max={1000}
            step={10}
            value={state.windowCenter ?? 40}
            onChange={(e) => {
              setActivePreset("custom");
              const val = Number(e.target.value);
              // Map window level to brightness
              const approxBrightness = Math.round(Math.max(40, Math.min(200, 100 - (val - 40) * 0.08)));
              setState((s) => ({ ...s, windowCenter: val, brightness: approxBrightness }));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
          />
        </div>

        {/* Brightness */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Sun className="h-3.5 w-3.5 text-amber-400" />
              Brightness
            </span>
            <span className="font-mono text-[10.5px] text-ink-primary">{state.brightness}%</span>
          </div>
          <input
            type="range"
            min={40}
            max={200}
            step={1}
            value={state.brightness}
            onChange={(e) => {
              setActivePreset("custom");
              const val = Number(e.target.value);
              setState((s) => ({ ...s, brightness: val }));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
          />
        </div>

        {/* Contrast */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              <Contrast className="h-3.5 w-3.5 text-sky-400" />
              Contrast
            </span>
            <span className="font-mono text-[10.5px] text-ink-primary">{state.contrast}%</span>
          </div>
          <input
            type="range"
            min={40}
            max={220}
            step={1}
            value={state.contrast}
            onChange={(e) => {
              setActivePreset("custom");
              const val = Number(e.target.value);
              setState((s) => ({ ...s, contrast: val }));
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-ink-secondary">
            <input
              type="checkbox"
              checked={state.inverted}
              onChange={(e) => setState((s) => ({ ...s, inverted: e.target.checked }))}
              className="rounded border-border-strong text-clinical focus:ring-0"
            />
            <span>Invert Grayscale (Negative)</span>
          </label>
          <button
            onClick={onClose}
            className="rounded bg-clinical/15 px-2.5 py-1 text-[11px] font-medium text-clinical hover:bg-clinical/25"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
