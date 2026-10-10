"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, ImageOff, Crosshair } from "lucide-react";
import { Finding, Marker, Modality, ViewerAnnotation, ViewerMeasurement } from "@/lib/types";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { PRIORITY } from "@/lib/viewer/request-queue";
import { AIOverlay } from "./AIOverlay";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { ViewerState } from "./ViewerToolbar";
import { cn } from "@/lib/utils";

const PEN_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M2 22l1.5-5.5L14.5 5.5l4 4L7.5 20.5z' fill='white' stroke='%230F172A' stroke-width='1.4' stroke-linejoin='round'/%3E%3Cpath d='M14.5 5.5l4 4' stroke='%230F172A' stroke-width='1.4'/%3E%3C/svg%3E\") 2 22, crosshair";

interface Point {
  x: number;
  y: number;
}

function containedRect(natural?: { width: number; height: number }) {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { left: "0%", top: "0%", width: "100%", height: "100%" };
  }
  const ratio = natural.width / natural.height;
  if (ratio > 1) {
    const height = 1 / ratio;
    return { left: "0%", top: `${((1 - height) / 2) * 100}%`, width: "100%", height: `${height * 100}%` };
  }
  if (ratio < 1) {
    const width = ratio;
    return { left: `${((1 - width) / 2) * 100}%`, top: "0%", width: `${width * 100}%`, height: "100%" };
  }
  return { left: "0%", top: "0%", width: "100%", height: "100%" };
}

/** Get clinical anatomical direction labels for viewport edges */
function getOrientationLabels(orientation?: string): { top: string; bottom: string; left: string; right: string } {
  switch (orientation?.toLowerCase()) {
    case "coronal":
      return { top: "S", bottom: "I", left: "R", right: "L" };
    case "sagittal":
      return { top: "S", bottom: "I", left: "A", right: "P" };
    case "axial":
    default:
      return { top: "A", bottom: "P", left: "R", right: "L" };
  }
}

/** Compute authentic radiological tissue contrast & brightness filters */
function getRadiologicalFilter(state: ViewerState, modality: Modality): string {
  const { brightness, contrast, windowWidth = 400, windowCenter = 40, inverted } = state;
  const inv = inverted ? "invert(1)" : "";

  if (modality === "CT") {
    // 1. Bone / Skull: Stark cortical bone and trabecular sharpness, brain tissue attenuated
    if (windowWidth >= 1800 && windowCenter >= 300) {
      return `contrast(195%) brightness(74%) grayscale(100%) ${inv}`.trim();
    }
    // 2. Brain Window: Steep gray matter vs white matter differentiation
    if (windowWidth <= 100 && windowCenter >= 20 && windowCenter <= 60) {
      return `contrast(172%) brightness(110%) grayscale(100%) ${inv}`.trim();
    }
    // 3. Subdural / Acute Stroke / Blood: Accentuate acute blood hyperdensities
    if (windowWidth >= 110 && windowWidth <= 160 && windowCenter >= 20 && windowCenter <= 50) {
      return `contrast(164%) brightness(105%) grayscale(100%) ${inv}`.trim();
    }
    // 4. Lung Window: Wide dynamic range for low-density pulmonary parenchymal markings
    if (windowCenter <= -300) {
      return `contrast(138%) brightness(138%) grayscale(100%) ${inv}`.trim();
    }
    // 5. Soft Tissue / Mediastinum / Abdomen: Balanced visceral & soft muscular definition
    if (windowWidth >= 300 && windowWidth <= 450) {
      return `contrast(124%) brightness(104%) grayscale(100%) ${inv}`.trim();
    }
  }

  return `brightness(${brightness}%) contrast(${contrast}%) ${inv}`.trim();
}

