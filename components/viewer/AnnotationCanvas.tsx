"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  FileText,
  Trash2,
  X,
  Check,
  Box,
  CornerDownLeft,
  Crosshair,
  Layers,
  Sparkles,
  ChevronRight,
  Info,
} from "lucide-react";
import { ViewerAnnotation, AnnotationShape, FindingType } from "@/lib/types";
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

function calculateDistance(
  a: Point,
  b: Point,
  pixelSpacing?: [number, number]
): { px: number; mm?: number; text: string } {
  const dx = (a.x - b.x) * 512;
  const dy = (a.y - b.y) * 512;
  const px = Math.round(Math.hypot(dx, dy));
  if (pixelSpacing) {
    const mmX = (a.x - b.x) * 512 * pixelSpacing[1];
    const mmY = (a.y - b.y) * 512 * pixelSpacing[0];
    const mm = Math.hypot(mmX, mmY);
    return { px, mm, text: `${mm.toFixed(1)} mm` };
  }
  return { px, text: `${px} px (relative)` };
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
  return Math.round(((Math.acos(cosTheta) * 180) / Math.PI) * 10) / 10;
}

function calculateRectArea(
  p0: Point,
  p1: Point,
  pixelSpacing?: [number, number]
): { area: number; text: string; unit: string } {
  const wNorm = Math.abs(p1.x - p0.x);
  const hNorm = Math.abs(p1.y - p0.y);
  const wPx = wNorm * 512;
  const hPx = hNorm * 512;
  const pxArea = wPx * hPx;
  if (pixelSpacing) {
    const wMm = wPx * pixelSpacing[1];
    const hMm = hPx * pixelSpacing[0];
    const mmArea = wMm * hMm;
    if (mmArea >= 100) {
      return { area: mmArea / 100, text: `${(mmArea / 100).toFixed(2)} cm²`, unit: "cm²" };
    }
    return { area: mmArea, text: `${mmArea.toFixed(1)} mm²`, unit: "mm²" };
  }
  return { area: Math.round(pxArea), text: `${Math.round(pxArea)} px² (relative)`, unit: "px²" };
}

function calculateCircleArea(
  p0: Point,
  p1: Point,
  pixelSpacing?: [number, number]
): { area: number; text: string; unit: string } {
  const rNorm = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const rPx = rNorm * 512;
  const pxArea = Math.PI * rPx * rPx;
  if (pixelSpacing) {
    const rMm = rPx * ((pixelSpacing[0] + pixelSpacing[1]) / 2);
    const mmArea = Math.PI * rMm * rMm;
    if (mmArea >= 100) {
      return { area: mmArea / 100, text: `${(mmArea / 100).toFixed(2)} cm²`, unit: "cm²" };
    }
    return { area: mmArea, text: `${mmArea.toFixed(1)} mm²`, unit: "mm²" };
  }
  return { area: Math.round(pxArea), text: `${Math.round(pxArea)} px² (relative)`, unit: "px²" };
}

function calculatePolygonArea(
  points: Point[],
  pixelSpacing?: [number, number]
): { area: number; text: string; unit: string } {
  if (points.length < 3) return { area: 0, text: "0 px²", unit: "px²" };
  let shoelace = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    shoelace += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  const normArea = Math.abs(shoelace) / 2;
  const pxArea = normArea * 512 * 512;
  if (pixelSpacing) {
    const mmArea = normArea * (512 * pixelSpacing[1]) * (512 * pixelSpacing[0]);
    if (mmArea >= 100) {
      return { area: mmArea / 100, text: `${(mmArea / 100).toFixed(2)} cm²`, unit: "cm²" };
    }
    return { area: mmArea, text: `${mmArea.toFixed(1)} mm²`, unit: "mm²" };
  }
  return { area: Math.round(pxArea), text: `${Math.round(pxArea)} px² (relative)`, unit: "px²" };
}

