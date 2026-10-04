"use client";

import { memo } from "react";
import { Flame, Sliders, RotateCcw, Eye, EyeOff, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClinicalPetControlsProps {
  petOpacity: number;
  onPetOpacityChange: (opacity: number) => void;
  suvMax: number;
  onSuvMaxChange: (val: number) => void;
  suvMin: number;
  onSuvMinChange: (val: number) => void;
  petVisible: boolean;
  onTogglePetVisible: (visible: boolean) => void;
  colormap: "hotiron" | "rainbow" | "pet" | "grayscale";
  onColormapChange: (colormap: "hotiron" | "rainbow" | "pet" | "grayscale") => void;
  onReset?: () => void;
  className?: string;
}

export const ClinicalPetControls = memo(function ClinicalPetControls({
  petOpacity,
  onPetOpacityChange,
  suvMax = 15,
  onSuvMaxChange,
  suvMin = 0,
  onSuvMinChange,
  petVisible,
  onTogglePetVisible,
  colormap = "hotiron",
  onColormapChange,
  onReset,
  className,
}: ClinicalPetControlsProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-panel/95 p-3.5 shadow-lg backdrop-blur-md text-ink-primary select-none text-[12px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-warning/15 text-warning">
            <Flame className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-[12px] text-ink-primary">
            PET / CT Fusion Controls
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onTogglePetVisible(!petVisible)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors",
              petVisible
                ? "bg-warning/20 text-warning border border-warning/40"
                : "border border-border text-ink-muted"
            )}
          >
            {petVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            <span>{petVisible ? "PET Visible" : "PET Hidden"}</span>
          </button>

          {onReset && (
            <button
              onClick={onReset}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:text-ink-primary hover:bg-panel-hover transition-colors"
              title="Reset Fusion Settings"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 1. Fusion Blend Slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-ink-secondary font-medium">Fusion Opacity Blend</span>
          <span className="font-mono text-ink-primary">{Math.round(petOpacity * 100)}% PET</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={petOpacity}
          onChange={(e) => onPetOpacityChange(parseFloat(e.target.value))}
          className="w-full h-1.5 accent-warning cursor-pointer"
        />
        <div className="flex justify-between text-[9px] font-mono text-ink-muted">
          <span>0% (100% CT)</span>
          <span>50% Blend</span>
          <span>100% (Pure PET)</span>
        </div>
      </div>

      {/* 2. SUV Range (Standardized Uptake Value) */}
      <div className="space-y-2 pt-2 border-t border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-ink-secondary">
            SUV Window Range
          </span>
          <span className="font-mono text-[10px] text-ink-muted">
            {suvMin.toFixed(1)} - {suvMax.toFixed(1)} g/mL
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-[10.5px] mb-0.5">
            <span className="text-ink-muted">SUV Max Cutoff:</span>
            <span className="font-mono text-ink-primary">{suvMax.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={2}
            max={35}
            step={0.5}
            value={suvMax}
            onChange={(e) => onSuvMaxChange(parseFloat(e.target.value))}
            className="w-full h-1.5 accent-clinical cursor-pointer"
          />
        </div>
      </div>

      {/* 3. PET Thermal Colormap Presets */}
      <div className="space-y-1.5 pt-2 border-t border-border/60">
        <span className="text-[10.5px] text-ink-secondary block font-medium">
          PET Thermal Colormap:
        </span>
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: "hotiron", label: "Hot Iron" },
              { id: "pet", label: "Thermal" },
              { id: "rainbow", label: "Rainbow" },
              { id: "grayscale", label: "Grayscale" },
            ] as const
          ).map((cm) => (
            <button
              key={cm.id}
              onClick={() => onColormapChange(cm.id)}
              className={cn(
                "py-1 px-1 rounded text-[10px] text-center transition-colors border",
                colormap === cm.id
                  ? "border-warning bg-warning-dim text-warning-strong font-semibold"
                  : "border-border/60 bg-base text-ink-secondary hover:text-ink-primary"
              )}
            >
              {cm.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
