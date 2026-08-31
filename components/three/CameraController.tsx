"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

export function CameraController({ reduced }: { reduced: boolean }) {
  const { camera, pointer } = useThree();
  const basePosition = useRef(new THREE.Vector3(0, 0.3, 7.2));
  const target = useRef(new THREE.Vector3(0, 0, 0));

  useFrame(() => {
    if (reduced) {
      camera.position.lerp(basePosition.current, 0.08);
      camera.lookAt(target.current);
      return;
    }
    const dx = pointer.x * 0.55;
    const dy = pointer.y * 0.32;
    const desired = new THREE.Vector3(basePosition.current.x + dx, basePosition.current.y + dy, basePosition.current.z);
    camera.position.lerp(desired, 0.035);
    camera.lookAt(target.current);
  });

  return null;
}
