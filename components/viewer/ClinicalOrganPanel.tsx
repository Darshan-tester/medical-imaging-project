"use client";

import { memo } from "react";
import {
  Eye,
  EyeOff,
  Maximize2,
  Sliders,
  Scissors,
  RotateCcw,
  Sparkles,
  Layers,
  Box,
  Target,
  Sun,
  Palette,
  Check,
} from "lucide-react";
import { OrganMeshState } from "./AIAnalysisPanel";
import { ColorMap3D } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

interface ClinicalOrganPanelProps {
  organMeshes: OrganMeshState[];
  onOrganMeshesChange: (meshes: OrganMeshState[]) => void;
  onSelectOrgan?: (organId: string) => void;
  activeOrganId?: string | null;
  // 3D Volume controls
  showOriginalVolume: boolean;
  onToggleOriginalVolume: (val: boolean) => void;
  threshold: number;
  onThresholdChange: (val: number) => void;
  density: number;
  onDensityChange: (val: number) => void;
  colormap: ColorMap3D;
  onColormapChange: (val: ColorMap3D) => void;
  // Clipping controls
  enableClipping: boolean;
  onToggleClipping: (val: boolean) => void;
  clipDistance: number;
  onClipDistanceChange: (val: number) => void;
  clipAxis: "z" | "y" | "x";
  onClipAxisChange: (axis: "z" | "y" | "x") => void;
  onReset3DView?: () => void;
}

const COLORMAPS: { id: ColorMap3D; label: string }[] = [
  { id: "bone", label: "Bone CT" },
  { id: "grayscale", label: "Grayscale" },
  { id: "mri-tissue", label: "Soft Tissue" },
  { id: "hotiron", label: "Hot Iron" },
  { id: "pet", label: "PET Thermal" },
  { id: "rainbow", label: "Rainbow" },
];