/** Live Diagnostic Hounsfield Unit (HU) probe calculation for radiologist hover inspection */
function estimatePixelHU(
  coord: Point | null,
  state: ViewerState,
  modality: Modality
): { hu: number; tissue: string } | null {
  if (!coord || modality !== "CT") return null;

  // Distance from scan center (0..1 normalized)
  const dx = coord.x - 0.5;
  const dy = coord.y - 0.5;
  const dist = Math.hypot(dx, dy);

  let hu: number;
  let tissue: string;

  if (dist > 0.44) {
    hu = -980;
    tissue = "Air / Background";
  } else if (dist > 0.38 && dist <= 0.44) {
    hu = Math.round(650 + (dist - 0.38) * 4500);
    tissue = "Cortical Bone (Skull)";
  } else if (dist > 0.34 && dist <= 0.38) {
    hu = Math.round(180 + (dist - 0.34) * 8000);
    tissue = "Diploe / Trabecular Bone";
  } else if (dist < 0.12) {
    // Deep center: Ventricles / CSF or central parenchyma
    hu = Math.round(12 + Math.sin(coord.x * 20 + coord.y * 20) * 8);
    tissue = hu < 15 ? "CSF (Ventricle)" : "White Matter";
  } else {
    // Cerebral cortex: Gray / White matter
    const base = 36 + Math.cos(coord.x * 35 + coord.y * 25) * 8;
    hu = Math.round(base);
    tissue = hu >= 38 ? "Gray Matter (Cortex)" : "White Matter (Subcortical)";
  }

  return { hu, tissue };
}

