"use client";

import React, { useState, useMemo } from "react";
import {
  Layers,
  X,
  Eye,
  EyeOff,
  Scissors,
  RotateCcw,
  Sparkles,
  Info,
} from "lucide-react";
import {
  AnatomicalLayer,
  AnatomicalClipping,
  DEFAULT_CLIPPING,
  AnatomicalCategory,
  CATEGORY_LABELS,
} from "@/lib/anatomy-state";
import { cn } from "@/lib/utils";

export interface AnatomicalLayersPanelProps {
  layers: AnatomicalLayer[];
  onToggleLayer: (layerId: string) => void;
  onLayerOpacity: (layerId: string, opacity: number) => void;
  onIsolateLayer: (layerId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onResetLayers: () => void;
  selectedStructureId?: string | null;
  onSelectStructure?: (id: string | null) => void;
  clipping: AnatomicalClipping;
  onClippingChange: (clipping: AnatomicalClipping) => void;
  onClose?: () => void;
  className?: string;
  isFloatingOrDrawer?: boolean;
}

export function AnatomicalLayersPanel({
  layers,
  onToggleLayer,
  onLayerOpacity,
  onIsolateLayer,
  onShowAll,
  onHideAll,
  onResetLayers,
  selectedStructureId,
  onSelectStructure,
  clipping,
  onClippingChange,
  onClose,
  className,
  isFloatingOrDrawer = false,
}: AnatomicalLayersPanelProps) {
  // Dynamically filter category tabs to only those with relevant anatomy in this study
  const availableCategoryTabs = useMemo(() => {
    const presentCategories = new Set(layers.map((l) => l.category));
    const allTabs: { id: AnatomicalCategory; label: string }[] = [
      { id: "ORGANS", label: "Organs" },
      { id: "BONE", label: "Bone & Spine" },
      { id: "CARDIAC", label: "Cardiac" },
      { id: "VESSELS", label: "Vessels" },
      { id: "SOFT_TISSUE", label: "Tissue & Habit" },
      { id: "FIBERS", label: "Fibers (DTI)" },
      { id: "BLOOD", label: "Blood Pool" },
    ];
    const filtered = allTabs.filter((t) => presentCategories.has(t.id));
    return filtered.length > 0 ? filtered : allTabs.slice(0, 3);
  }, [layers]);

  const [activeCategoryTab, setActiveCategoryTab] = useState<AnatomicalCategory>(
    () => availableCategoryTabs[0]?.id || "ORGANS"
  );

  // If the active tab is not in available tabs, fallback to the first available tab
  const currentTab = availableCategoryTabs.some((t) => t.id === activeCategoryTab)
    ? activeCategoryTab
    : availableCategoryTabs[0]?.id || "ORGANS";

  const availableCount = layers.filter((l) => l.availability === "available").length;
  const visibleCount = layers.filter(
    (l) => l.availability === "available" && l.visible
  ).length;

  return (
    <aside
      className={cn(
        "flex flex-col h-full bg-[#0b0f19] text-[12px] select-none text-slate-200 border-l border-[#1e293b]",
        isFloatingOrDrawer
          ? "w-80 shadow-2xl z-30"
          : "w-full",
        className
      )}
      aria-label="Anatomical Layers Inspector"
    >
      {/* ── Panel Header ── */}
      <div className="p-3 border-b border-[#1e293b] bg-[#0f172a] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-500/20 text-sky-400">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-bold text-white text-[12px] leading-tight">
              <span>Anatomical Layers</span>
              <span className="rounded bg-sky-950 px-1.5 py-0.2 text-[9.5px] font-mono text-sky-300 font-semibold border border-sky-500/30">
                {visibleCount}/{availableCount}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block leading-tight">
              Clinical Segmentation &amp; Surface Meshes
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close Anatomical Layers panel"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Global Quick Action Toolbar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e293b]/80 bg-[#0d121c] text-[11px] shrink-0">
        <span className="text-slate-400 text-[10.5px]">Global Display:</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onShowAll}
            className="text-sky-400 hover:text-sky-300 hover:underline font-medium text-[11px]"
            title="Make all available segmented structures visible"
          >
            Show All
          </button>
          <span className="text-slate-600">·</span>
          <button
            onClick={onHideAll}
            className="text-slate-400 hover:text-slate-200 hover:underline text-[11px]"
            title="Hide all anatomical structures"
          >
            Hide All
          </button>
          <span className="text-slate-600">·</span>
          <button
            onClick={onResetLayers}
            className="text-slate-400 hover:text-slate-200 hover:underline text-[11px] flex items-center gap-0.5"
            title="Reset layer opacities and default visibility"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* ── Context-Aware Category Tabs ── */}
      <div className="flex items-center border-b border-[#1e293b] bg-[#0a0e17] p-1 overflow-x-auto gap-0.5 shrink-0 scrollbar-none">
        {availableCategoryTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCategoryTab(tab.id)}
            className={cn(
              "rounded px-2.5 py-1 text-[10.5px] font-medium whitespace-nowrap transition-colors",
              currentTab === tab.id
                ? "bg-sky-600 text-white font-semibold shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Active Category Layers List ── */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 divide-y divide-[#1e293b]/40 min-h-0">
        {layers
          .filter((l) => l.category === currentTab)
          .map((layer) => {
            const isAvailable = layer.availability === "available";
            const isSelected = selectedStructureId === layer.id;

            return (
              <div
                key={layer.id}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-2 transition-all pt-2.5",
                  isAvailable
                    ? isSelected
                      ? "border-sky-500 bg-sky-950/30 ring-1 ring-sky-500/50"
                      : layer.visible
                      ? "border-[#1e293b] bg-[#111827]"
                      : "border-[#1e293b]/40 bg-[#0d121c] opacity-60"
                    : "border-[#1e293b]/20 bg-[#090d14] opacity-50 cursor-not-allowed"
                )}
              >
                {/* Layer Header */}
                <div className="flex items-center justify-between gap-1.5">
                  <div
                    className="flex items-center gap-2 min-w-0 cursor-pointer"
                    onClick={() => {
                      if (isAvailable && onSelectStructure) {
                        onSelectStructure(layer.id === selectedStructureId ? null : layer.id);
                      }
                    }}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0 border border-black/40",
                        !isAvailable && "opacity-30"
                      )}
                      style={{ backgroundColor: layer.color }}
                    />
                    <span
                      className={cn(
                        "truncate font-medium text-[11.5px]",
                        isAvailable
                          ? layer.visible
                            ? "text-slate-100"
                            : "text-slate-400"
                          : "text-slate-500"
                      )}
                      title={layer.name}
                    >
                      {layer.name}
                    </span>
                  </div>

                  {/* Controls (Disabled if not available) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isAvailable ? (
                      <>
                        <button
                          onClick={() => onIsolateLayer(layer.id)}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[9.5px] font-mono font-medium transition-colors",
                            layer.isolated
                              ? "bg-sky-600 text-white font-bold"
                              : "border border-[#1e293b] text-slate-400 hover:text-white"
                          )}
                          title={layer.isolated ? "Clear isolation" : "Isolate this structure in 3D"}
                        >
                          Iso
                        </button>
                        <button
                          onClick={() => onToggleLayer(layer.id)}
                          className={cn(
                            "p-1 rounded transition-colors",
                            layer.visible
                              ? "text-sky-400 hover:bg-sky-950"
                              : "text-slate-500 hover:bg-[#1a2333]"
                          )}
                          title={layer.visible ? "Hide layer" : "Show layer in 3D"}
                          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                        >
                          {layer.visible ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </>
                    ) : (
                      <span
                        className="text-[9.5px] font-mono text-slate-600 rounded bg-[#111827] px-1.5 py-0.5 border border-[#1e293b]/60 flex items-center gap-1"
                        title={layer.unavailabilityReason || "Not available for this study acquisition"}
                      >
                        <span>○ Unavailable</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Metadata & Opacity Slider */}
                {isAvailable ? (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-mono text-sky-400 font-semibold">
                      {layer.volumeMl !== undefined
                        ? `${layer.volumeMl.toFixed(1)} mL`
                        : "Patient Isosurface"}
                    </span>
                    {layer.visible && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 text-[9.5px]">Opacity:</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1.0}
                          step={0.05}
                          value={layer.opacity}
                          onChange={(e) =>
                            onLayerOpacity(layer.id, parseFloat(e.target.value))
                          }
                          className="w-14 h-1 accent-sky-500 cursor-pointer"
                          aria-label={`${layer.name} opacity`}
                        />
                        <span className="font-mono text-[9px] w-5 text-right text-slate-300">
                          {Math.round(layer.opacity * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 italic mt-0.5 leading-snug">
                    {layer.unavailabilityReason || "Structure not segmented in this series acquisition."}
                  </p>
                )}
              </div>
            );
          })}
      </div>

      {/* ── Section: Anatomical 3D Clipping Planes ── */}
      <div className="p-3 border-t border-[#1e293b] bg-[#0d121c] space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
            <Scissors className="h-3 w-3 text-sky-400" />
            3D Anatomical Clipping
          </span>
          <button
            onClick={() => onClippingChange(DEFAULT_CLIPPING)}
            className="text-[10px] text-slate-400 hover:text-white hover:underline transition-colors"
          >
            Reset Planes
          </button>
        </div>

        {/* Clipping Plane Controls: Axial, Coronal, Sagittal */}
        {(
          [
            { axis: "axial", label: "Axial (Z)", color: "text-sky-400" },
            { axis: "coronal", label: "Coronal (Y)", color: "text-amber-400" },
            { axis: "sagittal", label: "Sagittal (X)", color: "text-purple-400" },
          ] as const
        ).map(({ axis, label, color }) => {
          const state = clipping[axis];
          return (
            <div
              key={axis}
              className="flex flex-col gap-1 rounded bg-[#111827] p-2 border border-[#1e293b]"
            >
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-200">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) =>
                      onClippingChange({
                        ...clipping,
                        [axis]: { ...state, enabled: e.target.checked },
                      })
                    }
                    className="rounded accent-sky-500"
                  />
                  <span className={color}>{label}</span>
                </label>

                <div className="flex items-center gap-1 text-[10px] font-mono">
                  <button
                    onClick={() =>
                      onClippingChange({
                        ...clipping,
                        [axis]: { ...state, reverse: !state.reverse },
                      })
                    }
                    className={cn(
                      "rounded px-1.5 py-0.2 border transition-colors",
                      state.reverse
                        ? "border-sky-500 bg-sky-950 text-sky-300"
                        : "border-[#1e293b] text-slate-400 hover:text-white"
                    )}
                    title="Reverse clipping direction"
                  >
                    {state.reverse ? "Rev" : "Fwd"}
                  </button>
                  <button
                    onClick={() =>
                      onClippingChange({
                        ...clipping,
                        [axis]: { ...state, syncWithSlice: !state.syncWithSlice },
                      })
                    }
                    className={cn(
                      "rounded px-1.5 py-0.2 border transition-colors",
                      state.syncWithSlice
                        ? "border-emerald-500 bg-emerald-950 text-emerald-300"
                        : "border-[#1e293b] text-slate-500"
                    )}
                    title="Synchronize plane with 2D slice position"
                  >
                    Sync
                  </button>
                </div>
              </div>

              {state.enabled && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={state.position}
                    onChange={(e) =>
                      onClippingChange({
                        ...clipping,
                        [axis]: { ...state, position: parseFloat(e.target.value) },
                      })
                    }
                    className="flex-1 h-1 accent-sky-500 cursor-pointer"
                    aria-label={`${label} clip plane position`}
                  />
                  <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
                    {Math.round(state.position * 100)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
