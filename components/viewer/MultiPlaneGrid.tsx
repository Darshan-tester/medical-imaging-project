"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Maximize2,
  Minimize2,
  ChevronDown,
  Layers,
  Box,
  Square,
  Crosshair,
} from "lucide-react";
import { Study, SeriesInfo, ViewportLayout, Finding, Marker, ViewerMeasurement, ViewerAnnotation, Annotation3D } from "@/lib/types";
import { ImageViewer } from "./ImageViewer";
import { ViewerState } from "./ViewerToolbar";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { cn } from "@/lib/utils";
import { OrganMeshState } from "./AIAnalysisPanel";

const Volume3DViewer = dynamic(() => import("./Volume3DViewer").then((m) => m.Volume3DViewer), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-black" />,
});

export type PanelPlaneType = "Axial" | "Sagittal" | "Coronal" | "3D" | string;

export interface ViewportPanelConfig {
  id: string;
  seriesId: string;
  planeType: PanelPlaneType;
  sliceIndex: number;
  viewerState: ViewerState;
}

export function MultiPlaneGrid({
  study,
  layout,
  globalViewerState,
  findings,
  activeFindingId,
  onHoverFinding,
  onSelectFinding,
  markers,
  onAddMarker,
  measurements,
  onAddMeasurement,
  annotations,
  onCommitAnnotation,
  onDeleteAnnotation,
  onQuickAnnotationNote,
  onAddFinding,
  onEditFinding,
  annotations3D,
  onAnnotations3DChange,
  getImageUrl,
  organMeshes,
  onOrganMeshesChange,
}: {
  study: Study;
  layout: ViewportLayout;
  globalViewerState: ViewerState;
  findings: Finding[];
  activeFindingId: string | null;
  onHoverFinding: (id: string | null) => void;
  onSelectFinding: (id: string) => void;
  markers: Marker[];
  onAddMarker: (m: { id: string; x: number; y: number; seriesId: string; sliceIndex: number }) => void;
  measurements: ViewerMeasurement[];
  onAddMeasurement: (m: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; distancePx: number; seriesId: string; sliceIndex: number }) => void;
  annotations: ViewerAnnotation[];
  onCommitAnnotation: (ann: ViewerAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onQuickAnnotationNote: (id: string, note: string) => void;
  onAddFinding: (id: string) => void;
  onEditFinding: (id: string) => void;
  annotations3D: Annotation3D[];
  onAnnotations3DChange: (anns: Annotation3D[]) => void;
  getImageUrl: (series: SeriesInfo, sliceIndex: number) => string | undefined;
  organMeshes?: OrganMeshState[];
  onOrganMeshesChange?: (meshes: OrganMeshState[]) => void;
}) {
  // Find series matching planes if available
  const axialSeries = useMemo(
    () => study.series.find((s) => s.orientation === "Axial") ?? study.series[0],
    [study.series]
  );
  const sagittalSeries = useMemo(
    () => study.series.find((s) => s.orientation === "Sagittal") ?? study.series[1] ?? study.series[0],
    [study.series]
  );
  const coronalSeries = useMemo(
    () => study.series.find((s) => s.orientation === "Coronal") ?? study.series[2] ?? study.series[0],
    [study.series]
  );
  const volumeSeries = useMemo(
    () => study.series.find((s) => s.volumeAvailable) ?? study.series[0],
    [study.series]
  );

  // Initial 4 panels config
  const [panels, setPanels] = useState<ViewportPanelConfig[]>([
    {
      id: "panel-0",
      seriesId: axialSeries?.id ?? "",
      planeType: "Axial",
      sliceIndex: Math.floor((axialSeries?.sliceCount ?? 1) / 2),
      viewerState: { ...globalViewerState },
    },
    {
      id: "panel-1",
      seriesId: sagittalSeries?.id ?? "",
      planeType: "Sagittal",
      sliceIndex: Math.floor((sagittalSeries?.sliceCount ?? 1) / 2),
      viewerState: { ...globalViewerState },
    },
    {
      id: "panel-2",
      seriesId: coronalSeries?.id ?? "",
      planeType: "Coronal",
      sliceIndex: Math.floor((coronalSeries?.sliceCount ?? 1) / 2),
      viewerState: { ...globalViewerState },
    },
    {
      id: "panel-3",
      seriesId: volumeSeries?.id ?? "",
      planeType: "3D",
      sliceIndex: 0,
      viewerState: { ...globalViewerState },
    },
  ]);

  // Keep panels synced with series if study changes
  useEffect(() => {
    setPanels([
      {
        id: "panel-0",
        seriesId: axialSeries?.id ?? "",
        planeType: "Axial",
        sliceIndex: Math.floor((axialSeries?.sliceCount ?? 1) / 2),
        viewerState: { ...globalViewerState },
      },
      {
        id: "panel-1",
        seriesId: sagittalSeries?.id ?? "",
        planeType: "Sagittal",
        sliceIndex: Math.floor((sagittalSeries?.sliceCount ?? 1) / 2),
        viewerState: { ...globalViewerState },
      },
      {
        id: "panel-2",
        seriesId: coronalSeries?.id ?? "",
        planeType: "Coronal",
        sliceIndex: Math.floor((coronalSeries?.sliceCount ?? 1) / 2),
        viewerState: { ...globalViewerState },
      },
      {
        id: "panel-3",
        seriesId: volumeSeries?.id ?? "",
        planeType: "3D",
        sliceIndex: 0,
        viewerState: { ...globalViewerState },
      },
    ]);
  }, [study.id, axialSeries?.id, sagittalSeries?.id, coronalSeries?.id, volumeSeries?.id]);

  // Sync tool & W/L updates from global state to all panels
  useEffect(() => {
    setPanels((prev) =>
      prev.map((p) => ({
        ...p,
        viewerState: {
          ...p.viewerState,
          tool: globalViewerState.tool,
          brightness: globalViewerState.brightness,
          contrast: globalViewerState.contrast,
          windowWidth: globalViewerState.windowWidth,
          windowCenter: globalViewerState.windowCenter,
          inverted: globalViewerState.inverted,
          crosshairSync: globalViewerState.crosshairSync,
        },
      }))
    );
  }, [
    globalViewerState.tool,
    globalViewerState.brightness,
    globalViewerState.contrast,
    globalViewerState.windowWidth,
    globalViewerState.windowCenter,
    globalViewerState.inverted,
    globalViewerState.crosshairSync,
  ]);

  // Single panel maximization
  const [maximizedPanelId, setMaximizedPanelId] = useState<string | null>(null);

  // Resizable split proportions (percentages 0-100)
  const [splitX, setSplitX] = useState(50);
  const [splitY, setSplitY] = useState(50);
  const isDraggingSplit = useRef<"x" | "y" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Global Crosshair Point in normalized patient space (0..1)
  const [crosshairNorm, setCrosshairNorm] = useState<{ x: number; y: number; z: number }>({
    x: 0.5,
    y: 0.5,
    z: 0.5,
  });

  const handleCrosshairMoveFromPlane = (plane: PanelPlaneType, point: { x: number; y: number }) => {
    let nextX = crosshairNorm.x;
    let nextY = crosshairNorm.y;
    let nextZ = crosshairNorm.z;

    if (plane === "Axial") {
      nextX = point.x;
      nextY = point.y;
    } else if (plane === "Coronal") {
      nextX = point.x;
      nextZ = point.y;
    } else if (plane === "Sagittal") {
      nextY = point.x;
      nextZ = point.y;
    }

    setCrosshairNorm({ x: nextX, y: nextY, z: nextZ });

    // Synchronize slices across other planes, returning currPanels if unchanged to prevent re-render storms
    setPanels((currPanels) => {
      let changed = false;
      const nextPanels = currPanels.map((p) => {
        const s = study.series.find((sr) => sr.id === p.seriesId);
        if (!s || s.sliceCount <= 1) return p;

        let targetSlice = p.sliceIndex;
        if (p.planeType === "Axial" && plane !== "Axial") {
          targetSlice = Math.max(0, Math.min(s.sliceCount - 1, Math.round(nextZ * (s.sliceCount - 1))));
        } else if (p.planeType === "Coronal" && plane !== "Coronal") {
          targetSlice = Math.max(0, Math.min(s.sliceCount - 1, Math.round(nextY * (s.sliceCount - 1))));
        } else if (p.planeType === "Sagittal" && plane !== "Sagittal") {
          targetSlice = Math.max(0, Math.min(s.sliceCount - 1, Math.round(nextX * (s.sliceCount - 1))));
        }

        if (targetSlice !== p.sliceIndex) {
          changed = true;
          return { ...p, sliceIndex: targetSlice };
        }
        return p;
      });

      return changed ? nextPanels : currPanels;
    });
  };

  // Resizing dividers
  const onDividerMouseDown = (axis: "x" | "y") => (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplit.current = axis;
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingSplit.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (isDraggingSplit.current === "x") {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitX(Math.max(20, Math.min(80, Math.round(pct))));
    } else if (isDraggingSplit.current === "y") {
      const pct = ((e.clientY - rect.top) / rect.height) * 100;
      setSplitY(Math.max(20, Math.min(80, Math.round(pct))));
    }
  }, []);

  const onMouseUp = useCallback(() => {
    isDraggingSplit.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Determine active visible panels count based on layout
  const visiblePanels = useMemo(() => {
    if (maximizedPanelId) {
      return panels.filter((p) => p.id === maximizedPanelId);
    }
    switch (layout) {
      case "1x1":
        return [panels[0]];
      case "1x2":
        return [panels[0], panels[1]];
      case "2x1":
        return [panels[0], panels[2]];
      case "1+2":
        return [panels[0], panels[1], panels[2]];
      case "mpr-3d":
      case "2x2":
      default:
        return panels;
    }
  }, [layout, panels, maximizedPanelId]);

  const updatePanelState = (panelId: string, updater: (prev: ViewerState) => ViewerState) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === panelId ? { ...p, viewerState: updater(p.viewerState) } : p))
    );
  };

  const updatePanelSlice = (panelId: string, sliceDelta: number) => {
    const targetPanel = panels.find((p) => p.id === panelId);
    if (!targetPanel) return;
    const s = study.series.find((sr) => sr.id === targetPanel.seriesId);
    if (!s || s.sliceCount <= 1) return;

    const nextSlice = Math.max(0, Math.min(s.sliceCount - 1, targetPanel.sliceIndex + sliceDelta));
    if (nextSlice === targetPanel.sliceIndex) return;

    const norm = nextSlice / Math.max(1, s.sliceCount - 1);
    let nextX = crosshairNorm.x;
    let nextY = crosshairNorm.y;
    let nextZ = crosshairNorm.z;

    if (targetPanel.planeType === "Axial") {
      nextZ = norm;
    } else if (targetPanel.planeType === "Coronal") {
      nextY = norm;
    } else if (targetPanel.planeType === "Sagittal") {
      nextX = norm;
    }

    setCrosshairNorm({ x: nextX, y: nextY, z: nextZ });

    setPanels((prev) =>
      prev.map((p) => {
        if (p.id === panelId) {
          return { ...p, sliceIndex: nextSlice };
        }
        const ps = study.series.find((sr) => sr.id === p.seriesId);
        if (!ps || ps.sliceCount <= 1) return p;

        let targetSyncSlice = p.sliceIndex;
        if (p.planeType === "Axial" && targetPanel.planeType !== "Axial") {
          targetSyncSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextZ * (ps.sliceCount - 1))));
        } else if (p.planeType === "Coronal" && targetPanel.planeType !== "Coronal") {
          targetSyncSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextY * (ps.sliceCount - 1))));
        } else if (p.planeType === "Sagittal" && targetPanel.planeType !== "Sagittal") {
          targetSyncSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextX * (ps.sliceCount - 1))));
        }
        return targetSyncSlice !== p.sliceIndex ? { ...p, sliceIndex: targetSyncSlice } : p;
      })
    );
  };

  const handle3DPointSelected = (pt: { x: number; y: number; z: number }) => {
    const nextX = Math.max(0, Math.min(1, pt.x));
    const nextY = Math.max(0, Math.min(1, pt.y));
    const nextZ = Math.max(0, Math.min(1, pt.z));
    setCrosshairNorm({ x: nextX, y: nextY, z: nextZ });

    setPanels((prev) =>
      prev.map((p) => {
        const ps = study.series.find((sr) => sr.id === p.seriesId);
        if (!ps || ps.sliceCount <= 1) return p;

        let targetSlice = p.sliceIndex;
        if (p.planeType === "Axial") {
          targetSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextZ * (ps.sliceCount - 1))));
        } else if (p.planeType === "Coronal") {
          targetSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextY * (ps.sliceCount - 1))));
        } else if (p.planeType === "Sagittal") {
          targetSlice = Math.max(0, Math.min(ps.sliceCount - 1, Math.round(nextX * (ps.sliceCount - 1))));
        }
        return targetSlice !== p.sliceIndex ? { ...p, sliceIndex: targetSlice } : p;
      })
    );
  };

  const switchPanelSeries = (panelId: string, seriesId: string, planeType: PanelPlaneType) => {
    const s = study.series.find((sr) => sr.id === seriesId);
    setPanels((prev) =>
      prev.map((p) =>
        p.id === panelId
          ? {
              ...p,
              seriesId,
              planeType,
              sliceIndex: s ? Math.floor(s.sliceCount / 2) : 0,
            }
          : p
      )
    );
  };

  return (
    <div ref={containerRef} className="relative h-full w-full select-none overflow-hidden rounded-lg bg-black">
      {/* 1x1 Single View */}
      {(layout === "1x1" || maximizedPanelId) && visiblePanels[0] && (
        <div className="h-full w-full">
          <SingleViewportPanel
            panel={visiblePanels[0]}
            study={study}
            isMaximized={Boolean(maximizedPanelId)}
            onToggleMaximize={() => setMaximizedPanelId(maximizedPanelId ? null : visiblePanels[0].id)}
            onUpdateState={(u) => updatePanelState(visiblePanels[0].id, u)}
            onSliceScroll={(d) => updatePanelSlice(visiblePanels[0].id, d)}
            onSwitchSeries={(sId, pType) => switchPanelSeries(visiblePanels[0].id, sId, pType)}
            crosshairPos={
              visiblePanels[0].planeType === "Axial"
                ? { x: crosshairNorm.x, y: crosshairNorm.y }
                : visiblePanels[0].planeType === "Coronal"
                ? { x: crosshairNorm.x, y: crosshairNorm.z }
                : { x: crosshairNorm.y, y: crosshairNorm.z }
            }
            onCrosshairMove={(pt) => handleCrosshairMoveFromPlane(visiblePanels[0].planeType, pt)}
            getImageUrl={getImageUrl}
            findings={findings}
            activeFindingId={activeFindingId}
            onHoverFinding={onHoverFinding}
            onSelectFinding={onSelectFinding}
            markers={markers}
            onAddMarker={onAddMarker}
            measurements={measurements}
            onAddMeasurement={onAddMeasurement}
            annotations={annotations}
            onCommitAnnotation={onCommitAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onQuickAnnotationNote={onQuickAnnotationNote}
            onAddFinding={onAddFinding}
            onEditFinding={onEditFinding}
            annotations3D={annotations3D}
            onAnnotations3DChange={onAnnotations3DChange}
          />
        </div>
      )}

      {/* 1x2 Side by Side */}
      {layout === "1x2" && !maximizedPanelId && (
        <div className="relative flex h-full w-full">
          <div style={{ width: `${splitX}%` }} className="h-full">
            <SingleViewportPanel
              panel={panels[0]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[0].id)}
              onUpdateState={(u) => updatePanelState(panels[0].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[0].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[0].id, sId, pType)}
              crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.y }}
              onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Axial", pt)}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
          {/* Vertical Divider */}
          <div
            onMouseDown={onDividerMouseDown("x")}
            className="w-1.5 cursor-col-resize bg-border-strong hover:bg-clinical transition-colors z-20"
          />
          <div style={{ width: `${100 - splitX}%` }} className="h-full">
            <SingleViewportPanel
              panel={panels[1]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[1].id)}
              onUpdateState={(u) => updatePanelState(panels[1].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[1].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[1].id, sId, pType)}
              crosshairPos={{ x: crosshairNorm.y, y: crosshairNorm.z }}
              onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Sagittal", pt)}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
        </div>
      )}

      {/* 2x1 Stacked */}
      {layout === "2x1" && !maximizedPanelId && (
        <div className="relative flex flex-col h-full w-full">
          <div style={{ height: `${splitY}%` }} className="w-full">
            <SingleViewportPanel
              panel={panels[0]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[0].id)}
              onUpdateState={(u) => updatePanelState(panels[0].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[0].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[0].id, sId, pType)}
              crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.y }}
              onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Axial", pt)}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
          {/* Horizontal Divider */}
          <div
            onMouseDown={onDividerMouseDown("y")}
            className="h-1.5 cursor-row-resize bg-border-strong hover:bg-clinical transition-colors z-20"
          />
          <div style={{ height: `${100 - splitY}%` }} className="w-full">
            <SingleViewportPanel
              panel={panels[2]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[2].id)}
              onUpdateState={(u) => updatePanelState(panels[2].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[2].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[2].id, sId, pType)}
              crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.z }}
              onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Coronal", pt)}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
        </div>
      )}

      {/* 2x2 4-Panel Quad View */}
      {layout === "2x2" && !maximizedPanelId && (
        <div className="relative flex flex-col h-full w-full">
          {/* Top Row: Axial & Sagittal */}
          <div style={{ height: `${splitY}%` }} className="flex w-full">
            <div style={{ width: `${splitX}%` }} className="h-full">
              <SingleViewportPanel
                panel={panels[0]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[0].id)}
                onUpdateState={(u) => updatePanelState(panels[0].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[0].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[0].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.y }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Axial", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
            <div
              onMouseDown={onDividerMouseDown("x")}
              className="w-1.5 cursor-col-resize bg-border-strong hover:bg-clinical transition-colors z-20"
            />
            <div style={{ width: `${100 - splitX}%` }} className="h-full">
              <SingleViewportPanel
                panel={panels[1]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[1].id)}
                onUpdateState={(u) => updatePanelState(panels[1].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[1].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[1].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.y, y: crosshairNorm.z }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Sagittal", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
          </div>

          {/* Center Horizontal Divider */}
          <div
            onMouseDown={onDividerMouseDown("y")}
            className="h-1.5 cursor-row-resize bg-border-strong hover:bg-clinical transition-colors z-20"
          />

          {/* Bottom Row: Coronal & 3D */}
          <div style={{ height: `${100 - splitY}%` }} className="flex w-full">
            <div style={{ width: `${splitX}%` }} className="h-full">
              <SingleViewportPanel
                panel={panels[2]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[2].id)}
                onUpdateState={(u) => updatePanelState(panels[2].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[2].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[2].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.z }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Coronal", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
            <div
              onMouseDown={onDividerMouseDown("x")}
              className="w-1.5 cursor-col-resize bg-border-strong hover:bg-clinical transition-colors z-20"
            />
            <div style={{ width: `${100 - splitX}%` }} className="h-full">
              <SingleViewportPanel
                panel={panels[3]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[3].id)}
                onUpdateState={(u) => updatePanelState(panels[3].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[3].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[3].id, sId, pType)}
                crosshairPos={crosshairNorm}
                onCrosshairMove={() => {}}
                onPointSelected={handle3DPointSelected}
                organMeshes={organMeshes}
                onOrganMeshesChange={onOrganMeshesChange}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
          </div>
        </div>
      )}

      {/* 1+2 Layout */}
      {layout === "1+2" && !maximizedPanelId && (
        <div className="relative flex h-full w-full">
          <div style={{ width: `${splitX}%` }} className="h-full">
            <SingleViewportPanel
              panel={panels[0]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[0].id)}
              onUpdateState={(u) => updatePanelState(panels[0].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[0].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[0].id, sId, pType)}
              crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.y }}
              onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Axial", pt)}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
          <div
            onMouseDown={onDividerMouseDown("x")}
            className="w-1.5 cursor-col-resize bg-border-strong hover:bg-clinical transition-colors z-20"
          />
          <div style={{ width: `${100 - splitX}%` }} className="flex flex-col h-full">
            <div style={{ height: `${splitY}%` }} className="w-full">
              <SingleViewportPanel
                panel={panels[1]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[1].id)}
                onUpdateState={(u) => updatePanelState(panels[1].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[1].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[1].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.y, y: crosshairNorm.z }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Sagittal", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
            <div
              onMouseDown={onDividerMouseDown("y")}
              className="h-1.5 cursor-row-resize bg-border-strong hover:bg-clinical transition-colors z-20"
            />
            <div style={{ height: `${100 - splitY}%` }} className="w-full">
              <SingleViewportPanel
                panel={panels[2]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[2].id)}
                onUpdateState={(u) => updatePanelState(panels[2].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[2].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[2].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.z }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Coronal", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>
          </div>
        </div>
      )}

      {/* MPR + 3D Section 9 Diagnostic Layout (Axial top, Coronal + Sagittal bottom, Patient 3D right full-height) */}
      {layout === "mpr-3d" && !maximizedPanelId && (
        <div className="relative flex h-full w-full">
          {/* Left Column: 2D Orthogonal MPR Views */}
          <div style={{ width: `${splitX}%` }} className="flex flex-col h-full">
            {/* Top Row: Axial */}
            <div style={{ height: `${splitY}%` }} className="w-full">
              <SingleViewportPanel
                panel={panels[0]}
                study={study}
                isMaximized={false}
                onToggleMaximize={() => setMaximizedPanelId(panels[0].id)}
                onUpdateState={(u) => updatePanelState(panels[0].id, u)}
                onSliceScroll={(d) => updatePanelSlice(panels[0].id, d)}
                onSwitchSeries={(sId, pType) => switchPanelSeries(panels[0].id, sId, pType)}
                crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.y }}
                onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Axial", pt)}
                getImageUrl={getImageUrl}
                findings={findings}
                activeFindingId={activeFindingId}
                onHoverFinding={onHoverFinding}
                onSelectFinding={onSelectFinding}
                markers={markers}
                onAddMarker={onAddMarker}
                measurements={measurements}
                onAddMeasurement={onAddMeasurement}
                annotations={annotations}
                onCommitAnnotation={onCommitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onQuickAnnotationNote={onQuickAnnotationNote}
                onAddFinding={onAddFinding}
                onEditFinding={onEditFinding}
                annotations3D={annotations3D}
                onAnnotations3DChange={onAnnotations3DChange}
              />
            </div>

            {/* Horizontal Divider */}
            <div
              onMouseDown={onDividerMouseDown("y")}
              className="h-1.5 cursor-row-resize bg-border-strong hover:bg-clinical transition-colors z-20"
            />

            {/* Bottom Row: Coronal (left) & Sagittal (right) */}
            <div style={{ height: `${100 - splitY}%` }} className="flex w-full">
              <div className="w-1/2 h-full">
                <SingleViewportPanel
                  panel={panels[2]}
                  study={study}
                  isMaximized={false}
                  onToggleMaximize={() => setMaximizedPanelId(panels[2].id)}
                  onUpdateState={(u) => updatePanelState(panels[2].id, u)}
                  onSliceScroll={(d) => updatePanelSlice(panels[2].id, d)}
                  onSwitchSeries={(sId, pType) => switchPanelSeries(panels[2].id, sId, pType)}
                  crosshairPos={{ x: crosshairNorm.x, y: crosshairNorm.z }}
                  onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Coronal", pt)}
                  getImageUrl={getImageUrl}
                  findings={findings}
                  activeFindingId={activeFindingId}
                  onHoverFinding={onHoverFinding}
                  onSelectFinding={onSelectFinding}
                  markers={markers}
                  onAddMarker={onAddMarker}
                  measurements={measurements}
                  onAddMeasurement={onAddMeasurement}
                  annotations={annotations}
                  onCommitAnnotation={onCommitAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onQuickAnnotationNote={onQuickAnnotationNote}
                  onAddFinding={onAddFinding}
                  onEditFinding={onEditFinding}
                  annotations3D={annotations3D}
                  onAnnotations3DChange={onAnnotations3DChange}
                />
              </div>

              {/* Sub-divider between Coronal & Sagittal */}
              <div className="w-1 bg-border-strong/60" />

              <div className="flex-1 h-full">
                <SingleViewportPanel
                  panel={panels[1]}
                  study={study}
                  isMaximized={false}
                  onToggleMaximize={() => setMaximizedPanelId(panels[1].id)}
                  onUpdateState={(u) => updatePanelState(panels[1].id, u)}
                  onSliceScroll={(d) => updatePanelSlice(panels[1].id, d)}
                  onSwitchSeries={(sId, pType) => switchPanelSeries(panels[1].id, sId, pType)}
                  crosshairPos={{ x: crosshairNorm.y, y: crosshairNorm.z }}
                  onCrosshairMove={(pt) => handleCrosshairMoveFromPlane("Sagittal", pt)}
                  getImageUrl={getImageUrl}
                  findings={findings}
                  activeFindingId={activeFindingId}
                  onHoverFinding={onHoverFinding}
                  onSelectFinding={onSelectFinding}
                  markers={markers}
                  onAddMarker={onAddMarker}
                  measurements={measurements}
                  onAddMeasurement={onAddMeasurement}
                  annotations={annotations}
                  onCommitAnnotation={onCommitAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onQuickAnnotationNote={onQuickAnnotationNote}
                  onAddFinding={onAddFinding}
                  onEditFinding={onEditFinding}
                  annotations3D={annotations3D}
                  onAnnotations3DChange={onAnnotations3DChange}
                />
              </div>
            </div>
          </div>

          {/* Vertical Divider Between MPR and 3D */}
          <div
            onMouseDown={onDividerMouseDown("x")}
            className="w-1.5 cursor-col-resize bg-border-strong hover:bg-clinical transition-colors z-20"
          />

          {/* Right Column: Full-Height Patient 3D Anatomy Pane */}
          <div style={{ width: `${100 - splitX}%` }} className="h-full">
            <SingleViewportPanel
              panel={panels[3]}
              study={study}
              isMaximized={false}
              onToggleMaximize={() => setMaximizedPanelId(panels[3].id)}
              onUpdateState={(u) => updatePanelState(panels[3].id, u)}
              onSliceScroll={(d) => updatePanelSlice(panels[3].id, d)}
              onSwitchSeries={(sId, pType) => switchPanelSeries(panels[3].id, sId, pType)}
              crosshairPos={crosshairNorm}
              onCrosshairMove={() => {}}
              onPointSelected={handle3DPointSelected}
              organMeshes={organMeshes}
              onOrganMeshesChange={onOrganMeshesChange}
              getImageUrl={getImageUrl}
              findings={findings}
              activeFindingId={activeFindingId}
              onHoverFinding={onHoverFinding}
              onSelectFinding={onSelectFinding}
              markers={markers}
              onAddMarker={onAddMarker}
              measurements={measurements}
              onAddMeasurement={onAddMeasurement}
              annotations={annotations}
              onCommitAnnotation={onCommitAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
              onQuickAnnotationNote={onQuickAnnotationNote}
              onAddFinding={onAddFinding}
              onEditFinding={onEditFinding}
              annotations3D={annotations3D}
              onAnnotations3DChange={onAnnotations3DChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Individual viewport panel with its own header, plane selector, and renderer */
function SingleViewportPanel({
  panel,
  study,
  isMaximized,
  onToggleMaximize,
  onUpdateState,
  onSliceScroll,
  onSwitchSeries,
  crosshairPos,
  onCrosshairMove,
  onPointSelected,
  organMeshes,
  onOrganMeshesChange,
  getImageUrl,
  findings,
  activeFindingId,
  onHoverFinding,
  onSelectFinding,
  markers,
  onAddMarker,
  measurements,
  onAddMeasurement,
  annotations,
  onCommitAnnotation,
  onDeleteAnnotation,
  onQuickAnnotationNote,
  onAddFinding,
  onEditFinding,
  annotations3D,
  onAnnotations3DChange,
}: {
  panel: ViewportPanelConfig;
  study: Study;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onUpdateState: (updater: (prev: ViewerState) => ViewerState) => void;
  onSliceScroll: (delta: number) => void;
  onSwitchSeries: (seriesId: string, planeType: PanelPlaneType) => void;
  crosshairPos: { x: number; y: number; z?: number } | null;
  onCrosshairMove: (pt: { x: number; y: number }) => void;
  onPointSelected?: (pt: { x: number; y: number; z: number }) => void;
  organMeshes?: OrganMeshState[];
  onOrganMeshesChange?: (meshes: OrganMeshState[]) => void;
  getImageUrl: (series: SeriesInfo, sliceIndex: number) => string | undefined;
  findings: Finding[];
  activeFindingId: string | null;
  onHoverFinding: (id: string | null) => void;
  onSelectFinding: (id: string) => void;
  markers: Marker[];
  onAddMarker: (m: { id: string; x: number; y: number; seriesId: string; sliceIndex: number }) => void;
  measurements: ViewerMeasurement[];
  onAddMeasurement: (m: { id: string; a: { x: number; y: number }; b: { x: number; y: number }; distancePx: number; seriesId: string; sliceIndex: number }) => void;
  annotations: ViewerAnnotation[];
  onCommitAnnotation: (ann: ViewerAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onQuickAnnotationNote: (id: string, note: string) => void;
  onAddFinding: (id: string) => void;
  onEditFinding: (id: string) => void;
  annotations3D: Annotation3D[];
  onAnnotations3DChange: (anns: Annotation3D[]) => void;
}) {
  const [showPlaneMenu, setShowPlaneMenu] = useState(false);
  const activeSeries = study.series.find((s) => s.id === panel.seriesId) ?? study.series[0];
  const activeImageUrl = activeSeries ? getImageUrl(activeSeries, panel.sliceIndex) : undefined;

  // Filter slice-scoped annotations for this panel
  const panelMarkers = useMemo(
    () => markers.filter((m) => m.seriesId === panel.seriesId && m.sliceIndex === panel.sliceIndex),
    [markers, panel.seriesId, panel.sliceIndex]
  );
  const panelMeasurements = useMemo(
    () => measurements.filter((m) => m.seriesId === panel.seriesId && m.sliceIndex === panel.sliceIndex),
    [measurements, panel.seriesId, panel.sliceIndex]
  );
  const panelAnnotations = useMemo(
    () => annotations.filter((a) => a.seriesId === panel.seriesId && a.sliceIndex === panel.sliceIndex),
    [annotations, panel.seriesId, panel.sliceIndex]
  );

  const is3D = panel.planeType === "3D";

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden border border-border-strong/60 bg-black">
      {/* Viewport Header */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border-strong/60 bg-panel/90 px-2 text-[11px] backdrop-blur z-20">
        <div className="relative flex items-center gap-1.5">
          <button
            onClick={() => setShowPlaneMenu((v) => !v)}
            className="flex items-center gap-1 font-semibold text-clinical hover:text-clinical-strong"
          >
            {is3D ? <Box className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            <span>{panel.planeType.toUpperCase()}</span>
            <ChevronDown className="h-2.5 w-2.5" />
          </button>

          <span className="text-ink-muted truncate max-w-[120px]">
            {activeSeries?.label ?? ""}
          </span>

          {showPlaneMenu && (
            <div className="absolute top-6 left-0 z-50 w-52 rounded-md border border-border-strong bg-panel p-1 shadow-2xl">
              <div className="px-2 py-1 text-[9.5px] font-semibold uppercase text-ink-muted">Switch Anatomical View</div>
              <div className="space-y-0.5">
                {["Axial", "Sagittal", "Coronal", "3D"].map((plane) => {
                  const match = study.series.find((s) => s.orientation === plane || (plane === "3D" && s.volumeAvailable));
                  const sId = match ? match.id : study.series[0]?.id ?? "";
                  return (
                    <button
                      key={plane}
                      onClick={() => {
                        onSwitchSeries(sId, plane);
                        setShowPlaneMenu(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors",
                        panel.planeType === plane
                          ? "bg-clinical-dim font-medium text-clinical-strong"
                          : "text-ink-secondary hover:bg-base hover:text-ink-primary"
                      )}
                    >
                      <span>{plane} View</span>
                      {match && <span className="font-mono text-[9px] text-ink-muted">({match.sliceCount} sl)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!is3D && activeSeries && activeSeries.sliceCount > 1 && (
            <span className="font-mono text-[10px] text-ink-muted">
              {panel.sliceIndex + 1}/{activeSeries.sliceCount}
            </span>
          )}
          <button
            onClick={onToggleMaximize}
            className="rounded p-1 text-ink-muted hover:text-ink-primary hover:bg-base"
            title={isMaximized ? "Restore Layout" : "Maximize Viewport"}
          >
            {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Viewport Content */}
      <div className="relative min-h-0 flex-1">
        {is3D ? (
          <ViewerErrorBoundary fallbackTitle="3D Volumetric Reconstruction Unavailable">
            <Volume3DViewer
              studyId={study.id}
              seriesId={panel.seriesId}
              modality={study.modality}
              volumeUrl={activeImageUrl}
              sliceCount={activeSeries?.sliceCount}
              sliceUrlAt={(idx) => activeSeries ? getImageUrl(activeSeries, idx) : undefined}
              initialAnnotations={annotations3D}
              onAnnotationsChange={onAnnotations3DChange}
              findings={findings}
              activeFindingId={activeFindingId}
              onSelectFinding={onSelectFinding}
              crosshairPos={crosshairPos ? { x: crosshairPos.x, y: crosshairPos.y, z: crosshairPos.z ?? 0.5 } : null}
              onPointSelected={(pt) => {
                if (onPointSelected) {
                  onPointSelected(pt);
                } else if (onCrosshairMove) {
                  onCrosshairMove({ x: pt.x, y: pt.y });
                }
              }}
              organMeshes={organMeshes}
              onOrganMeshesChange={onOrganMeshesChange}
            />
          </ViewerErrorBoundary>
        ) : (
          <ImageViewer
            modality={study.modality}
            seed={study.thumbnailSeed + panel.sliceIndex}
            imageUrl={activeImageUrl}
            findings={findings.filter((f) => f.sliceIndex === panel.sliceIndex)}
            activeFindingId={activeFindingId}
            onHoverFinding={onHoverFinding}
            onSelectFinding={onSelectFinding}
            viewerState={panel.viewerState}
            setViewerState={onUpdateState}
            orientation={panel.planeType}
            seriesLabel={activeSeries?.label}
            patientAlias={study.patientAlias}
            pixelSpacing={activeSeries?.pixelSpacing}
            sliceLabel={`Slice ${panel.sliceIndex + 1} / ${activeSeries?.sliceCount ?? 1}`}
            markers={panelMarkers}
            onAddMarker={(m) => onAddMarker({ ...m, seriesId: panel.seriesId, sliceIndex: panel.sliceIndex })}
            measurements={panelMeasurements}
            onAddMeasurement={(m) => onAddMeasurement({ ...m, seriesId: panel.seriesId, sliceIndex: panel.sliceIndex })}
            annotations={panelAnnotations}
            onCommitAnnotation={onCommitAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            onQuickAnnotationNote={onQuickAnnotationNote}
            onAddFinding={onAddFinding}
            onEditFinding={onEditFinding}
            crosshairPos={crosshairPos}
            onCrosshairMove={onCrosshairMove}
            onSliceScroll={onSliceScroll}
          />
        )}
      </div>
    </div>
  );
}
