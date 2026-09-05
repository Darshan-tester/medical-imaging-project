"use client";

import { useEffect, useRef, useState } from "react";
import { X, ImageOff } from "lucide-react";
import { Finding, Marker, Modality, ViewerAnnotation, ViewerMeasurement } from "@/lib/types";
import { ScanThumbnail } from "@/components/studies/ScanThumbnail";
import { PRIORITY } from "@/lib/viewer/request-queue";
import { AIOverlay } from "./AIOverlay";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { ViewerState } from "./ViewerToolbar";
import { cn } from "@/lib/utils";

// Small inline pencil cursor so Pen mode gives immediate visual feedback,
// distinct from Pan's grab cursor and Measure's crosshair.
const PEN_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M2 22l1.5-5.5L14.5 5.5l4 4L7.5 20.5z' fill='white' stroke='%230F172A' stroke-width='1.4' stroke-linejoin='round'/%3E%3Cpath d='M14.5 5.5l4 4' stroke='%230F172A' stroke-width='1.4'/%3E%3C/svg%3E\") 2 22, crosshair";

interface Point {
  x: number;
  y: number;
}

/**
 * Where the image actually is inside the square frame, as CSS percentages.
 *
 * The frame is `aspect-square` and the image is `object-contain`, so a 512×326
 * MRI reslice or a portrait chest radiograph is letterboxed: the pixels occupy a
 * strip, not the whole frame. Finding regions are normalized against the *image*,
 * so drawing them at `inset-0` puts every box off by the size of the letterbox —
 * up to a third of the frame for the wider reslices in this corpus.
 *
 * Returns full-frame insets until the natural size is known, and for a square
 * image, where the two rectangles are the same thing.
 */
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
    return { left: `${((1 - ratio) / 2) * 100}%`, top: "0%", width: `${ratio * 100}%`, height: "100%" };
  }
  return { left: "0%", top: "0%", width: "100%", height: "100%" };
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
  markers,
  onAddMarker,
  onUpdateMarkerNote,
  onDeleteMarker,
  measurements,
  onAddMeasurement,
  onClearAnnotations,
  hasImageData = true,
  resetKey,
  sliceLabel,
  onImageReady,
  annotations,
  brushColor,
  brushSizePx,
  brushOpacity,
  selectedAnnotationId,
  onSelectAnnotation,
  onCommitStroke,
  onDeleteAnnotation,
  onQuickAnnotationNote,
  onAddFinding,
  onEditFinding,
}: {
  modality: Modality;
  seed: number;
  /** Real uploaded image for this slice, if one exists — shown sharp, un-blurred. */
  imageUrl?: string;
  isProcessing?: boolean;
  findings: Finding[];
  activeFindingId: string | null;
  onHoverFinding: (id: string | null) => void;
  onSelectFinding: (id: string) => void;
  viewerState: ViewerState;
  setViewerState: (updater: (prev: ViewerState) => ViewerState) => void;
  containerRef?: React.RefObject<HTMLDivElement>;
  /** Markers for the *current* series + slice only — parent is responsible for that filtering. */
  markers: Marker[];
  onAddMarker: (marker: { id: string; x: number; y: number }) => void;
  onUpdateMarkerNote: (id: string, note: string) => void;
  onDeleteMarker: (id: string) => void;
  /** Measurements for the *current* series + slice only. */
  measurements: ViewerMeasurement[];
  onAddMeasurement: (measurement: { id: string; a: Point; b: Point; distancePx: number }) => void;
  onClearAnnotations: () => void;
  /** False for an empty/missing series — shows an explicit error state instead of a silent placeholder. */
  hasImageData?: boolean;
  /** Changes whenever the active series/slice changes, so in-progress UI (a half-drawn measurement, an open note editor) doesn't bleed across images. */
  resetKey?: string;
  /**
   * What to say while this slice decodes, e.g. "Slice 17 / 443".
   *
   * A number the reader can watch is worth more than a bare spinner on a 443-slice
   * series: it says which slice is coming and that the viewer is working, and the
   * rest of the viewer stays interactive behind it.
   */
  sliceLabel?: string;
  /**
   * Fired once the current slice's pixels have decoded. Cine playback uses it as
   * backpressure: without it the timer advances every 90 ms regardless of whether
   * the server has produced the frame, which on a reslice-on-demand series queues
   * requests faster than they can be served and looks like a freeze.
   */
  onImageReady?: () => void;
  /** Pen/pencil annotations for the *current* study + series + slice only — parent is responsible for that filtering. */
  annotations: ViewerAnnotation[];
  brushColor: string;
  brushSizePx: number;
  brushOpacity: number;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onCommitStroke: (points: Point[]) => void;
  onDeleteAnnotation: (id: string) => void;
  onQuickAnnotationNote: (id: string, note: string) => void;
  onAddFinding: (annotationId: string) => void;
  onEditFinding: (annotationId: string) => void;
}) {
  const dragging = useRef(false);
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const [pendingStart, setPendingStart] = useState<Point | null>(null);
  const [editingMarker, setEditingMarker] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  /**
   * The current slice's own pixel dimensions, once the browser has decoded it.
   *
   * Needed only to place the AI finding boxes: they are normalized against the
   * image, and `object-contain` means the image is not the frame unless it
   * happens to be square. Undefined until the first decode, which is why
   * `containedRect` falls back to the full frame.
   */
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const localRef = useRef<HTMLDivElement>(null);
  const ref = containerRef ?? localRef;

  useEffect(() => {
    setPendingStart(null);
    setEditingMarker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  /*
   * A failed render is per-image, so this must clear when the image changes —
   * otherwise one 422 from the image route pinned the error state across the
   * rest of the series.
   */
  useEffect(() => {
    setRenderFailed(false);
  }, [imageUrl]);

  // Normalized 0-1 image-space coordinates — stay correct across zoom/pan/resize
  // because they're read from the *untransformed* container's bounding box.
  const getRelative = (e: React.MouseEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };
  const pxDistance = (a: Point, b: Point) => {
    const rect = ref.current!.getBoundingClientRect();
    const dx = (a.x - b.x) * rect.width;
    const dy = (a.y - b.y) * rect.height;
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (viewerState.tool === "pan") {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (viewerState.tool === "pan" && dragging.current) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setViewerState((s) => ({ ...s, panX: s.panX + dx, panY: s.panY + dy }));
    }
  };
  const onMouseUp = () => {
    dragging.current = false;
  };

  /*
   * Deliberately *not* cleared when the slice changes. Every slice in a series
   * shares its dimensions, so the previous slice's value is already the right
   * answer, and dropping back to the full-frame default for the one frame
   * before `onLoad` fires would make every box visibly jump on each step
   * through a series. When the series really does change shape, the first
   * decoded frame corrects it.
   *
   * The placeholder texture is the exception: it is a square SVG that fills the
   * frame, so there is no letterbox to correct for.
   */
  const imageBox = containedRect(imageUrl ? natural : undefined);

  const onClick = (e: React.MouseEvent) => {
    if (viewerState.tool === "measure") {
      const p = getRelative(e);
      if (!pendingStart) {
        setPendingStart(p);
      } else {
        onAddMeasurement({ id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, a: pendingStart, b: p, distancePx: pxDistance(pendingStart, p) });
        setPendingStart(null);
      }
    } else if (viewerState.tool === "annotate") {
      const p = getRelative(e);
      const id = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      onAddMarker({ id, x: p.x, y: p.y });
      setEditingMarker(id);
    }
  };

  if (!hasImageData || renderFailed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-viewer text-center">
        <ImageOff className="h-6 w-6 text-ink-muted" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-ink-secondary">Unable to display this image</p>
        <p className="max-w-xs text-[11.5px] text-ink-muted">
          {renderFailed
            ? "The server could not render this slice. If the dataset index is out of date, re-run the indexer; otherwise this source file may be unreadable."
            : "This series has no images available for the current slice."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-viewer">
      {/* subtle scan grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(47,167,201,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(47,167,201,0.4) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div
        ref={ref}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={onClick}
        className={cn(
          "relative aspect-square w-full max-w-[560px] select-none overflow-hidden rounded-md",
          viewerState.tool === "pan" && "cursor-grab active:cursor-grabbing",
          viewerState.tool === "measure" && "cursor-crosshair",
          viewerState.tool === "annotate" && "cursor-copy"
        )}
        style={{
          transform: `translate(${viewerState.panX}px, ${viewerState.panY}px) scale(${viewerState.zoom})`,
          filter: `brightness(${viewerState.brightness}%) contrast(${viewerState.contrast}%) ${viewerState.inverted ? "invert(1)" : ""}`,
          transition: dragging.current ? "none" : "transform 120ms ease-out, filter 150ms ease-out",
          cursor: viewerState.tool === "pen" ? PEN_CURSOR : undefined,
        }}
      >
        {/* `contain`, not `cover`: a CT sagittal reslice or a chest radiograph is
            not square, and cropping one to fill the frame hides anatomy at the
            edges without telling anyone it did. */}
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
          onNaturalSize={setNatural}
          className="h-full w-full"
        />

        {/* Live "AI analyzing" sweep — purely decorative, sits above the image, below the overlay */}
        {isProcessing && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="h-1/3 w-full bg-gradient-to-b from-transparent via-clinical/35 to-transparent"
              style={{ animation: "scan-sweep 2.4s ease-in-out infinite" }}
            />
          </div>
        )}

        {/* Finding boxes are normalized against the *image*, so they are drawn
            into the letterboxed rectangle the image actually occupies rather
            than the square frame. Markers and measurements stay in frame
            coordinates on purpose: they are created by clicking that same
            frame, so they are already self-consistent with it.

            An absolutely positioned box is itself the containing block for
            AIOverlay's own `absolute inset-0`, so no extra wrapper is needed.
            `pointer-events-none` here does not disable the boxes — each one
            sets `pointer-events-auto` on itself — it only keeps the letterbox
            from swallowing clicks meant for the measure and pen tools. */}
        <div className="pointer-events-none absolute" style={imageBox}>
          <AIOverlay findings={findings} activeFindingId={activeFindingId} onHover={onHoverFinding} onSelect={onSelectFinding} />
        </div>

        {/* Measurements — normalized coordinates, scoped to this exact slice/series by the caller */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {measurements.map((m) => (
            <g key={m.id}>
              <line x1={`${m.a.x * 100}%`} y1={`${m.a.y * 100}%`} x2={`${m.b.x * 100}%`} y2={`${m.b.y * 100}%`} stroke="#60A5FA" strokeWidth={1.5} />
              <circle cx={`${m.a.x * 100}%`} cy={`${m.a.y * 100}%`} r={3} fill="#60A5FA" />
              <circle cx={`${m.b.x * 100}%`} cy={`${m.b.y * 100}%`} r={3} fill="#60A5FA" />
            </g>
          ))}
        </svg>
        {measurements.map((m) => (
          <span
            key={m.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded bg-clinical px-1.5 py-0.5 text-[10px] font-medium text-canvas"
            style={{ left: `${((m.a.x + m.b.x) / 2) * 100}%`, top: `${((m.a.y + m.b.y) / 2) * 100}%` }}
          >
            {m.distanceMm !== undefined ? `${m.distanceMm.toFixed(1)}mm` : `${m.distancePx}px`}
          </span>
        ))}
        {pendingStart && (
          <span
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-clinical"
            style={{ left: `${pendingStart.x * 100}%`, top: `${pendingStart.y * 100}%` }}
          />
        )}

        {/* Markers — normalized coordinates, scoped to this exact slice/series by the caller */}
        {markers.map((m, i) => (
          <div
            key={m.id}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            {editingMarker === m.id ? (
              <div className="flex items-center gap-1 rounded-md border border-ai/50 bg-elevated px-1.5 py-1 shadow-elevated">
                <input
                  autoFocus
                  value={m.note ?? ""}
                  onChange={(e) => onUpdateMarkerNote(m.id, e.target.value)}
                  onBlur={() => setEditingMarker(null)}
                  onKeyDown={(e) => e.key === "Enter" && setEditingMarker(null)}
                  placeholder="Add note (optional)…"
                  className="w-28 bg-transparent text-[11px] text-ink-primary outline-none placeholder:text-ink-muted"
                />
              </div>
            ) : (
              <button
                onDoubleClick={() => onDeleteMarker(m.id)}
                onClick={() => setEditingMarker(m.id)}
                title="Click to edit note · double-click to delete"
                className="flex items-center gap-1 rounded-full border border-ai/50 bg-ai-dim px-1.5 py-0.5 text-[10px] font-medium text-ai-strong"
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ai-strong text-[9px] font-semibold text-canvas">
                  {i + 1}
                </span>
                {m.note && <span className="max-w-[120px] truncate">{m.note}</span>}
              </button>
            )}
          </div>
        ))}

        {/* Pen/pencil annotations — normalized coordinates, scoped to this exact study/series/slice by the caller */}
        <AnnotationCanvas
          annotations={annotations}
          active={viewerState.tool === "pen"}
          brushColor={brushColor}
          brushSize={brushSizePx}
          brushOpacity={brushOpacity}
          selectedId={selectedAnnotationId}
          onSelect={onSelectAnnotation}
          onCommitStroke={onCommitStroke}
          onDeleteAnnotation={onDeleteAnnotation}
          onQuickNote={onQuickAnnotationNote}
          onAddFinding={onAddFinding}
          onEditFinding={onEditFinding}
        />
      </div>

      {(measurements.length > 0 || markers.length > 0) && (
        <button
          onClick={onClearAnnotations}
          className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border-strong bg-panel/85 px-2 py-1 text-[11px] text-ink-secondary backdrop-blur hover:text-ink-primary"
        >
          <X className="h-3 w-3" /> Clear this slice
        </button>
      )}
    </div>
  );
}
