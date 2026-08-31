"use client";

import { useState } from "react";
import { Undo2, Redo2, Eraser, X, Check } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export type AnnotationBrushSize = "thin" | "medium" | "thick";

/** On-screen stroke width in px — constant regardless of zoom (rendered with `vector-effect="non-scaling-stroke"`). */
export const BRUSH_WIDTH_PX: Record<AnnotationBrushSize, number> = {
  thin: 2,
  medium: 3.5,
  thick: 6,
};

export const ANNOTATION_COLORS: { name: string; value: string }[] = [
  { name: "Red", value: "#EF4444" },
  { name: "Yellow", value: "#EAB308" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Green", value: "#22C55E" },
  { name: "White", value: "#F8FAFC" },
];

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0].value; // Red — clinically visible default

export function AnnotationToolbar({
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
  /** How many annotations exist on the current slice — used only to decide whether Clear is worth showing enabled. */
  strokeCount: number;
}) {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border-strong bg-panel-alt px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">Pen</span>

        <div className="mx-0.5 h-5 w-px bg-border-strong" />

        {/* Brush size */}
        <div className="flex items-center gap-1" role="group" aria-label="Brush size">
          {(Object.keys(BRUSH_WIDTH_PX) as AnnotationBrushSize[]).map((s) => (
            <Tooltip key={s} label={s === "thin" ? "Thin" : s === "medium" ? "Medium" : "Thick"}>
              <button
                onClick={() => setSize(s)}
                aria-pressed={size === s}
                aria-label={`Brush size: ${s}`}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)]",
                  size === s && "bg-clinical-dim"
                )}
              >
                <span
                  className="rounded-full bg-ink-primary"
                  style={{ width: BRUSH_WIDTH_PX[s] + 2, height: BRUSH_WIDTH_PX[s] + 2 }}
                  aria-hidden
                />
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="mx-0.5 h-5 w-px bg-border-strong" />

        {/* Opacity */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10.5px] text-ink-muted">Opacity</span>
          <input
            type="range"
            min={0.25}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="h-1.5 w-16 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.12)] accent-clinical"
            aria-label="Annotation opacity"
          />
        </div>

        <div className="mx-0.5 h-5 w-px bg-border-strong" />

        {/* Color */}
        <div className="flex items-center gap-1" role="group" aria-label="Annotation color">
          {ANNOTATION_COLORS.map((c) => (
            <Tooltip key={c.value} label={c.name}>
              <button
                onClick={() => setColor(c.value)}
                aria-pressed={color === c.value}
                aria-label={`Color: ${c.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: c.value }}
              >
                {color === c.value && (
                  <Check className={cn("h-3.5 w-3.5", c.value === "#F8FAFC" || c.value === "#EAB308" ? "text-ink-primary" : "text-white")} strokeWidth={3} />
                )}
              </button>
            </Tooltip>
          ))}
        </div>

        <div className="mx-0.5 h-5 w-px bg-border-strong" />

        <Tooltip label="Undo">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30"
            aria-label="Undo last stroke"
          >
            <Undo2 className="h-[15px] w-[15px]" />
          </button>
        </Tooltip>
        <Tooltip label="Redo">
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary disabled:pointer-events-none disabled:opacity-30"
            aria-label="Redo last undone stroke"
          >
            <Redo2 className="h-[15px] w-[15px]" />
          </button>
        </Tooltip>
        <Tooltip label="Clear annotations on this slice">
          <button
            onClick={() => setConfirmClearOpen(true)}
            disabled={strokeCount === 0}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-critical-dim hover:text-critical disabled:pointer-events-none disabled:opacity-30"
            aria-label="Clear annotations on this slice"
          >
            <Eraser className="h-[15px] w-[15px]" />
          </button>
        </Tooltip>

        <div className="mx-0.5 h-5 w-px bg-border-strong" />

        <Tooltip label="Exit annotation mode">
          <button
            onClick={onExit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary"
            aria-label="Exit annotation mode"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        </Tooltip>
      </div>

      <Modal open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)} title="Clear annotations?" size="sm">
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          This will remove all radiologist drawings from the current slice. Findings already saved from these drawings are kept and detached, not deleted.
          This can&apos;t be undone.
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
            Clear
          </Button>
        </div>
      </Modal>
    </>
  );
}
