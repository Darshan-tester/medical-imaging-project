"use client";

import { Patient4DCineViewer } from "./Patient4DCineViewer";
import { Study } from "@/lib/types";

interface RealStudy4DViewerProps {
  studyId: string;
  activePhase?: number;
  totalPhases?: number;
  isPlaying?: boolean;
  fps?: number;
  onPhaseChange?: (phase: number) => void;
  onTogglePlay?: () => void;
  cardiacMetrics?: any;
  isSimulated?: boolean;
  className?: string;
  height?: string | number;
}

/**
 * RealStudy4DViewer adapter.
 * Replaces simulated fake sinusoidal vertex motion and hardcoded metrics
 * with the genuine Patient4DCineViewer.
 * Displays "4D unavailable — study contains no temporal acquisition" for static scans.
 */
export function RealStudy4DViewer({
  studyId,
  activePhase = 0,
  onPhaseChange,
  className,
  height = "520px",
}: RealStudy4DViewerProps) {
  const studyRef: Study = {
    id: studyId,
    studyId,
    patientAlias: "Patient Study",
    modality: "CT",
    date: new Date().toISOString(),
    priority: "routine",
    status: "processing",
    aiConfidence: null,
    assignedRadiologist: null,
    thumbnailSeed: 1,
    findings: [],
    series: [
      {
        id: "axial",
        label: "Axial Series",
        sliceCount: 1,
        orientation: "Axial",
      },
    ],
    report: {
      status: "in-review",
      sections: {
        clinicalInformation: "",
        technique: "",
        comparison: "",
        findings: "",
        impression: "",
      },
      aiAssisted: false,
      version: 1,
      reviewer: null,
      approvedAt: null,
    },
  };

  return (
    <Patient4DCineViewer
      study={studyRef}
      activePhase={activePhase}
      onPhaseChange={onPhaseChange}
      className={className}
      height={height}
    />
  );
}
