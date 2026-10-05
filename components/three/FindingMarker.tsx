"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

const MARKERS: [number, number, number][] = [
  [0.55, 0.9, 0.6],
  [-0.7, -0.4, 0.5],
  [0.3, -1.3, -0.4],
];

function Marker({ position, delay, reduced }: { position: [number, number, number]; delay: number; reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (reduced) {
      if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.35;
      return;
    }
    const t = ((state.clock.elapsedTime + delay) % 2.6) / 2.6;
    if (ring.current) {
      const s = 0.4 + t * 1.6;
      ring.current.scale.set(s, s, s);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t);
    }
    if (core.current) {
      const pulse = 0.85 + Math.sin(state.clock.elapsedTime * 3 + delay) * 0.15;
      core.current.scale.set(pulse, pulse, pulse);
    }
  });

  return (
    <group position={position}>
      {/* Precision Micro Reticle */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -0.03, 0, 0, 0.03, 0, 0,
                0, -0.03, 0, 0, 0.03, 0,
                0, 0, -0.03, 0, 0, 0.03,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#38BDF8" transparent opacity={0.8} />
      </lineSegments>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.02, 0.025, 32]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.5} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function FindingMarkers({ reduced }: { reduced: boolean }) {
  return (
    <>
      {MARKERS.map((pos, i) => (
        <Marker key={i} position={pos} delay={i * 0.7} reduced={reduced} />
      ))}
    </>
  );
}
