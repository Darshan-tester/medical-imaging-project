"use client";

import { ZoomIn, ZoomOut, Move, Sun, Contrast, FlipHorizontal2, Maximize, Ruler, MessageSquarePlus, RefreshCw, Pencil, type LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export type ViewerTool = "pan" | "measure" | "annotate" | "pen";

export interface ViewerState {
  zoom: number;
  brightness: number;
  contrast: number;
  inverted: boolean;
  tool: ViewerTool;
  panX: number;
  panY: number;
}

export const DEFAULT_VIEWER_STATE: ViewerState = {
  zoom: 1,
  brightness: 100,
  contrast: 100,
  inverted: false,
  tool: "pan",
  panX: 0,
  panY: 0,
};

function ToolButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary",
          active && "bg-clinical-dim text-clinical-strong hover:bg-clinical-dim"
        )}
      >
        <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

export function ViewerToolbar({
  state,
  setState,
  onFullscreen,
}: {
  state: ViewerState;
  setState: (updater: (prev: ViewerState) => ViewerState) => void;
  onFullscreen: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border-strong bg-panel-alt p-1">
      <ToolButton label="Zoom in" icon={ZoomIn} onClick={() => setState((s) => ({ ...s, zoom: Math.min(4, s.zoom + 0.25) }))} />
      <ToolButton label="Zoom out" icon={ZoomOut} onClick={() => setState((s) => ({ ...s, zoom: Math.max(0.5, s.zoom - 0.25) }))} />
      <ToolButton label="Pan" icon={Move} active={state.tool === "pan"} onClick={() => setState((s) => ({ ...s, tool: "pan" }))} />
      <div className="mx-1 h-5 w-px bg-border-strong" />
      <ToolButton
        label="Brightness / window level"
        icon={Sun}
        active={state.brightness !== 100}
        onClick={() => setState((s) => ({ ...s, brightness: s.brightness >= 140 ? 100 : s.brightness + 20 }))}
      />
      <ToolButton
        label="Contrast"
        icon={Contrast}
        active={state.contrast !== 100}
        onClick={() => setState((s) => ({ ...s, contrast: s.contrast >= 140 ? 100 : s.contrast + 20 }))}
      />
      <ToolButton label="Invert" icon={FlipHorizontal2} active={state.inverted} onClick={() => setState((s) => ({ ...s, inverted: !s.inverted }))} />
      <div className="mx-1 h-5 w-px bg-border-strong" />
      <ToolButton label="Measure" icon={Ruler} active={state.tool === "measure"} onClick={() => setState((s) => ({ ...s, tool: "measure" }))} />
      <ToolButton
        label="Marker"
        icon={MessageSquarePlus}
        active={state.tool === "annotate"}
        onClick={() => setState((s) => ({ ...s, tool: "annotate" }))}
      />
      <ToolButton label="Pen" icon={Pencil} active={state.tool === "pen"} onClick={() => setState((s) => ({ ...s, tool: "pen" }))} />
      <div className="mx-1 h-5 w-px bg-border-strong" />
      <ToolButton label="Reset view" icon={RefreshCw} onClick={() => setState(() => DEFAULT_VIEWER_STATE)} />
      <ToolButton label="Fullscreen" icon={Maximize} onClick={onFullscreen} />
    </div>
  );
}
