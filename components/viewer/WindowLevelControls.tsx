"use client";

import { useState } from "react";
import { Sun, Contrast, Sliders, RotateCcw, Check, Sparkles } from "lucide-react";
import { Modality, WindowLevelPreset } from "@/lib/types";
import { ViewerState } from "./ViewerToolbar";
import { cn } from "@/lib/utils";

export interface ModalityWindowPreset extends WindowLevelPreset {
  label: string;
  category: "CT" | "MRI" | "X-Ray" | "PET" | "Ultrasound" | "General";
}

export const CLINICAL_PRESETS: ModalityWindowPreset[] = [
  // CT Presets — authentic radiological tissue windows
  { id: "ct-soft-tissue", name: "Soft Tissue", label: "Soft Tissue (CT)", description: "Musculature, organs & visceral density", windowWidth: 400, windowCenter: 40, brightness: 104, contrast: 120, category: "CT" },
  { id: "ct-brain", name: "Brain", label: "Brain (CT)", description: "Gray/white matter differentiation", windowWidth: 80, windowCenter: 40, brightness: 112, contrast: 168, category: "CT" },
  { id: "ct-bone", name: "Bone / Skull", label: "Bone / Skull (CT)", description: "Cortical definition & trabecular bone", windowWidth: 2000, windowCenter: 450, brightness: 75, contrast: 188, category: "CT" },
  { id: "ct-subdural", name: "Subdural / Stroke", label: "Subdural / Stroke (CT)", description: "Acute hemorrhage & ischemia differentiation", windowWidth: 130, windowCenter: 35, brightness: 106, contrast: 162, category: "CT" },
  { id: "ct-lung", name: "Lung", label: "Lung (CT)", description: "Parenchymal air-tissue & pulmonary markings", windowWidth: 1500, windowCenter: -600, brightness: 138, contrast: 136, category: "CT" },
  { id: "ct-mediastinum", name: "Mediastinum", label: "Mediastinum (CT)", description: "Visceral margins & lymph node stations", windowWidth: 350, windowCenter: 40, brightness: 102, contrast: 125, category: "CT" },
  { id: "ct-abdomen", name: "Abdomen", label: "Abdomen (CT)", description: "Peritoneal organs & viscera", windowWidth: 350, windowCenter: 40, brightness: 102, contrast: 125, category: "CT" },
  { id: "ct-liver", name: "Liver", label: "Liver (CT)", description: "Hepatic parenchyma & focal lesions", windowWidth: 150, windowCenter: 30, brightness: 108, contrast: 152, category: "CT" },

  // MRI Presets
  { id: "mri-t1", name: "T1 Anatomical", label: "T1 Anatomical (MRI)", description: "Fat bright, CSF dark anatomical", windowWidth: 500, windowCenter: 250, brightness: 105, contrast: 115, category: "MRI" },
  { id: "mri-t2", name: "T2 / FLAIR", label: "T2 / FLAIR (MRI)", description: "Fluid & edema hyperintensity", windowWidth: 600, windowCenter: 350, brightness: 115, contrast: 125, category: "MRI" },
  { id: "mri-contrast", name: "High Dynamic", label: "High Dynamic (MRI)", description: "Enhanced gradient echo / contrast", windowWidth: 300, windowCenter: 150, brightness: 105, contrast: 140, category: "MRI" },
  { id: "mri-soft", name: "Soft Tissue", label: "Soft Tissue (MRI)", description: "Musculoskeletal & diffuse signal", windowWidth: 700, windowCenter: 300, brightness: 100, contrast: 110, category: "MRI" },

  // X-Ray Presets
  { id: "xray-standard", name: "Standard", label: "Standard (X-Ray)", description: "Diagnostic projection contrast", windowWidth: 400, windowCenter: 40, brightness: 100, contrast: 105, category: "General" },
  { id: "xray-bone", name: "Bone Detail", label: "Bone Detail (X-Ray)", description: "Trabecular & cortical sharpness", windowWidth: 250, windowCenter: 50, brightness: 95, contrast: 135, category: "General" },
  { id: "xray-lung", name: "Lung Fields", label: "Lung Fields (X-Ray)", description: "Thoracic pulmonary fields", windowWidth: 350, windowCenter: -100, brightness: 115, contrast: 120, category: "General" },
  { id: "xray-high", name: "High Contrast", label: "High Contrast (X-Ray)", description: "Steep edge dynamic range", windowWidth: 200, windowCenter: 40, brightness: 100, contrast: 140, category: "General" },

  // PET Presets
  { id: "pet-suv-standard", name: "Standard SUV", label: "Standard SUV (PET)", description: "Standard metabolic tracer uptake", windowWidth: 100, windowCenter: 50, brightness: 100, contrast: 100, category: "General" },
  { id: "pet-suv-high", name: "High SUV", label: "High SUV (PET)", description: "Hypermetabolic focus contrast", windowWidth: 60, windowCenter: 30, brightness: 110, contrast: 130, category: "General" },
  { id: "pet-suv-low", name: "Low Background", label: "Low Background (PET)", description: "Wide background uptake curve", windowWidth: 150, windowCenter: 70, brightness: 90, contrast: 110, category: "General" },

  // Ultrasound Presets
  { id: "us-standard", name: "Standard Echo", label: "Standard Echo (US)", description: "Acoustic impedance baseline", windowWidth: 400, windowCenter: 40, brightness: 100, contrast: 105, category: "General" },
  { id: "us-high", name: "High Contrast", label: "High Contrast (US)", description: "Hypoechoic lesion margin", windowWidth: 250, windowCenter: 40, brightness: 105, contrast: 135, category: "General" },
  { id: "us-smooth", name: "Smooth Tissue", label: "Smooth Tissue (US)", description: "Uniform speckle suppression", windowWidth: 600, windowCenter: 40, brightness: 95, contrast: 90, category: "General" },

  // Baseline Default
  { id: "default", name: "Default / Reset", label: "Default / Reset", description: "Standard calibrated baseline", windowWidth: 400, windowCenter: 40, brightness: 100, contrast: 100, category: "General" },
];

