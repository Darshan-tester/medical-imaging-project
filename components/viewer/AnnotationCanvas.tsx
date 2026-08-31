"use client";

import { useRef, useState } from "react";
import { FileText, MessageSquare, Trash2, X } from "lucide-react";
import { ViewerAnnotation } from "@/lib/types";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

const MIN_POINT_DISTANCE = 0.003; // normalized units — throttles recorded points for smooth, non-jagged strokes
const SELECT_HIT_DISTANCE = 0.025; // normalized units — how close a tap must land to a stroke to select it

/** Quadratic-midpoint smoothing: turns a raw point list into a naturally curved SVG path, in 0-100 viewBox units. */
function pointsToPathD(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const [x, y] = [points[0].x * 100, points[0].y * 100];
    return `M ${x} ${y} L ${x} ${y}`;
  }
  const xy = (p: Point) => [p.x * 100, p.y * 100] as const;
  const [x0, y0] = xy(points[0]);
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = xy(points[i]);
    const [nx, ny] = xy(points[i + 1]);
    d += ` Q ${cx} ${cy} ${(cx + nx) / 2} ${(cy + ny) / 2}`;
  }
  const [lx, ly] = xy(points[points.length - 1]);
  d += ` L ${lx} ${ly}`;
  return d;
}

function centroid(points: Point[]): Point {
  const n = points.length || 1;
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, distanceToSegment(p, points[i], points[i + 1]));
  }
  return min;
}

export function AnnotationCanvas({
  annotations,
  active,
  brushColor,
  brushSize,
  brushOpacity,
  selectedId,
  onSelect,
  onCommitStroke,
  onDeleteAnnotation,
  onQuickNote,
  onAddFinding,
  onEditFinding,
}: {
  /** Annotations for the *current* study + series + slice only — caller is responsible for that filtering. */
  annotations: ViewerAnnotation[];
  /** True only when the Pen tool is the active viewer tool. */
  active: boolean;
  brushColor: string;
  brushSize: number; // resolved px width (see BRUSH_WIDTH_PX)
  brushOpacity: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommitStroke: (points: Point[]) => void;
  onDeleteAnnotation: (id: string) => void;
  onQuickNote: (id: string, note: string) => void;
  onAddFinding: (id: string) => void;
  onEditFinding: (id: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const livePathRef = useRef<SVGPathElement | null>(null);
  const drawingPoints = useRef<Point[]>([]);
  const pointerActive = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const getRelative = (e: React.PointerEvent): Point => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointerActive.current = true;
    const p = getRelative(e);
    drawingPoints.current = [p];
    setIsDrawing(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active || !pointerActive.current) return;
    e.stopPropagation();
    const p = getRelative(e);
    const last = drawingPoints.current[drawingPoints.current.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_POINT_DISTANCE) {
      drawingPoints.current.push(p);
      // Imperative DOM update — no setState here, so drawing stays smooth even on long studies.
      if (livePathRef.current) livePathRef.current.setAttribute("d", pointsToPathD(drawingPoints.current));
    }
  };

  const finishStroke = (e: React.PointerEvent) => {
    if (!active || !pointerActive.current) return;
    e.stopPropagation();
    pointerActive.current = false;
    setIsDrawing(false);
    const pts = drawingPoints.current;
    drawingPoints.current = [];

    if (pts.length <= 1) {
      // Essentially a tap, not a drag — treat as a selection action instead of a zero-length stroke.
      const clickPoint = pts[0] ?? getRelative(e);
      let bestId: string | null = null;
      let bestDist = SELECT_HIT_DISTANCE;
      for (const ann of annotations) {
        const d = distanceToPolyline(clickPoint, ann.points);
        if (d < bestDist) {
          bestDist = d;
          bestId = ann.id;
        }
      }
      onSelect(bestId);
      return;
    }

    onCommitStroke(pts);
  };

  return (
    <div
      ref={wrapperRef}
      className={cn("absolute inset-0 z-20", active ? "pointer-events-auto" : "pointer-events-none")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onPointerLeave={(e) => {
        if (pointerActive.current) finishStroke(e);
      }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {annotations.map((a) => (
          <path
            key={a.id}
            d={pointsToPathD(a.points)}
            fill="none"
            stroke={a.color}
            strokeWidth={a.id === selectedId ? a.strokeWidth + 1.5 : a.strokeWidth}
            strokeOpacity={a.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={cn(active && "pointer-events-auto")}
            style={{
              filter: a.id === selectedId ? `drop-shadow(0 0 3px ${a.color})` : undefined,
            }}
          />
        ))}
        {isDrawing && (
          <path
            ref={livePathRef}
            fill="none"
            stroke={brushColor}
            strokeWidth={brushSize}
            strokeOpacity={brushOpacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Selection action popover */}
      {selected && !isDrawing && (
        <div
          className="pointer-events-auto absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+10px)]"
          style={{ left: `${centroid(selected.points).x * 100}%`, top: `${centroid(selected.points).y * 100}%` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {noteEditingId === selected.id ? (
            <div className="flex items-center gap-1 rounded-md border border-clinical/50 bg-elevated px-1.5 py-1 shadow-elevated">
              <input
                autoFocus
                value={selected.radiologistNote ?? ""}
                onChange={(e) => onQuickNote(selected.id, e.target.value)}
                onBlur={() => setNoteEditingId(null)}
                onKeyDown={(e) => e.key === "Enter" && setNoteEditingId(null)}
                placeholder="Quick note…"
                className="w-32 bg-transparent text-[11px] text-ink-primary outline-none placeholder:text-ink-muted"
              />
            </div>
          ) : (
            <div className="flex items-center gap-0.5 rounded-lg border border-border-strong bg-elevated p-1 shadow-elevated">
              <Tooltip label={selected.findingId ? "Edit finding" : "Add finding"}>
                <button
                  onClick={() => (selected.findingId ? onEditFinding(selected.id) : onAddFinding(selected.id))}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-clinical-dim hover:text-clinical-strong"
                  aria-label={selected.findingId ? "Edit finding" : "Add finding"}
                >
                  <FileText className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label="Quick note">
                <button
                  onClick={() => setNoteEditingId(selected.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary"
                  aria-label="Add quick note"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip label="Delete">
                <button
                  onClick={() => onDeleteAnnotation(selected.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-critical-dim hover:text-critical"
                  aria-label="Delete annotation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <div className="mx-0.5 h-4 w-px bg-border-strong" />
              <Tooltip label="Deselect">
                <button
                  onClick={() => onSelect(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-[rgb(var(--overlay-hover)/0.07)] hover:text-ink-primary"
                  aria-label="Deselect annotation"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
