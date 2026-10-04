"use client";

import { useMemo } from "react";
import { Patient3DAnatomyViewer } from "./Patient3DAnatomyViewer";
import { OrganMeshState } from "./AIAnalysisPanel";
import { AnatomicalLayer } from "@/lib/anatomy-state";

interface RealStudy3DViewerProps {
  studyId: string;
  organMeshes?: OrganMeshState[];
  onOrganMeshesChange?: (meshes: OrganMeshState[]) => void;
  onSelectOrgan?: (organId: string) => void;
  activeOrganId?: string | null;
  className?: string;
  height?: string | number;
}

/**
 * RealStudy3DViewer adapter.
 * Replaced synthetic / placeholder geometry with the canonical Patient3DAnatomyViewer.
 * Renders the study's actual patient volume and TotalSegmentator segmentations.
 */
export function RealStudy3DViewer({
  studyId,
  organMeshes = [],
  onOrganMeshesChange,
  onSelectOrgan,
  activeOrganId,
  className,
  height = "520px",
}: RealStudy3DViewerProps) {
  // Convert legacy organMeshes to AnatomicalLayer representation
  const layers: AnatomicalLayer[] = useMemo(() => {
    return organMeshes.map((m) => ({
      id: m.id,
      name: m.name,
      category: "ORGANS",
      availability: "available",
      provenance: "AI_SEGMENTED",
      visible: m.visible,
      isolated: m.isolated || false,
      opacity: m.opacity,
      color: m.color || "#38BDF8",
      meshUrl: `/api/studies/${studyId}/derived/meshes/${m.id}.glb`,
      volumeMl: m.volumeMl,
      maxDiameterMm: m.maxDiameterMm,
    }));
  }, [organMeshes, studyId]);

  const handleLayersChange = (nextLayers: AnatomicalLayer[]) => {
    if (!onOrganMeshesChange) return;
    const nextMeshes: OrganMeshState[] = nextLayers.map((l) => ({
      id: l.id,
      name: l.name,
      group: "organ",
      color: l.color,
      opacity: l.opacity,
      visible: l.visible,
      isolated: l.isolated,
      volumeMl: l.volumeMl,
      maxDiameterMm: l.maxDiameterMm,
    }));
    onOrganMeshesChange(nextMeshes);
  };

  return (
    <Patient3DAnatomyViewer
      studyId={studyId}
      seriesId="axial"
      layers={layers}
      onLayersChange={handleLayersChange}
      selectedStructureId={activeOrganId}
      onSelectStructure={(id) => onSelectOrgan?.(id || "")}
      className={className}
      height={height}
      showLayerPanel={false}
    />
  );
}
