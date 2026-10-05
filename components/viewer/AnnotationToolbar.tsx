"use client";

import { useState } from "react";
import {
  Undo2,
  Redo2,
  Eraser,
  X,
  Check,
  Square,
  Circle,
  Pencil,
  Layers,
  Ruler,
  MapPin,
  Type,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ViewerTool } from "./ViewerToolbar";
import { FindingType } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AnnotationBrushSize = "thin" | "medium" | "thick";

/** On-screen stroke width in px — constant regardless of zoom (rendered with `vector-effect="non-scaling-stroke"`). */
export const BRUSH_WIDTH_PX: Record<AnnotationBrushSize, number> = {
  thin: 1.5,
  medium: 2.5,
  thick: 4.5,
};

export const ANNOTATION_COLORS: { name: string; value: string }[] = [
  { name: "Clinical Cyan", value: "#00F0FF" },
  { name: "Pathology Amber", value: "#F59E0B" },
  { name: "Hemorrhage Rose", value: "#EF4444" },
  { name: "Diagnostic Emerald", value: "#10B981" },
  { name: "Tissue Violet", value: "#8B5CF6" },
  { name: "High-Contrast White", value: "#F8FAFC" },
];

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0].value;

export const FINDING_TYPES: FindingType[] = [
  "Lesion",
  "Nodule",
  "Mass",
  "Fracture",
  "Hemorrhage",
  "Calcification",
  "Fluid",
  "Abnormality",
  "Other",
];

