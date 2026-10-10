"use client";

import { useState, useRef, useEffect } from "react";
import {
  ZoomIn,
  ZoomOut,
  Move,
  Sun,
  Contrast,
  RotateCw,
  Maximize,
  Ruler,
  MessageSquarePlus,
  RefreshCw,
  Pencil,
  Crosshair,
  LayoutGrid,
  ChevronDown,
  Maximize2,
  Sliders,
  Type,
  ArrowUpRight,
  Minus,
  Square,
  Circle,
  Compass,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { ViewportLayout } from "@/lib/types";
import { WindowLevelControls } from "./WindowLevelControls";
import { cn } from "@/lib/utils";

export type ViewerTool =
  | "pan"
  | "zoom"
  | "window"
  | "crosshair"
  | "slice"
  | "measure"
  | "angle"
  | "annotate"
  | "point"
  | "arrow"
  | "line"
  | "rect"
  | "circle"
  | "polygon"
  | "text"
  | "pen";

export interface ViewerState {
  zoom: number;
  rotation: number; // 0, 90, 180, 270 (degrees)
  brightness: number; // 40 - 200
  contrast: number; // 40 - 220
  windowWidth: number;
  windowCenter: number;
  inverted: boolean;
  tool: ViewerTool;
  panX: number;
  panY: number;
  crosshairSync: boolean;
  sharpness: boolean;
  activePresetId?: string;
}

export const DEFAULT_VIEWER_STATE: ViewerState = {
  zoom: 1,
  rotation: 0,
  brightness: 100,
  contrast: 100,
  windowWidth: 400,
  windowCenter: 40,
  inverted: false,
  tool: "pan",
  panX: 0,
  panY: 0,
  crosshairSync: true,
  sharpness: true,
  activePresetId: "soft_tissue",
};

function ToolButton({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary",
          active && "bg-clinical-dim text-clinical-strong hover:bg-clinical-dim"
        )}
      >
        <Icon className="h-[15px] w-[15px]" strokeWidth={2} />
        {badge && (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-clinical px-1 text-[8px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function ViewerToolbar({
  state,
  setState,
  onFullscreen,
  onFitScreen,
  currentLayout = "1x1",
  onSelectLayout,
  showLayoutSelector = true,
}: {
  state: ViewerState;
  setState: (updater: (prev: ViewerState) => ViewerState) => void;
  onFullscreen: () => void;
  onFitScreen?: () => void;
  currentLayout?: ViewportLayout;
  onSelectLayout?: (layout: ViewportLayout) => void;
  showLayoutSelector?: boolean;
}) {
  const [showWlMenu, setShowWlMenu] = useState(false);
  const [showAnnotationMenu, setShowAnnotationMenu] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);

  const wlRef = useRef<HTMLDivElement>(null);
  const annRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wlRef.current && !wlRef.current.contains(e.target as Node)) {
        setShowWlMenu(false);
      }
      if (annRef.current && !annRef.current.contains(e.target as Node)) {
        setShowAnnotationMenu(false);
      }
      if (layoutRef.current && !layoutRef.current.contains(e.target as Node)) {
        setShowLayoutMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "w":
          setState((s) => ({ ...s, tool: "window" }));
          break;
        case "p":
          setState((s) => ({ ...s, tool: "pan" }));
          break;
        case "z":
          setState((s) => ({ ...s, tool: "zoom" }));
          break;
        case "m":
          setState((s) => ({ ...s, tool: "measure" }));
          break;
        case "c":
          setState((s) => ({ ...s, tool: "crosshair" }));
          break;
        case "r":
          setState((s) => ({ ...s, rotation: (s.rotation + 90) % 360 }));
          break;
        case "i":
          setState((s) => ({ ...s, inverted: !s.inverted }));
          break;
        case "f":
          handleFit();
          break;
        case "escape":
          setState((s) => ({ ...s, tool: "pan" }));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setState]);

  const handleRotate = () => {
    setState((s) => ({ ...s, rotation: (s.rotation + 90) % 360 }));
  };

  const handleFit = () => {
    if (onFitScreen) {
      onFitScreen();
    } else {
      setState((s) => ({ ...s, zoom: 1, panX: 0, panY: 0 }));
    }
  };

  const handleResetAll = () => {
    setState(() => DEFAULT_VIEWER_STATE);
  };

  // Annotation options
  const annotationOptions: { tool: ViewerTool; label: string; icon: LucideIcon }[] = [
    { tool: "rect", label: "Rectangle / Bounding Box ROI", icon: Square },
    { tool: "circle", label: "Circle / Ellipse ROI", icon: Circle },
    { tool: "polygon", label: "Polygon ROI (Region of Interest)", icon: Layers },
    { tool: "pen", label: "Freehand Contour", icon: Pencil },
    { tool: "measure", label: "Distance Caliper (mm)", icon: Ruler },
    { tool: "angle", label: "Angle Measurement", icon: Compass },
    { tool: "annotate", label: "Point / Marker", icon: MessageSquarePlus },
    { tool: "text", label: "Text Label", icon: Type },
    { tool: "arrow", label: "Arrow Pointer", icon: ArrowUpRight },
    { tool: "line", label: "Line", icon: Minus },
  ];

  const activeAnnotationItem = annotationOptions.find((opt) => opt.tool === state.tool);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border-strong bg-panel-alt p-1 shadow-sm">
      {/* Zoom Controls */}
      <div className="flex items-center">
        <ToolButton
          label="Zoom In (+)"
          icon={ZoomIn}
          onClick={() => setState((s) => ({ ...s, zoom: Math.min(5, Number((s.zoom + 0.25).toFixed(2))) }))}
        />
        <div className="px-1 text-[11px] font-mono text-ink-secondary select-none" title="Zoom level">
          {Math.round(state.zoom * 100)}%
        </div>
        <ToolButton
          label="Zoom Out (-)"
          icon={ZoomOut}
          onClick={() => setState((s) => ({ ...s, zoom: Math.max(0.25, Number((s.zoom - 0.25).toFixed(2))) }))}
        />
        <ToolButton label="Fit to Screen" icon={Maximize2} onClick={handleFit} />
      </div>

      <div className="mx-1 h-5 w-px bg-border-strong" />

      {/* Pan & Navigation */}
      <ToolButton
        label="Pan (Move image)"
        icon={Move}
        active={state.tool === "pan"}
        onClick={() => setState((s) => ({ ...s, tool: "pan" }))}
      />
      <ToolButton
        label={`Rotate 90° CW (${state.rotation}°)`}
        icon={RotateCw}
        active={state.rotation !== 0}
        onClick={handleRotate}
      />

      <div className="mx-1 h-5 w-px bg-border-strong" />

      {/* Window / Level & Contrast */}
      <div className="relative" ref={wlRef}>
        <div className="flex items-center">
          <ToolButton
            label="Window / Level Gesture (Drag on image)"
            icon={Sliders}
            active={state.tool === "window"}
            onClick={() => setState((s) => ({ ...s, tool: "window" }))}
          />
          <button
            onClick={() => setShowWlMenu((v) => !v)}
            title="Window & Contrast Presets"
            className={cn(
              "flex h-8 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary",
              (state.brightness !== 100 || state.contrast !== 100 || showWlMenu) && "text-clinical"
            )}
          >
            <span>W/L</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {showWlMenu && (
          <div className="absolute top-10 left-0 z-50">
            <WindowLevelControls state={state} setState={setState} onClose={() => setShowWlMenu(false)} />
          </div>
        )}
      </div>

      <ToolButton
        label="Invert Grayscale"
        icon={Contrast}
        active={state.inverted}
        onClick={() => setState((s) => ({ ...s, inverted: !s.inverted }))}
      />

      <div className="mx-1 h-5 w-px bg-border-strong" />

      {/* Synchronized Crosshair Toggle */}
      <ToolButton
        label="Synchronized Crosshair (Sync between planes)"
        icon={Crosshair}
        active={state.crosshairSync}
        onClick={() => setState((s) => ({ ...s, crosshairSync: !s.crosshairSync }))}
      />

      <div className="mx-1 h-5 w-px bg-border-strong" />

      {/* Annotations & Measurement Dropdown */}
      <div className="relative" ref={annRef}>
        <div className="flex items-center">
          {activeAnnotationItem ? (
            <ToolButton
              label={activeAnnotationItem.label}
              icon={activeAnnotationItem.icon}
              active={true}
              onClick={() => setShowAnnotationMenu((v) => !v)}
            />
          ) : (
            <ToolButton
              label="Annotations & Measurements"
              icon={Ruler}
              active={false}
              onClick={() => setShowAnnotationMenu((v) => !v)}
            />
          )}
          <button
            onClick={() => setShowAnnotationMenu((v) => !v)}
            className="flex h-8 items-center px-1 text-ink-secondary hover:text-ink-primary"
            title="Choose annotation or measurement tool"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>

        {showAnnotationMenu && (
          <div className="absolute top-10 left-0 z-50 w-56 rounded-xl border border-border-strong bg-panel/95 p-1.5 shadow-2xl backdrop-blur-md">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Annotation & Measurement Tools
            </div>
            <div className="space-y-0.5">
              {annotationOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = state.tool === opt.tool;
                return (
                  <button
                    key={opt.tool}
                    onClick={() => {
                      setState((s) => ({ ...s, tool: opt.tool }));
                      setShowAnnotationMenu(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11.5px] transition-colors",
                      isSelected
                        ? "bg-clinical-dim font-medium text-clinical-strong"
                        : "text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.08)] hover:text-ink-primary"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-clinical" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Layout Selector */}
      {showLayoutSelector && onSelectLayout && (
        <>
          <div className="mx-1 h-5 w-px bg-border-strong" />
          <div className="relative" ref={layoutRef}>
            <button
              onClick={() => setShowLayoutMenu((v) => !v)}
              title="Multi-Plane Layout (Axial / Sagittal / Coronal / 3D)"
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary"
            >
              <LayoutGrid className="h-3.5 w-3.5 text-clinical" />
              <span>{currentLayout.toUpperCase()}</span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {showLayoutMenu && (
              <div className="absolute top-10 left-0 z-50 w-48 rounded-xl border border-border-strong bg-panel/95 p-1.5 shadow-2xl backdrop-blur-md">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                  Viewport Layout
                </div>
                <div className="space-y-0.5">
                  {[
                    { id: "1x1", label: "Single View (1×1)" },
                    { id: "mpr-3d", label: "MPR + 3D Patient (Axial | Sag | Cor + 3D)" },
                    { id: "1x2", label: "Side-by-Side (1×2)" },
                    { id: "2x1", label: "Stacked (2×1)" },
                    { id: "1+2", label: "3 Views (1 + 2)" },
                    { id: "2x2", label: "4-Panel Quad (2×2)" },
                  ].map((l) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        onSelectLayout(l.id as ViewportLayout);
                        setShowLayoutMenu(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11.5px] transition-colors",
                        currentLayout === l.id
                          ? "bg-clinical-dim font-medium text-clinical-strong"
                          : "text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.08)] hover:text-ink-primary"
                      )}
                    >
                      <span>{l.label}</span>
                      {currentLayout === l.id && <span className="h-1.5 w-1.5 rounded-full bg-clinical" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="mx-1 h-5 w-px bg-border-strong" />

      {/* Reset & Fullscreen */}
      <ToolButton label="Reset View (Reset zoom, pan, W/L, rotation)" icon={RefreshCw} onClick={handleResetAll} />
      <ToolButton label="Fullscreen Mode" icon={Maximize} onClick={onFullscreen} />
    </div>
  );
}
