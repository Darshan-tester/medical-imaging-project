"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Html } from "@react-three/drei";
import { OrganMeshState } from "./AIAnalysisPanel";

interface OrganMeshesLayerProps {
  studyId: string;
  organMeshes: OrganMeshState[];
  volumeDims: [number, number, number];
  volumeSpacing: [number, number, number];
  volumeScale: [number, number, number];
  clippingPlanes?: THREE.Plane[];
  onSelectOrgan?: (organId: string) => void;
  activeOrganId?: string | null;
}

const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, THREE.Group>();

export function OrganMeshesLayer({
  studyId,
  organMeshes,
  volumeDims,
  volumeSpacing,
  volumeScale,
  clippingPlanes = [],
  onSelectOrgan,
  activeOrganId,
}: OrganMeshesLayerProps) {
  // Any organ isolated?
  const hasIsolated = useMemo(() => organMeshes.some((m) => m.isolated), [organMeshes]);

  return (
    <group>
      {organMeshes.map((meshState) => {
        // If an organ is isolated, only render that organ
        if (hasIsolated && !meshState.isolated) return null;
        if (!meshState.visible) return null;

        return (
          <SingleOrganMesh
            key={meshState.id}
            studyId={studyId}
            meshState={meshState}
            volumeDims={volumeDims}
            volumeSpacing={volumeSpacing}
            volumeScale={volumeScale}
            clippingPlanes={clippingPlanes}
            onSelectOrgan={onSelectOrgan}
            isSelected={activeOrganId === meshState.id}
          />
        );
      })}
    </group>
  );
}

function SingleOrganMesh({
  studyId,
  meshState,
  volumeDims,
  volumeSpacing,
  volumeScale,
  clippingPlanes,
  onSelectOrgan,
  isSelected,
}: {
  studyId: string;
  meshState: OrganMeshState;
  volumeDims: [number, number, number];
  volumeSpacing: [number, number, number];
  volumeScale: [number, number, number];
  clippingPlanes: THREE.Plane[];
  onSelectOrgan?: (organId: string) => void;
  isSelected?: boolean;
}) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [hovered, setHovered] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<[number, number, number] | null>(null);

  const url = `/api/ai/derived/${studyId}/mesh/${meshState.id}.glb`;

  useEffect(() => {
    let cancelled = false;

    if (modelCache.has(url)) {
      setModel(modelCache.get(url)!.clone());
      return;
    }

    gltfLoader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        modelCache.set(url, gltf.scene);
        setModel(gltf.scene.clone());
      },
      undefined,
      (err) => {
        // Quietly fail if mesh hasn't been generated yet
      }
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  // Compute transform alignment from physical mm to Three.js volume coordinate box
  const { scaleVec, posVec } = useMemo(() => {
    const lx = volumeDims[0] * volumeSpacing[0];
    const ly = volumeDims[1] * volumeSpacing[1];
    const lz = volumeDims[2] * volumeSpacing[2];
    const longest = Math.max(lx, ly, lz) || 1;

    // Transform from physical [0..Lx, 0..Ly, 0..Lz] mm into centered Three.js volume box
    return {
      scaleVec: new THREE.Vector3(1 / longest, -1 / longest, 1 / longest),
      posVec: new THREE.Vector3(-lx / (2 * longest), ly / (2 * longest), -lz / (2 * longest)),
    };
  }, [volumeDims, volumeSpacing]);

  // Apply materials, colors, opacity, and clipping planes to all child meshes
  useEffect(() => {
    if (!model) return;

    const baseColor = new THREE.Color(meshState.color || "#38BDF8");
    const effOpacity = meshState.isolated ? 0.95 : isSelected ? 0.9 : hovered ? 0.85 : meshState.opacity;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        const targetColor = hovered || isSelected ? baseColor.clone().offsetHSL(0, 0, 0.15) : baseColor;

        if (m.material && !Array.isArray(m.material) && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.color.copy(targetColor);
          mat.opacity = effOpacity;
          mat.transparent = effOpacity < 1.0;
          mat.clippingPlanes = clippingPlanes;
          mat.depthWrite = effOpacity > 0.8;
        } else {
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else if (m.material) {
            m.material.dispose();
          }
          m.material = new THREE.MeshStandardMaterial({
            color: targetColor,
            roughness: 0.35,
            metalness: 0.1,
            transparent: effOpacity < 1.0,
            opacity: effOpacity,
            side: THREE.DoubleSide,
            clippingPlanes: clippingPlanes,
            clipShadows: true,
            wireframe: false,
            depthWrite: effOpacity > 0.8,
          });
        }
      }
    });
  }, [model, meshState.color, meshState.opacity, meshState.isolated, isSelected, hovered, clippingPlanes]);

  if (!model) return null;

  return (
    <group position={posVec} scale={scaleVec}>
      <primitive
        object={model}
        onPointerOver={(e: any) => {
          e.stopPropagation();
          setHovered(true);
          if (e.point) {
            // Unproject into world space for tooltip
            setHoverPoint([e.point.x, e.point.y, e.point.z]);
          }
        }}
        onPointerOut={(e: any) => {
          e.stopPropagation();
          setHovered(false);
          setHoverPoint(null);
        }}
        onClick={(e: any) => {
          e.stopPropagation();
          onSelectOrgan?.(meshState.id);
        }}
      />

      {/* Floating Organ Inspection Badge */}
      {hovered && hoverPoint && (
        <Html position={hoverPoint} center distanceFactor={2.5}>
          <div className="pointer-events-none z-50 flex flex-col gap-0.5 rounded-lg border border-clinical bg-panel/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md text-ink-primary whitespace-nowrap">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meshState.color }} />
              <span className="text-[11px] font-semibold text-clinical-strong">{meshState.name}</span>
            </div>
            {meshState.volumeMl !== undefined && (
              <div className="flex items-center justify-between gap-3 font-mono text-[9.5px] text-ink-secondary">
                <span>Volume:</span>
                <span className="font-semibold text-ink-primary">{meshState.volumeMl.toFixed(1)} ml</span>
              </div>
            )}
            {meshState.maxDiameterMm !== undefined && (
              <div className="flex items-center justify-between gap-3 font-mono text-[9.5px] text-ink-secondary">
                <span>Max Caliper:</span>
                <span className="font-semibold text-ink-primary">{meshState.maxDiameterMm.toFixed(1)} mm</span>
              </div>
            )}
            <div className="mt-0.5 border-t border-border pt-0.5 text-[8.5px] font-mono text-ink-muted">
              MONAI TotalSegmentator 3D Surface
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