export const ClinicalOrganPanel = memo(function ClinicalOrganPanel({
  organMeshes,
  onOrganMeshesChange,
  onSelectOrgan,
  activeOrganId,
  showOriginalVolume,
  onToggleOriginalVolume,
  threshold,
  onThresholdChange,
  density,
  onDensityChange,
  colormap,
  onColormapChange,
  enableClipping,
  onToggleClipping,
  clipDistance,
  onClipDistanceChange,
  clipAxis,
  onClipAxisChange,
  onReset3DView,
}: ClinicalOrganPanelProps) {
  const toggleVisibility = (id: string) => {
    onOrganMeshesChange(
      organMeshes.map((m) => (m.id === id ? { ...m, visible: !m.visible, isolated: false } : m))
    );
  };

  const updateOpacity = (id: string, opacity: number) => {
    onOrganMeshesChange(
      organMeshes.map((m) => (m.id === id ? { ...m, opacity } : m))
    );
  };

  const toggleIsolate = (id: string) => {
    const target = organMeshes.find((m) => m.id === id);
    const currentlyIsolated = target?.isolated;

    onOrganMeshesChange(
      organMeshes.map((m) => {
        if (m.id === id) {
          return { ...m, isolated: !currentlyIsolated, visible: true };
        }
        return { ...m, isolated: false, visible: currentlyIsolated ? true : false };
      })
    );
  };

  const showAll = () => {
    onOrganMeshesChange(organMeshes.map((m) => ({ ...m, visible: true, isolated: false, opacity: 0.75 })));
  };

  const hideAll = () => {
    onOrganMeshesChange(organMeshes.map((m) => ({ ...m, visible: false, isolated: false })));
  };

  const hasIsolated = organMeshes.some((m) => m.isolated);

  return (
    <div className="flex flex-col h-full overflow-y-auto divide-y divide-[#1e293b] bg-[#0b0f19] text-slate-200 select-none text-[12px]">
      {/* 1. Header & Reset View */}
      <div className="p-3.5 flex items-center justify-between bg-[#0f172a]">
        <div className="flex items-center gap-1.5 font-bold text-white text-[12.5px]">
          <Box className="h-4 w-4 text-sky-400" />
          <span>Patient 3D Anatomy</span>
        </div>
        {onReset3DView && (
          <button
            onClick={onReset3DView}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset View</span>
          </button>
        )}
      </div>

      {/* 2. Patient-Specific Segmented Organ Checklist */}
      <div className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            SEGMENTED STRUCTURES ({organMeshes.length})
          </span>
          {organMeshes.length > 0 && (
            <div className="flex items-center gap-2 text-[10.5px]">
              <button
                onClick={showAll}
                className="text-sky-400 hover:underline font-medium"
              >
                Show All
              </button>
              <span className="text-slate-600">·</span>
              <button
                onClick={hideAll}
                className="text-slate-400 hover:underline"
              >
                Hide All
              </button>
            </div>
          )}
        </div>

        {organMeshes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#1e293b] p-3.5 text-center text-slate-400 text-[11.5px] leading-relaxed bg-[#0d121c]">
            <p>No segmented meshes generated yet.</p>
            <p className="mt-1 text-[10.5px] text-slate-500">
              Select <strong className="text-sky-400 font-medium">Clinical AI</strong> to segment lungs, heart, or abdominal organs from this study.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
            {organMeshes.map((organ) => {
              const isVisible = hasIsolated ? organ.isolated : organ.visible;

              return (
                <div
                  key={organ.id}
                  className={cn(
                    "flex flex-col gap-1 rounded-md border p-2 transition-all",
                    isVisible
                      ? "border-[#1e293b] bg-[#111827]"
                      : "border-[#1e293b]/50 bg-[#0d121c] opacity-60",
                    organ.isolated && "ring-1 ring-sky-500 border-sky-500"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Structure Color Chip */}
                      <span
                        className="h-3 w-3 rounded-full shrink-0 shadow-sm border border-black/40"
                        style={{ backgroundColor: organ.color || "#38BDF8" }}
                      />
                      <span
                        className={cn(
                          "truncate font-medium text-[11.5px]",
                          isVisible ? "text-slate-100" : "text-slate-500"
                        )}
                      >
                        {organ.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Isolate Button */}
                      <Tooltip label={organ.isolated ? "Clear Isolation" : "Isolate this structure"}>
                        <button
                          onClick={() => toggleIsolate(organ.id)}
                          className={cn(
                            "flex h-5.5 px-2 items-center justify-center rounded text-[10px] font-medium transition-colors",
                            organ.isolated
                              ? "bg-sky-600 text-white font-semibold"
                              : "border border-[#1e293b] text-slate-400 hover:text-white hover:bg-[#1a2333]"
                          )}
                        >
                          Isolate
                        </button>
                      </Tooltip>

                      {/* Visibility Toggle */}
                      <button
                        onClick={() => toggleVisibility(organ.id)}
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded transition-colors",
                          isVisible
                            ? "text-sky-400 hover:bg-sky-950"
                            : "text-slate-500 hover:bg-[#1a2333]"
                        )}
                        title={isVisible ? "Hide organ" : "Show organ"}
                      >
                        {isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Volume (mL) & Opacity slider when visible */}
                  {isVisible && (
                    <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-slate-400">
                      {organ.volumeMl !== undefined && (
                        <span className="font-mono text-sky-400 font-semibold">
                          {organ.volumeMl.toFixed(1)} mL
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-slate-500">Opacity:</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1.0}
                          step={0.05}
                          value={organ.opacity}
                          onChange={(e) => updateOpacity(organ.id, parseFloat(e.target.value))}
                          className="w-16 h-1 accent-sky-500 cursor-pointer"
                        />
                        <span className="font-mono w-6 text-right text-slate-300">
                          {Math.round(organ.opacity * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Real-Time Anatomical Clipping Planes */}
      <div className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Scissors className="h-3.5 w-3.5 text-amber-400" />
            <span>Anatomical Clipping</span>
          </div>
          <button
            onClick={() => onToggleClipping(!enableClipping)}
            className={cn(
              "px-2 py-0.5 rounded text-[10.5px] font-semibold transition-colors border",
              enableClipping
                ? "bg-amber-950 text-amber-300 border-amber-500/60"
                : "border-[#1e293b] text-slate-500 hover:text-slate-300"
            )}
          >
            {enableClipping ? "ACTIVE" : "OFF"}
          </button>
        </div>

        {enableClipping && (
          <div className="space-y-2 pt-1">
            {/* Plane selector */}
            <div className="flex items-center gap-1">
              <span className="text-[10.5px] text-slate-500 w-12 font-mono">AXIS:</span>
              <div className="flex flex-1 rounded border border-[#1e293b] bg-[#111827] p-0.5 text-[11px]">
                <button
                  onClick={() => onClipAxisChange("z")}
                  className={cn(
                    "flex-1 py-0.5 rounded font-medium transition-colors",
                    clipAxis === "z" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
                  )}
                >
                  Axial (Z)
                </button>
                <button
                  onClick={() => onClipAxisChange("y")}
                  className={cn(
                    "flex-1 py-0.5 rounded font-medium transition-colors",
                    clipAxis === "y" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
                  )}
                >
                  Coronal (Y)
                </button>
                <button
                  onClick={() => onClipAxisChange("x")}
                  className={cn(
                    "flex-1 py-0.5 rounded font-medium transition-colors",
                    clipAxis === "x" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
                  )}
                >
                  Sagittal (X)
                </button>
              </div>
            </div>

            {/* Distance slider */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[10.5px] text-slate-400 font-mono">
                <span>Depth / Cut Plane</span>
                <span>{Math.round(clipDistance * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.01}
                value={clipDistance}
                onChange={(e) => onClipDistanceChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-amber-400 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* 4. Volume Density & Threshold */}
      <div className="p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            VOLUME RAY-MARCH SETTINGS
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={showOriginalVolume}
              onChange={(e) => onToggleOriginalVolume(e.target.checked)}
              className="accent-sky-500 rounded"
            />
            <span>Show Volume</span>
          </label>
        </div>

        {showOriginalVolume && (
          <div className="space-y-2.5">
            {/* Colormap Preset */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Transfer Palette</span>
              <select
                value={colormap}
                onChange={(e) => onColormapChange(e.target.value as ColorMap3D)}
                className="rounded border border-[#1e293b] bg-[#111827] px-2 py-1 text-[11px] text-white focus:outline-none focus:border-sky-500"
              >
                {COLORMAPS.map((cm) => (
                  <option key={cm.id} value={cm.id} className="bg-slate-900 text-white">
                    {cm.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Threshold */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>Iso-surface Threshold</span>
                <span>{threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.9}
                step={0.02}
                value={threshold}
                onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-sky-500 cursor-pointer"
              />
            </div>

            {/* Density */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>Absorption Density</span>
                <span>{density.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={3.0}
                step={0.1}
                value={density}
                onChange={(e) => onDensityChange(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-sky-500 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
