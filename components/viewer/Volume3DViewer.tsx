"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Boxes, ImageOff, Loader2 } from "lucide-react";
import { SceneErrorBoundary } from "@/components/three/SceneErrorBoundary";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/hooks";

/**
 * Interactive 3-D render of one reconstructed CT series.
 *
 * The volume is the same reconstructed stack the Coronal/Sagittal planes are cut
 * from — fetched once from `/api/studies/<id>/volume/<seriesId>` as an 8-bit
 * scalar field, uploaded as a 3-D texture, and ray-marched in the fragment
 * shader. Nothing is modelled, inferred or smoothed into existence: every sample
 * on screen is an interpolated CT value from the indexed instances.
 *
 * Only offered for series the indexer actually reconstructed
 * (`SeriesInfo.volumeAvailable`). There is no fallback that fakes a 3-D view for
 * a series that has no stack.
 */
export function Volume3DViewer({ studyId, seriesId }: { studyId: string; seriesId: string }) {
  const webglSupported = useWebGLSupport();
  const reduced = usePrefersReducedMotion();

  const [volume, setVolume] = useState<LoadedVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.28);
  const [density, setDensity] = useState(0.55);
  const [mip, setMip] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setVolume(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/studies/${studyId}/volume/${seriesId}`, { cache: "no-store" });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? `The server returned ${res.status}`);
        }
        const dims = parseTriple(res.headers.get("X-Volume-Dims"));
        const spacing = parseTriple(res.headers.get("X-Volume-Spacing"));
        if (!dims || !spacing) throw new Error("The volume response did not describe its own shape");
        const huWindow = parsePair(res.headers.get("X-Volume-Window"));

        const buf = await res.arrayBuffer();
        const expected = dims[0] * dims[1] * dims[2];
        if (buf.byteLength !== expected) {
          throw new Error(`Expected ${expected} voxels but received ${buf.byteLength}`);
        }
        if (!cancelled) setVolume({ data: new Uint8Array(buf), dims, spacing, window: huWindow });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studyId, seriesId]);

  if (webglSupported === false) {
    return <Notice title="3D view unavailable">This browser or GPU does not support WebGL, which the volume render requires. The 2D planes are unaffected.</Notice>;
  }
  if (error) {
    return <Notice title="Unable to build the 3D view">{error}</Notice>;
  }
  if (!volume) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-viewer text-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" strokeWidth={1.6} />
        <p className="text-[12.5px] text-ink-secondary">Reading the full instance stack…</p>
        <p className="max-w-xs text-[11px] text-ink-muted">Every slice is decoded once, so the first load of a large series takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black">
      <SceneErrorBoundary fallback={<Notice title="3D view stopped">The volume render failed on this GPU. The 2D planes are unaffected.</Notice>}>
        <Canvas dpr={[1, 1.5]} gl={{ antialias: false, alpha: false }} camera={{ position: [0, 0, 2.6], fov: 45 }}>
          <VolumeMesh volume={volume} threshold={threshold} density={density} mip={mip} />
          <OrbitControls enablePan={false} autoRotate={!reduced} autoRotateSpeed={0.6} minDistance={1.2} maxDistance={6} />
        </Canvas>
      </SceneErrorBoundary>

      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-3 rounded-md border border-border-strong bg-panel/85 px-3 py-2 backdrop-blur">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
          <Boxes className="h-3.5 w-3.5" /> {volume.dims.join("×")}
        </span>

        {/* The intensity window the server mapped onto 0-255 — shown so the
            sliders below are read as display controls over a known range, not
            as an edit to the stored values. */}
        {volume.window && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
            {volume.window[0]} … {volume.window[1]} HU
          </span>
        )}

        <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
          Threshold
          <input
            type="range"
            min={0}
            max={0.9}
            step={0.01}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
            aria-label="Density threshold"
          />
        </label>

        <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
          Opacity
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.01}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
            aria-label="Opacity"
          />
        </label>

        <button
          onClick={() => setMip((m) => !m)}
          className="rounded border border-border-strong px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-secondary hover:text-ink-primary"
          aria-pressed={mip}
        >
          {mip ? "MIP" : "Composite"}
        </button>
      </div>
    </div>
  );
}

interface LoadedVolume {
  data: Uint8Array;
  dims: [number, number, number];
  spacing: [number, number, number];
  /** The intensity window the server mapped onto 0-255. Undefined if the header was absent. */
  window?: [number, number];
}

/**
 * The render itself: a unit cube whose fragment shader walks the ray through the
 * 3-D texture. `side: BackSide` means the far faces are rasterized, so the volume
 * still draws when the camera is inside the box.
 *
 * The box is scaled by dims × spacing, which is why the proportions are
 * anatomically right — a 5 mm-spaced chest CT is 512×512×70 voxels but is not
 * 7× wider than it is tall.
 */
function VolumeMesh({
  volume,
  threshold,
  density,
  mip,
}: {
  volume: LoadedVolume;
  threshold: number;
  density: number;
  mip: boolean;
}) {
  const texture = useMemo(() => {
    const t = new THREE.Data3DTexture(volume.data, volume.dims[0], volume.dims[1], volume.dims[2]);
    t.format = THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }, [volume]);

  useEffect(() => () => texture.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uVolume: { value: texture },
      uThreshold: { value: threshold },
      uDensity: { value: density },
      uMip: { value: mip ? 1 : 0 },
      // ~1.7 samples per voxel along the longest axis: enough that thin
      // structures are not stepped over, cheap enough for a 60fps orbit.
      uSteps: { value: Math.min(768, Math.round(Math.max(...volume.dims) * 1.7)) },
    }),
    // Rebuilt only with the texture; the scalar controls are pushed by mutation below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture]
  );

  useEffect(() => {
    uniforms.uThreshold.value = threshold;
    uniforms.uDensity.value = density;
    uniforms.uMip.value = mip ? 1 : 0;
  }, [uniforms, threshold, density, mip]);

  const scale = useMemo<[number, number, number]>(() => {
    const physical = [
      volume.dims[0] * volume.spacing[0],
      volume.dims[1] * volume.spacing[1],
      volume.dims[2] * volume.spacing[2],
    ];
    const longest = Math.max(...physical) || 1;
    return [physical[0] / longest, physical[1] / longest, physical[2] / longest];
  }, [volume]);

  return (
    <mesh scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        glslVersion={THREE.GLSL3}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vOrigin;
  varying vec3 vDirection;

  void main() {
    // Everything is done in object space, so the box's non-uniform scale is
    // handled by this one inverse instead of by the marching loop.
    vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Ray-marching fragment shader.
 *
 * Two honest modes, no invented geometry in either:
 *  - MIP: the brightest sample along each ray, which is how a radiologist reads
 *    vessels and bone from a CT stack.
 *  - Composite: front-to-back alpha accumulation, which reads more like a
 *    surface but is still nothing but the sampled scalar field.
 *
 * `uThreshold` discards samples below a density, so air and table padding do not
 * fog the render. It is a display control — it never edits the served volume.
 *
 * Note on outputs: three.js prepends `layout(location = 0) out highp vec4
 * pc_fragColor;` plus `#define gl_FragColor pc_fragColor` for a GLSL3
 * ShaderMaterial, so this shader must NOT declare its own out variable.
 */
const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVolume;
  uniform float uThreshold;
  uniform float uDensity;
  uniform float uMip;
  uniform float uSteps;

  varying vec3 vOrigin;
  varying vec3 vDirection;

  /** Slab intersection against the unit cube the geometry actually occupies. */
  vec2 hitBox(vec3 orig, vec3 dir) {
    const vec3 lo = vec3(-0.5);
    const vec3 hi = vec3(0.5);
    vec3 invDir = 1.0 / dir;
    vec3 tLo = (lo - orig) * invDir;
    vec3 tHi = (hi - orig) * invDir;
    vec3 tSmall = min(tLo, tHi);
    vec3 tBig = max(tLo, tHi);
    return vec2(
      max(max(tSmall.x, tSmall.y), tSmall.z),
      min(min(tBig.x, tBig.y), tBig.z)
    );
  }

  void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDir);
    if (bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);

    float dt = (bounds.y - bounds.x) / uSteps;
    vec3 p = vOrigin + rayDir * bounds.x;
    vec3 stepVec = rayDir * dt;

    float headroom = max(1.0 - uThreshold, 0.001);
    float brightest = 0.0;
    vec3 accColor = vec3(0.0);
    float accAlpha = 0.0;

    for (float i = 0.0; i < 1024.0; i += 1.0) {
      if (i >= uSteps) break;

      // p is object space (-0.5..0.5); the texture is 0..1 on the same axes.
      float v = texture(uVolume, p + 0.5).r;

      if (v > uThreshold) {
        float w = (v - uThreshold) / headroom;
        if (uMip > 0.5) {
          brightest = max(brightest, w);
        } else {
          // Per-sample alpha is scaled by step count so the result does not get
          // denser just because the volume has more slices.
          float a = w * uDensity * (512.0 / uSteps) * 0.09;
          a = clamp(a, 0.0, 1.0);
          accColor += (1.0 - accAlpha) * vec3(w) * a;
          accAlpha += (1.0 - accAlpha) * a;
          if (accAlpha > 0.985) break;
        }
      }

      p += stepVec;
    }

    if (uMip > 0.5) {
      if (brightest <= 0.0) discard;
      gl_FragColor = vec4(vec3(brightest), brightest * uDensity);
    } else {
      if (accAlpha <= 0.0) discard;
      gl_FragColor = vec4(accColor / max(accAlpha, 0.001) * accAlpha, accAlpha);
    }
  }
`;

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-viewer text-center">
      <ImageOff className="h-6 w-6 text-ink-muted" strokeWidth={1.5} />
      <p className="text-[13px] font-medium text-ink-secondary">{title}</p>
      <p className="max-w-sm text-[11.5px] text-ink-muted">{children}</p>
    </div>
  );
}

function parseTriple(raw: string | null): [number, number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return undefined;
  return [parts[0], parts[1], parts[2]];
}

/** The window header is a signed pair (HU can be negative), so no positivity check here. */
function parsePair(raw: string | null): [number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [parts[0], parts[1]];
}
