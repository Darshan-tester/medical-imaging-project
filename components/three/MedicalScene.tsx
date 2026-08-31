"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { CameraController } from "./CameraController";
import { SceneLighting } from "./SceneLighting";
import { ScanVolume } from "./ScanVolume";
import { ScanParticles } from "./ScanParticles";
import { FindingMarkers } from "./FindingMarker";
import { SceneErrorBoundary } from "./SceneErrorBoundary";
import { SceneFallback } from "./SceneFallback";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/hooks";

export function MedicalScene() {
  const reduced = usePrefersReducedMotion();
  const webglSupported = useWebGLSupport();

  // Still checking (null) or confirmed unsupported → static, dependency-free fallback.
  if (webglSupported === false) {
    return <SceneFallback />;
  }

  return (
    <SceneErrorBoundary fallback={<SceneFallback />}>
      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-2xl bg-[#0F172A]" />}>
        <Canvas
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          camera={{ position: [0, 0.3, 7.2], fov: 42 }}
          className="!touch-auto"
        >
          <SceneLighting />
          <CameraController reduced={reduced} />
          <ScanVolume reduced={reduced} />
          <ScanParticles reduced={reduced} />
          <FindingMarkers reduced={reduced} />
        </Canvas>
      </Suspense>
    </SceneErrorBoundary>
  );
}
