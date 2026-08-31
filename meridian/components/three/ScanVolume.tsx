"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const SLICE_COUNT = 16;

export function ScanVolume({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const sweep = useRef<THREE.Mesh>(null);

  const slices = useMemo(
    () =>
      Array.from({ length: SLICE_COUNT }).map((_, i) => {
        const t = i / (SLICE_COUNT - 1);
        // gentle organic silhouette: narrower at top/bottom, wider in the middle
        const widthScale = 0.55 + Math.sin(t * Math.PI) * 0.75;
        return {
          y: -2.1 + t * 4.2,
          scale: widthScale,
          rotation: (i % 2 === 0 ? 1 : -1) * 0.015,
          opacity: 0.05 + Math.sin(t * Math.PI) * 0.07,
        };
      }),
    []
  );

  useFrame((state) => {
    if (group.current && !reduced) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.06) * 0.18 + 0.15;
    }
    if (sweep.current) {
      const speed = reduced ? 0.06 : 0.18;
      const t = (Math.sin(state.clock.elapsedTime * speed) + 1) / 2;
      sweep.current.position.y = -2.1 + t * 4.2;
      const mat = sweep.current.material as THREE.MeshBasicMaterial;
      mat.opacity = reduced ? 0.12 : 0.18 + Math.sin(state.clock.elapsedTime * 2) * 0.03;
    }
  });

  return (
    <group ref={group} rotation={[0.05, 0.15, 0]}>
      {slices.map((s, i) => (
        <mesh key={i} position={[0, s.y, 0]} rotation={[Math.PI / 2, 0, s.rotation]} scale={[s.scale, s.scale, 1]}>
          <planeGeometry args={[2.6, 1.7, 1, 1]} />
          <meshBasicMaterial
            color="#3B82F6"
            transparent
            opacity={s.opacity}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* bounding wireframe — instrument-panel structure cue */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[2.7, 4.3, 1.8]} />
        <meshBasicMaterial color="#3B82F6" wireframe transparent opacity={0.06} />
      </mesh>

      {/* scanning sweep plane */}
      <mesh ref={sweep} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.75, 1.85]} />
        <meshBasicMaterial color="#60A5FA" transparent opacity={0.2} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
