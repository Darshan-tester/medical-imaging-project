"use client";

import { useRef, useState, useEffect } from "react";
import { FileText, MessageSquare, Trash2, X, Check, Type, Move, Box } from "lucide-react";
import { ViewerAnnotation, AnnotationShape } from "@/lib/types";
import { ViewerTool } from "./ViewerToolbar";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
}

const SELECT_HIT_DISTANCE = 0.035;

/** Quadratic-midpoint smoothing: turns a raw point list into a curved SVG path, in 0-100 viewBox units. */
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

function calculateDistance(a: Point, b: Point, pixelSpacing?: [number, number]): { px: number; text: string } {
  const dx = (a.x - b.x) * 512;
  const dy = (a.y - b.y) * 512;
  const px = Math.round(Math.hypot(dx, dy));
  if (pixelSpacing) {
    const mmX = (a.x - b.x) * 512 * pixelSpacing[1];
    const mmY = (a.y - b.y) * 512 * pixelSpacing[0];
    const mm = Math.hypot(mmX, mmY);
    return { px, text: `${mm.toFixed(1)} mm` };
  }
  return { px, text: `${px} px` };
}

function calculateAngle(a: Point, b: Point, c: Point): number {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  if (magAB === 0 || magCB === 0) return 0;
  let cosTheta = dot / (magAB * magCB);
  cosTheta = Math.max(-1, Math.min(1, cosTheta));
  return Math.round((Math.acos(cosTheta) * 180) / Math.PI * 10) / 10;
}

function calculateRectArea(p0: Point, p1: Point, pixelSpacing?: [number, number]): string {
  const wPx = Math.abs(p1.x - p0.x) * 512;
  const hPx = Math.abs(p1.y - p0.y) * 512;
  if (pixelSpacing) {
    const wMm = wPx * pixelSpacing[1];
    const hMm = hPx * pixelSpacing[0];
    const area = wMm * hMm;
    return `${area.toFixed(1)} mm²`;
  }
  return `${Math.round(wPx * hPx)} px²`;
}

function calculateCircleArea(p0: Point, p1: Point, pixelSpacing?: [number, number]): string {
  const rPx = Math.hypot((p1.x - p0.x) * 512, (p1.y - p0.y) * 512);
  if (pixelSpacing) {
    const rMm = rPx * ((pixelSpacing[0] + pixelSpacing[1]) / 2);
    const area = Math.PI * rMm * rMm;
    return `${area.toFixed(1)} mm²`;
  }
  return `${Math.round(Math.PI * rPx * rPx)} px²`;
}

