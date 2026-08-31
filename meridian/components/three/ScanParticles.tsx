"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 340;

export function ScanParticles({ reduced }: { reduced: boolean }) {
  const points = useRef<THREE.Points>(null);

  const [positions, seeds] = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const sd = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      // sample within an ellipsoid volume roughly matching the scan silhouette
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.cbrt(Math.random());
      const x = r * Math.sin(phi) * Math.cos(theta) * 1.5;
      const y = r * Math.cos(phi) * 2.3;
      const z = r * Math.sin(phi) * Math.sin(theta) * 1.05;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      sd[i] = Math.random() * Math.PI * 2;
    }
    return [pos, sd];
  }, []);

  useFrame((state) => {
    if (!points.current) return;
    if (reduced) {
      points.current.rotation.y = 0.15;
      return;
    }
    points.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.05) * 0.2 + 0.15;
    const geo = points.current.geometry as THREE.BufferGeometry;
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += Math.sin(state.clock.elapsedTime * 0.4 + seeds[i]) * 0.0009;
    }
    geo.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.024}
        color="#22D3EE"
        transparent
        opacity={0.32}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