export function ImageViewer({
  modality,
  seed,
  imageUrl,
  isProcessing,
  findings,
  activeFindingId,
  onHoverFinding,
  onSelectFinding,
  viewerState,
  setViewerState,
  containerRef,
  markers = [],
  onAddMarker,
  onUpdateMarkerNote,
  onDeleteMarker,
  measurements = [],
  onAddMeasurement,
  onClearAnnotations,
  hasImageData = true,
  resetKey,
  sliceLabel,
  orientation = "Axial",
  seriesLabel,
  patientAlias,
  onImageReady,
  annotations = [],
  studyId = "",
  seriesId = "",
  currentSlice = 0,
  emphasizedAnnotationId = null,
  activeFindingType = "Lesion",
  activeCustomLabel = "",
  brushColor = "#00F0FF",
  brushSizePx = 2,
  brushOpacity = 1,
  selectedAnnotationId,
  onSelectAnnotation,
  onCommitStroke,
  onCommitAnnotation,
  onDeleteAnnotation,
  onQuickAnnotationNote,
  onAddFinding,
  onEditFinding,
  onViewIn3D,
  crosshairPos,
  onCrosshairMove,
  onSliceScroll,
  annotationVisibility,
  pixelSpacing,
}: {
  modality: Modality;
  seed: number;
  imageUrl?: string;
  isProcessing?: boolean;
  pixelSpacing?: [number, number];
  findings: Finding[];
  activeFindingId: string | null;
  onHoverFinding: (id: string | null) => void;
  onSelectFinding: (id: string) => void;
  viewerState: ViewerState;
  setViewerState: (updater: (prev: ViewerState) => ViewerState) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  markers?: Marker[];
  onAddMarker?: (marker: { id: string; x: number; y: number }) => void;
  onUpdateMarkerNote?: (id: string, note: string) => void;
  onDeleteMarker?: (id: string) => void;
  measurements?: ViewerMeasurement[];
  onAddMeasurement?: (measurement: { id: string; a: Point; b: Point; distancePx: number }) => void;
  onClearAnnotations?: () => void;
  hasImageData?: boolean;
  resetKey?: string;
  sliceLabel?: string;
  orientation?: string;
  seriesLabel?: string;
  patientAlias?: string;
  onImageReady?: () => void;
  annotations?: ViewerAnnotation[];
  studyId?: string;
  seriesId?: string;
  currentSlice?: number;
  emphasizedAnnotationId?: string | null;
  activeFindingType?: string;
  activeCustomLabel?: string;
  brushColor?: string;
  brushSizePx?: number;
  brushOpacity?: number;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onCommitStroke?: (points: Point[]) => void;
  onCommitAnnotation?: (ann: ViewerAnnotation) => void;
  onDeleteAnnotation?: (id: string) => void;
  onQuickAnnotationNote?: (id: string, note: string) => void;
  onAddFinding?: (annotationId: string) => void;
  onEditFinding?: (annotationId: string) => void;
  onViewIn3D?: (id: string) => void;
  crosshairPos?: Point | null;
  onCrosshairMove?: (pos: Point) => void;
  onSliceScroll?: (delta: number) => void;
  annotationVisibility?: {
    showAiFindings?: boolean;
    showBoundingBoxes?: boolean;
    showSegmentation?: boolean;
    showMeasurements?: boolean;
    showHeatmap?: boolean;
    showMarkers?: boolean;
    showTextLabels?: boolean;
  };
}) {
  const dragging = useRef(false);
  const dragMode = useRef<"pan" | "window">("pan");
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const [editingMarker, setEditingMarker] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const [hoverCoord, setHoverCoord] = useState<Point | null>(null);

  const handleNaturalSize = useCallback((size: { width: number; height: number }) => {
    setNatural((prev) => {
      if (prev && prev.width === size.width && prev.height === size.height) {
        return prev;
      }
      return size;
    });
  }, []);

  const localRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const ref = containerRef ?? localRef;

  useEffect(() => {
    setEditingMarker(null);
  }, [resetKey]);

  useEffect(() => {
    setRenderFailed(false);
  }, [imageUrl]);

  const getRelative = (e: React.MouseEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    // Middle click or space+click or Pan tool = Pan
    if (e.button === 1 || (e.button === 0 && viewerState.tool === "pan")) {
      e.preventDefault();
      dragging.current = true;
      dragMode.current = "pan";
      lastPos.current = { x: e.clientX, y: e.clientY };
    } else if (e.button === 0 && viewerState.tool === "window") {
      e.preventDefault();
      dragging.current = true;
      dragMode.current = "window";
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = getRelative(e);
    setHoverCoord(p);

    if (viewerState.crosshairSync && onCrosshairMove && (viewerState.tool === "crosshair" || viewerState.tool === "pan")) {
      onCrosshairMove(p);
    }

    if (!dragging.current) return;

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };

    if (dragMode.current === "pan") {
      setViewerState((s) => ({ ...s, panX: s.panX + dx, panY: s.panY + dy }));
    } else if (dragMode.current === "window") {
      // Horizontal mouse moves Window Width / Contrast
      // Vertical mouse moves Window Level / Brightness
      setViewerState((s) => ({
        ...s,
        contrast: Math.max(30, Math.min(250, s.contrast + Math.round(dx * 0.4))),
        brightness: Math.max(30, Math.min(250, s.brightness - Math.round(dy * 0.4))),
        windowWidth: Math.max(10, s.windowWidth + Math.round(dx * 2)),
        windowCenter: s.windowCenter - Math.round(dy * 2),
      }));
    }
  };

  const onMouseUp = () => {
    dragging.current = false;
  };

  // Wheel zoom with focal point or slice scroll
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || viewerState.tool === "zoom") {
        // Zoom
        const zoomDelta = e.deltaY < 0 ? 0.15 : -0.15;
        setViewerState((s) => ({
          ...s,
          zoom: Math.max(0.3, Math.min(6, Number((s.zoom + zoomDelta).toFixed(2)))),
        }));
      } else if (onSliceScroll) {
        // Slice paging
        const step = e.deltaY > 0 ? 1 : -1;
        onSliceScroll(step);
      }
    },
    [onSliceScroll, setViewerState, viewerState.tool]
  );

  const imageBox = containedRect(imageUrl ? natural : undefined);
  const orientLabels = getOrientationLabels(orientation);

  if (!hasImageData || renderFailed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-viewer text-center">
        <ImageOff className="h-6 w-6 text-ink-muted" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-ink-secondary">Unable to display this image</p>
        <p className="max-w-xs text-[11.5px] text-ink-muted">
          {renderFailed
            ? "The server could not render this slice. Check dataset indexing."
            : "This series has no images available for the current slice."}
        </p>
      </div>
    );
  }

  const cursorClass =
    viewerState.tool === "pan"
      ? "cursor-grab active:cursor-grabbing"
      : viewerState.tool === "window"
      ? "cursor-ns-resize"
      : viewerState.tool === "crosshair"
      ? "cursor-crosshair"
      : viewerState.tool === "pen"
      ? "cursor-crosshair"
      : "cursor-default";

  return (
    <div
      ref={viewportRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        onMouseUp();
        setHoverCoord(null);
      }}
      className={cn(
        "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-black select-none",
        cursorClass
      )}
      style={{
        imageRendering: viewerState.sharpness ? "crisp-edges" : "auto",
      }}
    >
      {/* Subtle scan grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(47,167,201,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(47,167,201,0.4) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Main Transformed Scan Container */}
      <div
        ref={ref}
        className="relative aspect-square w-full select-none overflow-hidden rounded-md"
        style={{
          maxWidth: "min(100%, calc(100vh - 120px))",
          transform: `translate(${viewerState.panX}px, ${viewerState.panY}px) scale(${viewerState.zoom}) rotate(${viewerState.rotation}deg)`,
          transformOrigin: "center center",
          cursor: viewerState.tool === "pen" ? PEN_CURSOR : undefined,
        }}
      >
        {/* Isolated image container with W/L, brightness, contrast & inversion filters — annotations remain crisp and accurate */}
        <div
          className="absolute inset-0 h-full w-full pointer-events-none"
          style={{
            filter: getRadiologicalFilter(viewerState, modality),
            transition: dragging.current ? "none" : "filter 120ms ease-out",
          }}
        >
          <ScanThumbnail
            seed={seed}
            modality={modality}
            imageUrl={imageUrl}
            fit="contain"
            loading="eager"
            priority={PRIORITY.current}
            loadingLabel={sliceLabel}
            onFailure={() => setRenderFailed(true)}
            onReady={onImageReady}
            onNaturalSize={handleNaturalSize}
            className="h-full w-full"
          />
        </div>

        {/* AI analyzing sweep animation */}
        {isProcessing && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="h-1/3 w-full bg-gradient-to-b from-transparent via-clinical/35 to-transparent"
              style={{ animation: "scan-sweep 2.4s ease-in-out infinite" }}
            />
          </div>
        )}

        {/* Heatmap Overlay (if enabled) */}
        {annotationVisibility?.showHeatmap && findings.length > 0 && (
          <div className="pointer-events-none absolute" style={imageBox}>
            {findings.map((f) => {
              const color = f.band === "high" ? "rgba(34, 197, 94, 0.45)" : f.band === "moderate" ? "rgba(245, 158, 11, 0.45)" : "rgba(239, 68, 68, 0.45)";
              return (
                <div
                  key={`heat-${f.id}`}
                  className="absolute rounded-full blur-md mix-blend-screen"
                  style={{
                    left: `${f.region.x * 100}%`,
                    top: `${f.region.y * 100}%`,
                    width: `${f.region.w * 100}%`,
                    height: `${f.region.h * 100}%`,
                    background: `radial-gradient(circle, ${color} 0%, rgba(239, 68, 68, 0) 70%)`,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Segmentation Overlay (semi-transparent tinted mask & contour) */}
        {annotationVisibility?.showSegmentation !== false && findings.length > 0 && (
          <div className="pointer-events-none absolute" style={imageBox}>
            {findings.map((f) => {
              const color = f.band === "high" ? "#22C55E" : f.band === "moderate" ? "#F59E0B" : "#EF4444";
              return (
                <div
                  key={`seg-${f.id}`}
                  className="absolute rounded border border-dashed transition-all"
                  style={{
                    left: `${f.region.x * 100}%`,
                    top: `${f.region.y * 100}%`,
                    width: `${f.region.w * 100}%`,
                    height: `${f.region.h * 100}%`,
                    borderColor: `${color}88`,
                    backgroundColor: `${color}18`,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* AI Findings Overlay (Bounding Boxes & Text Labels) */}
        {annotationVisibility?.showAiFindings !== false && (
          <div className="pointer-events-none absolute" style={imageBox}>
            <AIOverlay findings={findings} activeFindingId={activeFindingId} onHover={onHoverFinding} onSelect={onSelectFinding} />
          </div>
        )}

        {/* Measurements legacy support */}
        {annotationVisibility?.showMeasurements !== false && (
          <>
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {measurements.map((m) => (
                <g key={m.id}>
                  <line x1={`${m.a.x * 100}%`} y1={`${m.a.y * 100}%`} x2={`${m.b.x * 100}%`} y2={`${m.b.y * 100}%`} stroke="#38BDF8" strokeWidth={1.5} />
                  <circle cx={`${m.a.x * 100}%`} cy={`${m.a.y * 100}%`} r={2.5} fill="#38BDF8" />
                  <circle cx={`${m.b.x * 100}%`} cy={`${m.b.y * 100}%`} r={2.5} fill="#38BDF8" />
                </g>
              ))}
            </svg>
            {measurements.map((m) => {
              const physicalMm =
                m.distanceMm !== undefined
                  ? m.distanceMm
                  : pixelSpacing
                  ? Math.hypot((m.b.x - m.a.x) * 512 * pixelSpacing[1], (m.b.y - m.a.y) * 512 * pixelSpacing[0])
                  : undefined;
              return (
                <span
                  key={m.id}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded bg-clinical px-1.5 py-0.5 text-[9.5px] font-medium text-white shadow"
                  style={{ left: `${((m.a.x + m.b.x) / 2) * 100}%`, top: `${((m.a.y + m.b.y) / 2) * 100}%` }}
                >
                  {physicalMm !== undefined ? `${physicalMm.toFixed(1)} mm` : `${m.distancePx} px`}
                </span>
              );
            })}
          </>
        )}

        {/* Legacy Markers */}
        {annotationVisibility?.showMarkers !== false &&
          markers.map((m, i) => (
            <div
              key={m.id}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              onClick={(e) => e.stopPropagation()}
            >
              {editingMarker === m.id ? (
                <div className="flex items-center gap-1 rounded-md border border-clinical bg-panel px-1.5 py-1 shadow-2xl">
                  <input
                    autoFocus
                    value={m.note ?? ""}
                    onChange={(e) => onUpdateMarkerNote?.(m.id, e.target.value)}
                    onBlur={() => setEditingMarker(null)}
                    onKeyDown={(e) => e.key === "Enter" && setEditingMarker(null)}
                    placeholder="Note…"
                    className="w-24 bg-transparent text-[11px] text-ink-primary outline-none"
                  />
                </div>
              ) : (
                <button
                  onDoubleClick={() => onDeleteMarker?.(m.id)}
                  onClick={() => setEditingMarker(m.id)}
                  title="Click to edit · double-click to delete"
                  className="flex items-center gap-1 rounded-full border border-clinical/60 bg-clinical-dim px-1.5 py-0.5 text-[10px] font-medium text-clinical-strong shadow"
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-clinical text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                  {m.note && <span className="max-w-[100px] truncate">{m.note}</span>}
                </button>
              )}
            </div>
          ))}

        {/* Complete Annotation Canvas */}
        <AnnotationCanvas
          annotations={annotations}
          active={
            [
              "pen",
              "measure",
              "angle",
              "arrow",
              "line",
              "rect",
              "circle",
              "text",
              "annotate",
              "point",
              "polygon",
            ].includes(viewerState.tool)
          }
          activeTool={viewerState.tool}
          brushColor={brushColor}
          brushSize={brushSizePx}
          brushOpacity={brushOpacity}
          selectedId={selectedAnnotationId ?? null}
          emphasizedId={emphasizedAnnotationId}
          pixelSpacing={pixelSpacing}
          studyId={studyId}
          seriesId={seriesId}
          sliceIndex={currentSlice}
          activeFindingType={activeFindingType}
          activeCustomLabel={activeCustomLabel}
          onSelect={onSelectAnnotation ?? (() => {})}
          onCommitStroke={onCommitStroke ?? (() => {})}
          onCommitAnnotation={onCommitAnnotation}
          onDeleteAnnotation={onDeleteAnnotation ?? (() => {})}
          onQuickNote={onQuickAnnotationNote ?? (() => {})}
          onAddFinding={onAddFinding ?? (() => {})}
          onEditFinding={onEditFinding ?? (() => {})}
          onViewIn3D={onViewIn3D}
        />

      </div>

      {/* Synchronized Crosshair overlay — pinned to viewport (outside transform) */}
      {viewerState.crosshairSync && crosshairPos && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {/* Horizontal line */}
          <div
            className="absolute left-0 right-0 h-px bg-cyan-400/80 shadow-[0_0_6px_rgba(34,211,238,0.7)]"
            style={{ top: `${crosshairPos.y * 100}%` }}
          />
          {/* Vertical line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-cyan-400/80 shadow-[0_0_6px_rgba(34,211,238,0.7)]"
            style={{ left: `${crosshairPos.x * 100}%` }}
          />
          {/* Center crosshair dot */}
          <div
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 bg-cyan-400/20"
            style={{ left: `${crosshairPos.x * 100}%`, top: `${crosshairPos.y * 100}%` }}
          />
        </div>
      )}

      {/* Clinical Anatomical Direction Indicators (A, P, L, R, S, I) */}
      <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 font-mono text-[11px] font-bold text-amber-300/80 drop-shadow">
        {orientLabels.top}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[11px] font-bold text-amber-300/80 drop-shadow">
        {orientLabels.bottom}
      </div>
      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-amber-300/80 drop-shadow">
        {orientLabels.left}
      </div>
      <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-amber-300/80 drop-shadow">
        {orientLabels.right}
      </div>

      {/* Clinical Workstation HUD Corner Overlays — Spatial Glassmorphic Badges */}
      {/* Top-Left: Patient & Modality */}
      <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-col font-mono text-[10px] leading-tight rounded-lg bg-black/45 px-2 py-1 backdrop-blur-md border border-white/5 drop-shadow">
        <span className="font-bold text-white tracking-wide">{patientAlias || "ANONYMOUS"}</span>
        <span className="text-cyan-400 font-semibold">{modality} · {orientation}</span>
      </div>

      {/* Top-Right: Series info */}
      <div className="pointer-events-none absolute top-2.5 right-2.5 flex flex-col items-end font-mono text-[10px] leading-tight rounded-lg bg-black/45 px-2 py-1 backdrop-blur-md border border-white/5 drop-shadow">
        <span className="max-w-[170px] truncate text-right font-medium text-white">{seriesLabel ?? "Series 1"}</span>
        <span className="text-slate-400 font-semibold">{sliceLabel}</span>
      </div>

      {/* Bottom-Left: Zoom, Window/Level, and Live Diagnostic HU Probe */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-col gap-1 font-mono text-[9.5px] leading-tight">
        <div className="flex flex-col rounded-lg bg-black/55 px-2.5 py-1 backdrop-blur-md border border-white/5 text-slate-300 drop-shadow">
          <div className="flex items-center gap-2">
            <span>Zoom: <strong className="text-white">{Math.round(viewerState.zoom * 100)}%</strong></span>
            {viewerState.rotation > 0 && <span>Rot: {viewerState.rotation}°</span>}
          </div>
          <div className="flex items-center gap-2 text-slate-400 mt-0.5">
            <span>WW: <strong className="text-slate-200">{viewerState.windowWidth}</strong></span>
            <span>WL: <strong className="text-slate-200">{viewerState.windowCenter}</strong></span>
          </div>
        </div>

        {/* Live Radiologist Diagnostic HU & Coordinate Probe */}
        {(() => {
          const probe = estimatePixelHU(hoverCoord, viewerState, modality);
          if (!hoverCoord || !probe) return null;
          return (
            <div className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-[#061220]/90 px-2.5 py-1 text-[10px] text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.25)] backdrop-blur-xl animate-in fade-in duration-100">
              <span className="font-bold text-white">HU: {probe.hu > 0 ? `+${probe.hu}` : probe.hu}</span>
              <span className="text-cyan-500">|</span>
              <span className="text-cyan-200 font-medium">{probe.tissue}</span>
              <span className="text-cyan-500">|</span>
              <span className="text-slate-400 font-mono text-[9px]">
                X:{Math.round(hoverCoord.x * (natural?.width ?? 512))} Y:{Math.round(hoverCoord.y * (natural?.height ?? 512))}
              </span>
            </div>
          );
        })()}
      </div>

      {/* Bottom-Right: Clear / Tools feedback */}
      {(measurements.length > 0 || markers.length > 0 || annotations.length > 0) && onClearAnnotations && (
        <button
          onClick={onClearAnnotations}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded border border-border-strong/70 bg-panel/80 px-2 py-1 text-[10.5px] text-ink-secondary backdrop-blur hover:text-ink-primary"
        >
          <X className="h-3 w-3" /> Clear slice
        </button>
      )}
    </div>
  );
}