export function AnnotationCanvas({
  annotations,
  active,
  activeTool = "pen",
  brushColor,
  brushSize,
  brushOpacity,
  selectedId,
  pixelSpacing,
  onSelect,
  onCommitStroke,
  onCommitAnnotation,
  onDeleteAnnotation,
  onQuickNote,
  onAddFinding,
  onEditFinding,
  onViewIn3D,
}: {
  annotations: ViewerAnnotation[];
  active: boolean;
  activeTool?: ViewerTool;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  selectedId: string | null;
  pixelSpacing?: [number, number];
  onSelect: (id: string | null) => void;
  onCommitStroke: (points: Point[]) => void;
  onCommitAnnotation?: (ann: ViewerAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onQuickNote: (id: string, note: string) => void;
  onAddFinding: (id: string) => void;
  onEditFinding: (id: string) => void;
  onViewIn3D?: (id: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const livePathRef = useRef<SVGPathElement | null>(null);
  const drawingPoints = useRef<Point[]>([]);
  const pointerActive = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [livePoints, setLivePoints] = useState<Point[]>([]);
  const [anglePoints, setAnglePoints] = useState<Point[]>([]);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState("");
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const isAnnotationTool = [
    "pen",
    "measure",
    "angle",
    "arrow",
    "line",
    "rect",
    "circle",
    "text",
    "annotate",
  ].includes(activeTool);

  const getRelative = (e: React.PointerEvent): Point => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || !isAnnotationTool) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointerActive.current = true;
    const p = getRelative(e);

    if (activeTool === "text") {
      setTextInputPos(p);
      setTextInputValue("");
      pointerActive.current = false;
      return;
    }

    if (activeTool === "angle") {
      const next = [...anglePoints, p];
      if (next.length === 3) {
        // Complete angle annotation
        const angleDeg = calculateAngle(next[0], next[1], next[2]);
        const ann: ViewerAnnotation = {
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          studyId: "",
          seriesId: "",
          sliceIndex: 0,
          type: "angle",
          points: next,
          color: brushColor,
          strokeWidth: brushSize,
          opacity: brushOpacity,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          measureValue: `${angleDeg}°`,
        };
        onCommitAnnotation?.(ann);
        setAnglePoints([]);
      } else {
        setAnglePoints(next);
      }
      pointerActive.current = false;
      return;
    }

    drawingPoints.current = [p];
    setLivePoints([p]);
    setIsDrawing(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active || !pointerActive.current) return;
    e.stopPropagation();
    const p = getRelative(e);

    if (activeTool === "pen") {
      const last = drawingPoints.current[drawingPoints.current.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.003) {
        drawingPoints.current.push(p);
        if (livePathRef.current) {
          livePathRef.current.setAttribute("d", pointsToPathD(drawingPoints.current));
        }
      }
    } else {
      // Shape tools: line, arrow, rect, circle, measure
      const start = drawingPoints.current[0];
      if (start) {
        setLivePoints([start, p]);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!active || !pointerActive.current) return;
    e.stopPropagation();
    pointerActive.current = false;
    setIsDrawing(false);

    const endPoint = getRelative(e);
    const pts = drawingPoints.current;

    if (activeTool === "pen") {
      if (pts.length >= 2) {
        onCommitStroke(pts);
      }
      drawingPoints.current = [];
      setLivePoints([]);
      if (livePathRef.current) livePathRef.current.setAttribute("d", "");
      return;
    }

    if (pts.length > 0) {
      const start = pts[0];
      const dist = Math.hypot(endPoint.x - start.x, endPoint.y - start.y);

      // If clicked without dragging, hit test existing annotations
      if (dist < 0.01) {
        let bestId: string | null = null;
        let bestDist = SELECT_HIT_DISTANCE;
        for (const ann of annotations) {
          const c = centroid(ann.points);
          const d = Math.hypot(endPoint.x - c.x, endPoint.y - c.y);
          if (d < bestDist) {
            bestDist = d;
            bestId = ann.id;
          }
        }
        onSelect(bestId);
        drawingPoints.current = [];
        setLivePoints([]);
        return;
      }

      // Commit shape annotation
      let shapeType: AnnotationShape = "line";
      let measureVal: string | undefined = undefined;

      if (activeTool === "measure" || activeTool === "line") {
        shapeType = activeTool === "measure" ? "line" : "line";
        measureVal = calculateDistance(start, endPoint, pixelSpacing).text;
      } else if (activeTool === "arrow") {
        shapeType = "arrow";
      } else if (activeTool === "rect") {
        shapeType = "rectangle";
        measureVal = calculateRectArea(start, endPoint, pixelSpacing);
      } else if (activeTool === "circle") {
        shapeType = "circle";
        measureVal = calculateCircleArea(start, endPoint, pixelSpacing);
      } else if (activeTool === "annotate") {
        shapeType = "marker";
      }

      const ann: ViewerAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        studyId: "",
        seriesId: "",
        sliceIndex: 0,
        type: shapeType,
        points: [start, endPoint],
        color: brushColor,
        strokeWidth: brushSize,
        opacity: brushOpacity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        measureValue: measureVal,
      };

      if (onCommitAnnotation) {
        onCommitAnnotation(ann);
      } else {
        onCommitStroke([start, endPoint]);
      }

      onSelect(ann.id);
    }

    drawingPoints.current = [];
    setLivePoints([]);
  };

  const handleCommitText = () => {
    if (textInputPos && textInputValue.trim()) {
      const ann: ViewerAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        studyId: "",
        seriesId: "",
        sliceIndex: 0,
        type: "text",
        points: [textInputPos],
        color: brushColor,
        strokeWidth: brushSize,
        opacity: brushOpacity,
        text: textInputValue.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onCommitAnnotation?.(ann);
    }
    setTextInputPos(null);
    setTextInputValue("");
  };

  const centerPos = selected ? centroid(selected.points) : null;

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        "absolute inset-0 h-full w-full select-none",
        active && isAnnotationTool ? "pointer-events-auto cursor-crosshair" : "pointer-events-none"
      )}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0, 6 3, 0 6" fill={brushColor} />
          </marker>
        </defs>

        {/* Committed annotations */}
        {annotations.map((ann) => {
          const isSelected = ann.id === selectedId;
          const color = ann.color || brushColor;
          const width = ann.strokeWidth || brushSize;
          const opacity = ann.opacity ?? 1;

          if (ann.type === "freehand") {
            const d = pointsToPathD(ann.points);
            return (
              <g key={ann.id}>
                {isSelected && (
                  <path
                    d={d}
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth={width + 3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={opacity}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          }

          if (ann.type === "line") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            return (
              <g key={ann.id}>
                {isSelected && (
                  <line
                    x1={p0.x * 100}
                    y1={p0.y * 100}
                    x2={p1.x * 100}
                    y2={p1.y * 100}
                    stroke="#38BDF8"
                    strokeWidth={width + 3}
                    opacity={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <line
                  x1={p0.x * 100}
                  y1={p0.y * 100}
                  x2={p1.x * 100}
                  y2={p1.y * 100}
                  stroke={color}
                  strokeWidth={width}
                  strokeOpacity={opacity}
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={p0.x * 100} cy={p0.y * 100} r={1.2} fill={color} />
                <circle cx={p1.x * 100} cy={p1.y * 100} r={1.2} fill={color} />
                {ann.measureValue && (
                  <text
                    x={((p0.x + p1.x) / 2) * 100}
                    y={((p0.y + p1.y) / 2) * 100 - 1.5}
                    fill={color}
                    fontSize="3"
                    textAnchor="middle"
                    className="font-mono font-bold"
                  >
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          if (ann.type === "arrow") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            return (
              <g key={ann.id}>
                <line
                  x1={p0.x * 100}
                  y1={p0.y * 100}
                  x2={p1.x * 100}
                  y2={p1.y * 100}
                  stroke={color}
                  strokeWidth={width}
                  markerEnd="url(#arrowhead)"
                  strokeOpacity={opacity}
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={p0.x * 100} cy={p0.y * 100} r={1.2} fill={color} />
              </g>
            );
          }

          if (ann.type === "rectangle") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            const x = Math.min(p0.x, p1.x) * 100;
            const y = Math.min(p0.y, p1.y) * 100;
            const w = Math.abs(p1.x - p0.x) * 100;
            const h = Math.abs(p1.y - p0.y) * 100;
            return (
              <g key={ann.id}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={color}
                  fillOpacity={opacity * 0.12}
                  stroke={color}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                />
                {ann.measureValue && (
                  <text x={x} y={y - 1.2} fill={color} fontSize="2.8" className="font-mono font-bold">
                    ROI: {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          if (ann.type === "circle") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            const cx = p0.x * 100;
            const cy = p0.y * 100;
            const r = Math.hypot((p1.x - p0.x) * 100, (p1.y - p0.y) * 100);
            return (
              <g key={ann.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={color}
                  fillOpacity={opacity * 0.12}
                  stroke={color}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                />
                {ann.measureValue && (
                  <text x={cx - r} y={cy - r - 1.2} fill={color} fontSize="2.8" className="font-mono font-bold">
                    ROI: {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          if (ann.type === "angle") {
            const [p0, p1, p2] = ann.points;
            if (!p0 || !p1 || !p2) return null;
            return (
              <g key={ann.id}>
                <polyline
                  points={`${p0.x * 100},${p0.y * 100} ${p1.x * 100},${p1.y * 100} ${p2.x * 100},${p2.y * 100}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={p1.x * 100} cy={p1.y * 100} r={1.5} fill={color} />
                <text
                  x={p1.x * 100}
                  y={p1.y * 100 - 2}
                  fill={color}
                  fontSize="3"
                  textAnchor="middle"
                  className="font-mono font-bold"
                >
                  {ann.measureValue}
                </text>
              </g>
            );
          }

          if (ann.type === "text") {
            const [p0] = ann.points;
            if (!p0) return null;
            return (
              <g key={ann.id}>
                <text
                  x={p0.x * 100}
                  y={p0.y * 100}
                  fill={color}
                  fontSize="3.5"
                  fontWeight="bold"
                  className="font-sans select-none"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
                >
                  {ann.text}
                </text>
              </g>
            );
          }

          return null;
        })}

        {/* Live in-progress freehand stroke */}
        <path
          ref={livePathRef}
          fill="none"
          stroke={brushColor}
          strokeWidth={brushSize}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={brushOpacity}
          vectorEffect="non-scaling-stroke"
        />

        {/* Live in-progress shape */}
        {isDrawing && livePoints.length === 2 && (
          <>
            {(activeTool === "measure" || activeTool === "line") && (
              <line
                x1={livePoints[0].x * 100}
                y1={livePoints[0].y * 100}
                x2={livePoints[1].x * 100}
                y2={livePoints[1].y * 100}
                stroke={brushColor}
                strokeWidth={brushSize}
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {activeTool === "arrow" && (
              <line
                x1={livePoints[0].x * 100}
                y1={livePoints[0].y * 100}
                x2={livePoints[1].x * 100}
                y2={livePoints[1].y * 100}
                stroke={brushColor}
                strokeWidth={brushSize}
                markerEnd="url(#arrowhead)"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {activeTool === "rect" && (
              <rect
                x={Math.min(livePoints[0].x, livePoints[1].x) * 100}
                y={Math.min(livePoints[0].y, livePoints[1].y) * 100}
                width={Math.abs(livePoints[1].x - livePoints[0].x) * 100}
                height={Math.abs(livePoints[1].y - livePoints[0].y) * 100}
                fill={brushColor}
                fillOpacity={0.15}
                stroke={brushColor}
                strokeWidth={brushSize}
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {activeTool === "circle" && (
              <circle
                cx={livePoints[0].x * 100}
                cy={livePoints[0].y * 100}
                r={Math.hypot((livePoints[1].x - livePoints[0].x) * 100, (livePoints[1].y - livePoints[0].y) * 100)}
                fill={brushColor}
                fillOpacity={0.15}
                stroke={brushColor}
                strokeWidth={brushSize}
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </>
        )}

        {/* Live in-progress angle points */}
        {anglePoints.map((pt, i) => (
          <circle key={i} cx={pt.x * 100} cy={pt.y * 100} r={1.5} fill="#F59E0B" />
        ))}
      </svg>

      {/* Inline Text Input for Text Tool */}
      {textInputPos && (
        <div
          className="absolute z-20 -translate-x-2 -translate-y-4 rounded-md border border-clinical bg-panel p-1.5 shadow-xl pointer-events-auto"
          style={{ left: `${textInputPos.x * 100}%`, top: `${textInputPos.y * 100}%` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              type="text"
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommitText();
                if (e.key === "Escape") setTextInputPos(null);
              }}
              placeholder="Label text…"
              className="w-32 rounded bg-base px-1.5 py-0.5 text-xs text-ink-primary outline-none"
            />
            <button
              onClick={handleCommitText}
              className="rounded bg-clinical p-1 text-white hover:bg-clinical-strong"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              onClick={() => setTextInputPos(null)}
              className="rounded p-1 text-ink-muted hover:text-ink-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Popover for selected annotation */}
      {selected && centerPos && (
        <div
          className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border border-border-strong bg-panel/95 px-2 py-1 shadow-2xl backdrop-blur-md pointer-events-auto"
          style={{ left: `${centerPos.x * 100}%`, top: `${Math.max(0.05, centerPos.y - 0.03) * 100}%` }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-mono text-[10px] text-clinical font-semibold uppercase">
            {selected.type}
          </span>
          {selected.measureValue && (
            <span className="font-mono text-[10px] text-ink-secondary">({selected.measureValue})</span>
          )}

          <div className="mx-1 h-3.5 w-px bg-border-strong" />

          {selected.findingId ? (
            <button
              onClick={() => onEditFinding(selected.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-clinical hover:bg-clinical/10"
              title="Edit linked finding"
            >
              <FileText className="h-3 w-3" />
              <span>Finding</span>
            </button>
          ) : (
            <button
              onClick={() => onAddFinding(selected.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-ink-secondary hover:text-ink-primary hover:bg-base"
              title="Promote to Finding"
            >
              <FileText className="h-3 w-3" />
              <span>+ Finding</span>
            </button>
          )}

          {onViewIn3D && (
            <button
              onClick={() => onViewIn3D(selected.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-cyan-300 hover:text-cyan-100 hover:bg-cyan-950/60 border border-cyan-500/30"
              title="View this annotation in 3D Anatomy"
            >
              <Box className="h-3 w-3" />
              <span>3D</span>
            </button>
          )}

          <button
            onClick={() => onDeleteAnnotation(selected.id)}
            className="flex items-center rounded p-1 text-ink-muted hover:text-red-400"
            title="Delete annotation"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => onSelect(null)}
            className="flex items-center rounded p-1 text-ink-muted hover:text-ink-primary"
            title="Deselect"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