export function AnnotationToolbar({
  activeTool,
  onSelectTool,
  findingType = "Lesion",
  setFindingType,
  customLabel = "",
  setCustomLabel,
  color,
  setColor,
  size,
  setSize,
  opacity,
  setOpacity,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExit,
  strokeCount,
}: {
  activeTool?: ViewerTool;
  onSelectTool?: (tool: ViewerTool) => void;
  findingType?: FindingType | string;
  setFindingType?: (t: FindingType | string) => void;
  customLabel?: string;
  setCustomLabel?: (s: string) => void;
  color: string;
  setColor: (c: string) => void;
  size: AnnotationBrushSize;
  setSize: (s: AnnotationBrushSize) => void;
  opacity: number;
  setOpacity: (o: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onExit: () => void;
  strokeCount: number;
}) {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [findingMenuOpen, setFindingMenuOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const tools: { tool: ViewerTool; label: string; icon: any }[] = [
    { tool: "rect", label: "Rectangle / Bounding Box ROI", icon: Square },
    { tool: "circle", label: "Circle / Ellipse ROI", icon: Circle },
    { tool: "polygon", label: "Polygon ROI (Click to add points, Enter to close)", icon: Layers },
    { tool: "pen", label: "Freehand Contour", icon: Pencil },
    { tool: "measure", label: "Distance Caliper (mm)", icon: Ruler },
    { tool: "annotate", label: "Point / Marker", icon: MapPin },
    { tool: "text", label: "Text Callout", icon: Type },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/30 bg-[#0d121c]/95 px-3 py-1.5 shadow-2xl backdrop-blur-md select-none text-slate-200">
        {/* Finding Type Selector */}
        {setFindingType && (
          <div className="relative">
            <button
              onClick={() => setFindingMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/60 hover:bg-cyan-900/60 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 shadow-sm transition-colors cursor-pointer"
              title="Select Diagnostic Finding Type"
            >
              <span className="text-[10px] text-slate-400 font-normal">Finding:</span>
              <span className="font-bold text-white">{customLabel || findingType}</span>
              <ChevronDown className="h-3 w-3 text-cyan-400" />
            </button>

            {findingMenuOpen && (
              <div
                className="absolute top-9 left-0 z-50 w-52 rounded-xl border border-[#1e293b] bg-[#0f172a]/95 p-1.5 shadow-2xl backdrop-blur-md text-xs font-sans select-none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Select Finding Type
                </div>
                <div className="space-y-0.5">
                  {FINDING_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setFindingType(type);
                        setCustomLabel?.("");
                        setShowCustomInput(false);
                        setFindingMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition-colors cursor-pointer",
                        findingType === type && !customLabel
                          ? "bg-sky-600 text-white font-semibold"
                          : "text-slate-300 hover:bg-[#1e293b] hover:text-white"
                      )}
                    >
                      <span>{type}</span>
                      {findingType === type && !customLabel && <Check className="h-3 w-3" />}
                    </button>
                  ))}
                </div>

                <div className="mt-1 border-t border-[#1e293b] pt-1">
                  {showCustomInput ? (
                    <div className="flex items-center gap-1 p-1">
                      <input
                        autoFocus
                        type="text"
                        value={customLabel}
                        onChange={(e) => setCustomLabel?.(e.target.value)}
                        placeholder="Custom label…"
                        className="w-full rounded bg-[#111827] px-2 py-1 text-[11px] text-white outline-none border border-cyan-400"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setFindingMenuOpen(false);
                        }}
                      />
                      <button
                        onClick={() => setFindingMenuOpen(false)}
                        className="rounded bg-sky-600 px-1.5 py-1 text-[10px] text-white"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCustomInput(true)}
                      className="w-full rounded px-2 py-1 text-left text-[11px] text-cyan-300 hover:bg-[#1e293b]"
                    >
                      + Custom finding label…
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Dedicated 2D Medical Tools */}
        {onSelectTool && (
          <div className="flex items-center gap-1" role="group" aria-label="Annotation tools">
            {tools.map(({ tool, label, icon: Icon }) => (
              <Tooltip key={tool} label={label}>
                <button
                  onClick={() => onSelectTool(tool)}
                  aria-pressed={activeTool === tool}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg transition-all cursor-pointer",
                    activeTool === tool
                      ? "bg-sky-600 text-white shadow-sm ring-1 ring-sky-400/50"
                      : "text-slate-400 hover:bg-[#1e293b] hover:text-white"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Stroke Width */}
        <div className="flex items-center gap-1" role="group" aria-label="Stroke width">
          {(Object.keys(BRUSH_WIDTH_PX) as AnnotationBrushSize[]).map((s) => (
            <Tooltip key={s} label={s === "thin" ? "Thin outline (1.5px)" : s === "medium" ? "Medium outline (2.5px)" : "Thick outline (4.5px)"}>
              <button
                onClick={() => setSize(s)}
                aria-pressed={size === s}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[#1e293b] cursor-pointer",
                  size === s && "bg-[#1e293b] ring-1 ring-cyan-400/60"
                )}
              >
                <span
                  className="rounded-full bg-slate-200"
                  style={{ width: BRUSH_WIDTH_PX[s] + 2, height: BRUSH_WIDTH_PX[s] + 2 }}
                  aria-hidden
                />
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Opacity */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span>Opacity</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="h-1.5 w-14 cursor-pointer appearance-none rounded-full bg-[#1e293b] accent-cyan-400"
            aria-label="Annotation opacity"
          />
        </div>

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Clinical Color Palette */}
        <div className="flex items-center gap-1" role="group" aria-label="Annotation color">
          {ANNOTATION_COLORS.map((c) => (
            <Tooltip key={c.value} label={c.name}>
              <button
                onClick={() => setColor(c.value)}
                aria-pressed={color === c.value}
                aria-label={`Color: ${c.name}`}
                className="flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-white/10 transition-transform hover:scale-110 cursor-pointer"
                style={{ backgroundColor: c.value }}
              >
                {color === c.value && (
                  <Check
                    className={cn(
                      "h-3 w-3 stroke-[3]",
                      c.value === "#F8FAFC" ? "text-slate-900" : "text-black"
                    )}
                  />
                )}
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <Tooltip label="Undo (Ctrl+Z)">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#1e293b] hover:text-white disabled:pointer-events-none disabled:opacity-25 cursor-pointer"
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Redo (Ctrl+Y)">
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#1e293b] hover:text-white disabled:pointer-events-none disabled:opacity-25 cursor-pointer"
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label="Clear annotations on this slice">
            <button
              onClick={() => setConfirmClearOpen(true)}
              disabled={strokeCount === 0}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 disabled:pointer-events-none disabled:opacity-25 cursor-pointer"
              aria-label="Clear annotations on this slice"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="h-4 w-px bg-[#1e293b]" />

        {/* Exit Annotation Mode */}
        <Tooltip label="Close annotation toolbar">
          <button
            onClick={onExit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#1e293b] hover:text-white cursor-pointer"
            aria-label="Exit"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Confirmation Modal for Clearing Slice */}
      <Modal
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        title="Clear slice annotations?"
        size="sm"
      >
        <p className="text-[13px] leading-relaxed text-slate-300">
          This will remove all annotations on the current slice. Any formal findings created from
          these annotations will be preserved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirmClearOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="critical"
            size="sm"
            onClick={() => {
              onClear();
              setConfirmClearOpen(false);
            }}
          >
            Clear Slice
          </Button>
        </div>
      </Modal>
    </>
  );
}