export const WINDOW_LEVEL_PRESETS = CLINICAL_PRESETS;

export function getModalityPresets(modality?: Modality, bodyRegion?: string): ModalityWindowPreset[] {
  const defaultPreset = CLINICAL_PRESETS.find((p) => p.id === "default")!;

  if (modality === "MRI") {
    return [
      CLINICAL_PRESETS.find((p) => p.id === "mri-t1")!,
      CLINICAL_PRESETS.find((p) => p.id === "mri-t2")!,
      CLINICAL_PRESETS.find((p) => p.id === "mri-contrast")!,
      CLINICAL_PRESETS.find((p) => p.id === "mri-soft")!,
      defaultPreset,
    ];
  }

  if (modality === "X-Ray") {
    return [
      CLINICAL_PRESETS.find((p) => p.id === "xray-standard")!,
      CLINICAL_PRESETS.find((p) => p.id === "xray-bone")!,
      CLINICAL_PRESETS.find((p) => p.id === "xray-lung")!,
      CLINICAL_PRESETS.find((p) => p.id === "xray-high")!,
      defaultPreset,
    ];
  }

  if (modality === "PET") {
    return [
      CLINICAL_PRESETS.find((p) => p.id === "pet-suv-standard")!,
      CLINICAL_PRESETS.find((p) => p.id === "pet-suv-high")!,
      CLINICAL_PRESETS.find((p) => p.id === "pet-suv-low")!,
      defaultPreset,
    ];
  }

  if (modality === "Ultrasound") {
    return [
      CLINICAL_PRESETS.find((p) => p.id === "us-standard")!,
      CLINICAL_PRESETS.find((p) => p.id === "us-high")!,
      CLINICAL_PRESETS.find((p) => p.id === "us-smooth")!,
      defaultPreset,
    ];
  }

  if (modality === "CT") {
    // Return all standard diagnostic CT tissue presets so radiologists can switch between
    // soft tissue, brain, bone, stroke, lung, mediastinum, and abdomen regardless of the scan type
    return [
      CLINICAL_PRESETS.find((p) => p.id === "ct-soft-tissue")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-brain")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-bone")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-subdural")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-lung")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-mediastinum")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-abdomen")!,
      CLINICAL_PRESETS.find((p) => p.id === "ct-liver")!,
      defaultPreset,
    ];
  }

  // General fallback
  return [
    CLINICAL_PRESETS.find((p) => p.id === "ct-soft-tissue")!,
    CLINICAL_PRESETS.find((p) => p.id === "ct-bone")!,
    defaultPreset,
    CLINICAL_PRESETS.find((p) => p.id === "xray-high")!,
    CLINICAL_PRESETS.find((p) => p.id === "us-smooth")!,
  ];
}

export function WindowLevelControls({
  state,
  setState,
  onClose,
  modality,
  bodyRegion,
}: {
  state: ViewerState;
  setState: (updater: (prev: ViewerState) => ViewerState) => void;
  onClose: () => void;
  modality?: Modality;
  bodyRegion?: string;
}) {
  const [activePreset, setActivePreset] = useState<string>("default");
  const [activeCategory, setActiveCategory] = useState<"All" | "CT" | "MRI" | "General">("All");
  const modalityPresets = getModalityPresets(modality, bodyRegion);

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
    const def = modalityPresets.find((p) => p.id === "default") || CLINICAL_PRESETS.find((p) => p.id === "default")!;
    applyPreset(def);
  };

  const displayPresets = modality
    ? modalityPresets
    : activeCategory === "All"
    ? WINDOW_LEVEL_PRESETS
    : WINDOW_LEVEL_PRESETS.filter((p) => p.category === activeCategory);

  return (
    <div className="w-84 rounded-2xl border border-white/10 bg-[#0a101f]/90 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-white text-xs">
          <Sliders className="h-4 w-4 text-sky-400" />
          <span className="tracking-wide">Window & Contrast Controls</span>
        </div>
        <button
          onClick={resetWindow}
          title="Reset to default window"
          className="flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-white"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Category selector only when modality is not explicitly locked */}
      {!modality && (
        <div className="mb-2 flex items-center gap-1">
          {(["All", "CT", "MRI", "General"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all backdrop-blur-md",
                activeCategory === cat
                  ? "bg-sky-500 text-white font-semibold shadow-[0_0_10px_rgba(14,165,233,0.4)]"
                  : "bg-white/[0.05] text-slate-400 hover:text-white border border-white/5"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Preset buttons */}
      <div className="mb-4">
        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-0.5">
          {displayPresets.map((p) => {
            const isSelected =
              state.windowWidth === p.windowWidth && state.windowCenter === p.windowCenter;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                className={cn(
                  "flex flex-col items-start rounded-xl border p-2 text-left transition-all backdrop-blur-md",
                  isSelected
                    ? "border-sky-400/80 bg-sky-500/20 text-white shadow-[0_0_12px_rgba(56,189,248,0.25)] ring-1 ring-sky-400/40"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="truncate text-[10.5px] font-semibold">{p.name}</span>
                  {isSelected && <Check className="h-3 w-3 shrink-0 text-sky-400" />}
                </div>
                <span className="font-mono text-[9px] text-slate-400 opacity-90 mt-0.5">
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