export function AnnotationCanvas({
  annotations,
  active,
  activeTool = "pen",
  brushColor,
  brushSize,
  brushOpacity,
  selectedId,
  emphasizedId,
  pixelSpacing,
  studyId = "",
  seriesId = "",
  sliceIndex = 0,
  activeFindingType = "Lesion",
  activeCustomLabel = "",
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
  emphasizedId?: string | null;
  pixelSpacing?: [number, number];
  studyId?: string;
  seriesId?: string;
  sliceIndex?: number;
  activeFindingType?: FindingType | string;
  activeCustomLabel?: string;
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
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState("");
  const [noteInputValue, setNoteInputValue] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

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
    "point",
    "polygon",
  ].includes(activeTool);

  const getRelative = useCallback((e: React.PointerEvent | MouseEvent): Point => {
    if (!wrapperRef.current) return { x: 0, y: 0 };
    const rect = wrapperRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const commitPolygon = useCallback((pts: Point[]) => {
    if (pts.length < 3) {
      setPolygonPoints([]);
      return;
    }
    const c = centroid(pts);
    const areaResult = calculatePolygonArea(pts, pixelSpacing);
    const ann: ViewerAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      studyId,
      seriesId,
      sliceIndex,
      type: "polygon",
      points: pts,
      color: brushColor,
      strokeWidth: brushSize,
      opacity: brushOpacity,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      visible: true,
      findingType: activeFindingType,
      finding: activeCustomLabel || `${activeFindingType} ROI`,
      label: activeCustomLabel || `${activeFindingType} ROI`,
      measureValue: areaResult.text,
      measurement: {
        area: areaResult.area,
        unit: areaResult.unit,
      },
      imageCoordinates: { x: c.x, y: c.y },
    };
    onCommitAnnotation?.(ann);
    onSelect(ann.id);
    setPolygonPoints([]);
  }, [
    studyId,
    seriesId,
    sliceIndex,
    brushColor,
    brushSize,
    brushOpacity,
    activeFindingType,
    activeCustomLabel,
    pixelSpacing,
    onCommitAnnotation,
    onSelect,
  ]);

  // Keyboard shortcut listener for Polygon tool (Enter = close, Esc = cancel) and Annotation Deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (polygonPoints.length > 0) {
        if (e.key === "Enter" && polygonPoints.length >= 3) {
          e.preventDefault();
          commitPolygon(polygonPoints);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setPolygonPoints([]);
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        onDeleteAnnotation(selectedId);
        onSelect(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [polygonPoints, selectedId, onDeleteAnnotation, onSelect, commitPolygon]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || !isAnnotationTool) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const p = getRelative(e);

    // Text tool: click to show text input
    if (activeTool === "text") {
      setTextInputPos(p);
      setTextInputValue("");
      return;
    }

    // Point/Marker tool: click to drop point marker immediately
    if (activeTool === "annotate" || activeTool === "point") {
      const ann: ViewerAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        studyId,
        seriesId,
        sliceIndex,
        type: "marker",
        points: [p],
        color: brushColor,
        strokeWidth: brushSize,
        opacity: brushOpacity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        visible: true,
        findingType: activeFindingType,
        finding: activeCustomLabel || `${activeFindingType} Marker`,
        label: activeCustomLabel || `${activeFindingType} Marker`,
        imageCoordinates: { x: p.x, y: p.y },
      };
      onCommitAnnotation?.(ann);
      onSelect(ann.id);
      return;
    }

    // Polygon tool: click to add vertex, or click near start to close
    if (activeTool === "polygon") {
      if (polygonPoints.length >= 2) {
        const start = polygonPoints[0];
        const distToStart = Math.hypot(p.x - start.x, p.y - start.y);
        if (distToStart < 0.028) {
          commitPolygon(polygonPoints);
          return;
        }
      }
      setPolygonPoints((prev) => [...prev, p]);
      return;
    }

    // Angle tool: 3-point click
    if (activeTool === "angle") {
      const next = [...anglePoints, p];
      if (next.length === 3) {
        const angleDeg = calculateAngle(next[0], next[1], next[2]);
        const ann: ViewerAnnotation = {
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          studyId,
          seriesId,
          sliceIndex,
          type: "angle",
          points: next,
          color: brushColor,
          strokeWidth: brushSize,
          opacity: brushOpacity,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          visible: true,
          findingType: activeFindingType,
          finding: activeCustomLabel || `${activeFindingType} Angle`,
          label: activeCustomLabel || `${activeFindingType} Angle`,
          measureValue: `${angleDeg}°`,
          imageCoordinates: { x: next[1].x, y: next[1].y },
        };
        onCommitAnnotation?.(ann);
        onSelect(ann.id);
        setAnglePoints([]);
      } else {
        setAnglePoints(next);
      }
      return;
    }

    // Drag-based tools: pen, line, rect, circle, arrow, measure
    pointerActive.current = true;
    drawingPoints.current = [p];
    setLivePoints([p]);
    setIsDrawing(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    const p = getRelative(e);
    setMousePos(p);

    if (!pointerActive.current) return;
    e.stopPropagation();

    if (activeTool === "pen") {
      const last = drawingPoints.current[drawingPoints.current.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.003) {
        drawingPoints.current.push(p);
        if (livePathRef.current) {
          livePathRef.current.setAttribute("d", pointsToPathD(drawingPoints.current));
        }
      }
    } else {
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
        const c = centroid(pts);
        const areaResult = calculatePolygonArea(pts, pixelSpacing);
        const ann: ViewerAnnotation = {
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          studyId,
          seriesId,
          sliceIndex,
          type: "freehand",
          points: pts,
          color: brushColor,
          strokeWidth: brushSize,
          opacity: brushOpacity,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          visible: true,
          findingType: activeFindingType,
          finding: activeCustomLabel || `${activeFindingType} Contour`,
          label: activeCustomLabel || `${activeFindingType} Contour`,
          measureValue: pts.length > 5 ? areaResult.text : undefined,
          measurement: pts.length > 5 ? { area: areaResult.area, unit: areaResult.unit } : undefined,
          imageCoordinates: { x: c.x, y: c.y },
        };
        if (onCommitAnnotation) {
          onCommitAnnotation(ann);
        } else {
          onCommitStroke(pts);
        }
        onSelect(ann.id);
      }
      drawingPoints.current = [];
      setLivePoints([]);
      if (livePathRef.current) livePathRef.current.setAttribute("d", "");
      return;
    }

    if (pts.length > 0) {
      const start = pts[0];
      const dist = Math.hypot(endPoint.x - start.x, endPoint.y - start.y);

      // Click without drag: hit-test existing annotations
      if (dist < 0.015) {
        let bestId: string | null = null;
        let bestDist = SELECT_HIT_DISTANCE;
        for (const ann of annotations) {
          if (ann.visible === false) continue;
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

      // Shape tools commit
      let shapeType: AnnotationShape = "line";
      let measureVal: string | undefined = undefined;
      let measureObj: { distance?: number; area?: number; unit?: string } | undefined = undefined;

      if (activeTool === "measure" || activeTool === "line") {
        shapeType = "line";
        const res = calculateDistance(start, endPoint, pixelSpacing);
        measureVal = res.text;
        measureObj = { distance: res.mm || res.px, unit: pixelSpacing ? "mm" : "px" };
      } else if (activeTool === "arrow") {
        shapeType = "arrow";
      } else if (activeTool === "rect") {
        shapeType = "rectangle";
        const res = calculateRectArea(start, endPoint, pixelSpacing);
        measureVal = res.text;
        measureObj = { area: res.area, unit: res.unit };
      } else if (activeTool === "circle") {
        shapeType = "circle";
        const res = calculateCircleArea(start, endPoint, pixelSpacing);
        measureVal = res.text;
        measureObj = { area: res.area, unit: res.unit };
      }

      const c = { x: (start.x + endPoint.x) / 2, y: (start.y + endPoint.y) / 2 };

      const ann: ViewerAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        studyId,
        seriesId,
        sliceIndex,
        type: shapeType,
        points: [start, endPoint],
        color: brushColor,
        strokeWidth: brushSize,
        opacity: brushOpacity,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        visible: true,
        findingType: activeFindingType,
        finding: activeCustomLabel || `${activeFindingType} ROI`,
        label: activeCustomLabel || `${activeFindingType} ROI`,
        measureValue: measureVal,
        measurement: measureObj,
        imageCoordinates: c,
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
        studyId,
        seriesId,
        sliceIndex,
        type: "text",
        points: [textInputPos],
        color: brushColor,
        strokeWidth: brushSize,
        opacity: brushOpacity,
        text: textInputValue.trim(),
        findingType: activeFindingType,
        finding: textInputValue.trim(),
        label: textInputValue.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        visible: true,
        imageCoordinates: { x: textInputPos.x, y: textInputPos.y },
      };
      onCommitAnnotation?.(ann);
      onSelect(ann.id);
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
      onDoubleClick={() => {
        if (activeTool === "polygon" && polygonPoints.length >= 3) {
          commitPolygon(polygonPoints);
        }
      }}
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
          if (ann.visible === false) return null;
          const isSelected = ann.id === selectedId;
          const isEmphasized = ann.id === emphasizedId;
          const color = ann.color || brushColor;
          const width = ann.strokeWidth || brushSize;
          const opacity = ann.opacity ?? 1;

          // Freehand Contour
          if (ann.type === "freehand") {
            const d = pointsToPathD(ann.points);
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <path
                    d={d}
                    fill="none"
                    stroke="#00F0FF"
                    strokeWidth={width + 3.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                    className={isEmphasized ? "animate-pulse" : undefined}
                  />
                )}
                <path
                  d={d}
                  fill={color}
                  fillOpacity={isSelected ? 0.22 : 0.12}
                  stroke={color}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={opacity}
                  vectorEffect="non-scaling-stroke"
                />
                {ann.measureValue && (
                  <text
                    x={centroid(ann.points).x * 100}
                    y={centroid(ann.points).y * 100 - 1.5}
                    fill={color}
                    fontSize="2.8"
                    textAnchor="middle"
                    className="font-mono font-bold"
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          // Polygon ROI
          if (ann.type === "polygon") {
            const ptsStr = ann.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
            const c = centroid(ann.points);
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <polygon
                    points={ptsStr}
                    fill="none"
                    stroke="#00F0FF"
                    strokeWidth={width + 3.5}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                    className={isEmphasized ? "animate-pulse" : undefined}
                  />
                )}
                <polygon
                  points={ptsStr}
                  fill={color}
                  fillOpacity={isSelected ? 0.24 : 0.14}
                  stroke={color}
                  strokeWidth={width}
                  strokeOpacity={opacity}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Vertex handles */}
                {isSelected &&
                  ann.points.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x * 100}
                      cy={pt.y * 100}
                      r={0.9}
                      fill="#FFFFFF"
                      stroke={color}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                {ann.measureValue && (
                  <text
                    x={c.x * 100}
                    y={c.y * 100 - 1.2}
                    fill={color}
                    fontSize="2.8"
                    textAnchor="middle"
                    className="font-mono font-bold"
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.label ? `${ann.label}: ` : "ROI: "}
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          // Line / Distance Measurement
          if (ann.type === "line" || ann.type === "measurement") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <line
                    x1={p0.x * 100}
                    y1={p0.y * 100}
                    x2={p1.x * 100}
                    y2={p1.y * 100}
                    stroke="#00F0FF"
                    strokeWidth={width + 3.5}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                    className={isEmphasized ? "animate-pulse" : undefined}
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
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          // Arrow Pointer
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

          // Rectangle / Bounding Box ROI
          if (ann.type === "rectangle") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            const x = Math.min(p0.x, p1.x) * 100;
            const y = Math.min(p0.y, p1.y) * 100;
            const w = Math.abs(p1.x - p0.x) * 100;
            const h = Math.abs(p1.y - p0.y) * 100;
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill="none"
                    stroke="#00F0FF"
                    strokeWidth={width + 3.5}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                    className={isEmphasized ? "animate-pulse" : undefined}
                  />
                )}
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={color}
                  fillOpacity={isSelected ? 0.22 : 0.12}
                  stroke={color}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Corner reticle marks */}
                <line x1={x} y1={y} x2={x + Math.min(3, w * 0.3)} y2={y} stroke={color} strokeWidth={width + 0.5} vectorEffect="non-scaling-stroke" />
                <line x1={x} y1={y} x2={x} y2={y + Math.min(3, h * 0.3)} stroke={color} strokeWidth={width + 0.5} vectorEffect="non-scaling-stroke" />
                <line x1={x + w} y1={y + h} x2={x + w - Math.min(3, w * 0.3)} y2={y + h} stroke={color} strokeWidth={width + 0.5} vectorEffect="non-scaling-stroke" />
                <line x1={x + w} y1={y + h} x2={x + w} y2={y + h - Math.min(3, h * 0.3)} stroke={color} strokeWidth={width + 0.5} vectorEffect="non-scaling-stroke" />

                {ann.measureValue && (
                  <text
                    x={x}
                    y={y - 1.2}
                    fill={color}
                    fontSize="2.8"
                    className="font-mono font-bold"
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.label ? `${ann.label}: ` : "ROI: "}
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          // Circle / Ellipse ROI
          if (ann.type === "circle") {
            const [p0, p1] = ann.points;
            if (!p0 || !p1) return null;
            const cx = p0.x * 100;
            const cy = p0.y * 100;
            const r = Math.hypot((p1.x - p0.x) * 100, (p1.y - p0.y) * 100);
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke="#00F0FF"
                    strokeWidth={width + 3.5}
                    opacity={0.5}
                    vectorEffect="non-scaling-stroke"
                    className={isEmphasized ? "animate-pulse" : undefined}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={color}
                  fillOpacity={isSelected ? 0.22 : 0.12}
                  stroke={color}
                  strokeWidth={width}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Center crosshair */}
                <circle cx={cx} cy={cy} r={0.7} fill={color} />
                {ann.measureValue && (
                  <text
                    x={cx - r}
                    y={cy - r - 1.2}
                    fill={color}
                    fontSize="2.8"
                    className="font-mono font-bold"
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.label ? `${ann.label}: ` : "ROI: "}
                    {ann.measureValue}
                  </text>
                )}
              </g>
            );
          }

          // Point Marker / Calibrated Pin
          if (ann.type === "marker" || ann.type === "point") {
            const [p0] = ann.points;
            if (!p0) return null;
            const cx = p0.x * 100;
            const cy = p0.y * 100;
            return (
              <g key={ann.id}>
                {(isSelected || isEmphasized) && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={2.8}
                    fill="none"
                    stroke="#00F0FF"
                    strokeWidth={1.5}
                    className={isEmphasized ? "animate-pulse" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {/* Target reticle crosshairs */}
                <circle cx={cx} cy={cy} r={1.6} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <circle cx={cx} cy={cy} r={0.6} fill={color} />
                <line x1={cx - 2.5} y1={cy} x2={cx + 2.5} y2={cy} stroke={color} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                <line x1={cx} y1={cy - 2.5} x2={cx} y2={cy + 2.5} stroke={color} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                {ann.label && (
                  <text
                    x={cx + 3.2}
                    y={cy + 1}
                    fill={color}
                    fontSize="2.7"
                    className="font-mono font-bold"
                    style={{ textShadow: "0 1px 2px #000" }}
                  >
                    {ann.label}
                  </text>
                )}
              </g>
            );
          }

          // Text Label
          if (ann.type === "text") {
            const [p0] = ann.points;
            if (!p0) return null;
            return (
              <g key={ann.id}>
                <text
                  x={p0.x * 100}
                  y={p0.y * 100}
                  fill={color}
                  fontSize="3.2"
                  fontWeight="bold"
                  className="font-sans select-none"
                  style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)" }}
                >
                  {ann.text || ann.label}
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

        {/* Live in-progress shape (rect, circle, line) */}
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
                r={Math.hypot(
                  (livePoints[1].x - livePoints[0].x) * 100,
                  (livePoints[1].y - livePoints[0].y) * 100
                )}
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

        {/* Live in-progress polygon vertices and rubberband line */}
        {polygonPoints.length > 0 && (
          <g>
            <polyline
              points={polygonPoints.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
              fill="none"
              stroke={brushColor}
              strokeWidth={brushSize}
              vectorEffect="non-scaling-stroke"
            />
            {mousePos && (
              <line
                x1={polygonPoints[polygonPoints.length - 1].x * 100}
                y1={polygonPoints[polygonPoints.length - 1].y * 100}
                x2={mousePos.x * 100}
                y2={mousePos.y * 100}
                stroke={brushColor}
                strokeWidth={brushSize}
                strokeDasharray="2,2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {polygonPoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x * 100}
                cy={pt.y * 100}
                r={i === 0 ? 1.6 : 1.1}
                fill={i === 0 ? "#00F0FF" : brushColor}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Polygon In-Progress Clinical Helper Badge */}
      {polygonPoints.length > 0 && (
        <div className="pointer-events-none absolute top-2 left-2 z-40 flex items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-[#0d121c]/90 px-2.5 py-1 text-[11px] font-mono text-cyan-300 shadow-xl backdrop-blur-md">
          <Layers className="h-3.5 w-3.5 text-cyan-400" />
          <span>Polygon ROI ({polygonPoints.length} vertices)</span>
          <span className="text-slate-400">· Click start point or press Enter to close</span>
        </div>
      )}

      {/* Inline Text Input for Text Tool */}
      {textInputPos && (
        <div
          className="absolute z-40 -translate-x-2 -translate-y-4 rounded-lg border border-cyan-400 bg-[#0d121c]/95 p-1.5 shadow-2xl backdrop-blur-md pointer-events-auto"
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
              placeholder={`Annotation label… (${activeFindingType})`}
              className="w-44 rounded border border-[#1e293b] bg-[#111827] px-2 py-1 text-[11.5px] text-white outline-none focus:border-cyan-400 font-sans"
            />
            <button
              onClick={handleCommitText}
              className="rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 cursor-pointer"
            >
              Add
            </button>
            <button
              onClick={() => setTextInputPos(null)}
              className="rounded p-1 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Popover for selected annotation */}
      {selected && centerPos && (
        <div
          className="absolute z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-lg border border-cyan-400/80 bg-[#0d121c]/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md pointer-events-auto select-none"
          style={{
            left: `${centerPos.x * 100}%`,
            top: `${Math.max(0.04, centerPos.y - 0.02) * 100}%`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Finding Badge */}
          <div className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
            <span className="font-mono text-[10.5px] text-cyan-300 font-bold uppercase">
              {selected.finding || selected.findingType || selected.type}
            </span>
            {selected.measureValue && (
              <span className="font-mono text-[10px] text-slate-300 font-medium">
                ({selected.measureValue})
              </span>
            )}
          </div>

          <div className="mx-1 h-3.5 w-px bg-[#1e293b]" />

          {/* Note Quick View / Edit */}
          {editingNoteId === selected.id ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                value={noteInputValue}
                onChange={(e) => setNoteInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onQuickNote(selected.id, noteInputValue);
                    setEditingNoteId(null);
                  }
                  if (e.key === "Escape") setEditingNoteId(null);
                }}
                className="w-28 rounded bg-[#111827] px-1.5 py-0.5 text-[10.5px] text-white outline-none border border-cyan-400"
              />
              <button
                onClick={() => {
                  onQuickNote(selected.id, noteInputValue);
                  setEditingNoteId(null);
                }}
                className="rounded bg-sky-600 px-1 py-0.5 text-[9.5px] text-white"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditingNoteId(selected.id);
                setNoteInputValue(selected.radiologistNote || "");
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white hover:bg-[#1e293b]"
              title="Add radiologist note"
            >
              {selected.radiologistNote ? `"${selected.radiologistNote}"` : "+ Note"}
            </button>
          )}

          {/* Finding Promotion */}
          {selected.findingId ? (
            <button
              onClick={() => onEditFinding(selected.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-950/60"
              title="Edit formal finding"
            >
              <FileText className="h-3 w-3" />
              <span>Finding</span>
            </button>
          ) : (
            <button
              onClick={() => onAddFinding(selected.id)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white hover:bg-[#1e293b]"
              title="Promote to formal diagnostic finding"
            >
              <FileText className="h-3 w-3" />
              <span>+ Finding</span>
            </button>
          )}

          {/* View in 3D Action */}
          {onViewIn3D && (
            <button
              onClick={() => onViewIn3D(selected.id)}
              className="flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-950/60 hover:bg-cyan-800/80 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 transition-colors"
              title="Highlight this region in 3D Anatomy"
            >
              <Box className="h-3 w-3 text-cyan-300" />
              <span>View in 3D</span>
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => onDeleteAnnotation(selected.id)}
            className="rounded p-1 text-slate-400 hover:text-rose-400 transition-colors"
            title="Delete annotation"
          >
            <Trash2 className="h-3 w-3" />
          </button>

          {/* Deselect */}
          <button
            onClick={() => onSelect(null)}
            className="rounded p-1 text-slate-400 hover:text-white"
            title="Deselect"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
