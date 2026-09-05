"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Boxes, ImageOff, Loader2 } from "lucide-react";
import { SceneErrorBoundary } from "@/components/three/SceneErrorBoundary";
import { isDemoDicomUrl, isDemoVolumeUrl, DEMO_MIN_STACK_SLICES } from "@/lib/demo/types";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/hooks";

/**
 * Interactive 3-D render of one reconstructed series.
 *
 * The volume is the same one the Coronal/Sagittal planes are cut from, and it
 * arrives by one of three routes:
 *
 *  - `volumeUrl` names a committed NIfTI series. The browser has already inflated
 *    that volume to draw the 2-D planes, so the field is built from the copy in
 *    memory at its full acquired resolution, with no request and no decimation.
 *  - `volumeUrl` names a committed DICOM instance and `sliceUrlAt` can resolve the
 *    rest of the series. One instance is one slice, so a field has to be stacked
 *    out of an evenly spaced sample of the files — see `loadDemoCtVolume8` for the
 *    download budget that fixes how many.
 *  - otherwise — an indexed DICOM stack, fetched from
 *    `/api/studies/<id>/volume/<seriesId>` as an 8-bit scalar field. This is the
 *    only route that needs a filesystem, so it is the only one the deployed Worker
 *    cannot take.
 *
 * Either way it is uploaded as a 3-D texture and ray-marched in the fragment
 * shader. Nothing is modelled, inferred or smoothed into existence: every sample
 * on screen is an interpolated stored value from the series itself.
 *
 * Only offered for series that actually have a volume behind them
 * (`SeriesInfo.volumeAvailable`). There is no fallback that fakes a 3-D view for a
 * series that has no stack.
 */
export function Volume3DViewer({
  studyId,
  seriesId,
  volumeUrl,
  sliceCount,
  sliceUrlAt,
}: {
  studyId: string;
  seriesId: string;
  /**
   * Slice URL of the active series, used only to recognise which of the two
   * client-side routes applies. Anything else — an indexed `/api/studies/...` URL —
   * falls through to the server route.
   */
  volumeUrl?: string;
  /** Slices in the active series, for the stacked route. */
  sliceCount?: number;
  /** Resolves any slice index of the active series to its URL, for the stacked route. */
  sliceUrlAt?: (index: number) => string | undefined;
}) {
  const webglSupported = useWebGLSupport();
  const reduced = usePrefersReducedMotion();

  const clientUrl = volumeUrl && isDemoVolumeUrl(volumeUrl) ? volumeUrl : undefined;
  /* A stack is only worth reading when there is enough of it to be a volume; the
     same threshold decides which series advertise a 3-D view in the first place. */
  const stackCount =
    !clientUrl && volumeUrl && isDemoDicomUrl(volumeUrl) && sliceCount && sliceCount >= DEMO_MIN_STACK_SLICES
      ? sliceCount
      : undefined;

  const [volume, setVolume] = useState<LoadedVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [threshold, setThreshold] = useState(0.28);
  const [density, setDensity] = useState(0.55);
  const [mip, setMip] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setVolume(null);
    setError(null);
    setProgress(null);

    (async () => {
      try {
        const loaded = clientUrl
          ? await loadClientVolume(clientUrl)
          : stackCount && sliceUrlAt
            ? await loadClientStack(sliceUrlAt, stackCount, `${studyId}:${seriesId}`, {
                signal: controller.signal,
                onProgress: (done, total) => {
                  if (!cancelled) setProgress({ done, total });
                },
              })
            : await loadServerVolume(studyId, seriesId);
        if (!cancelled) setVolume(loaded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      // Stops the run from downloading slices for a view nobody is looking at.
      // Requests already in the air are left to finish, as everywhere else.
      controller.abort();
    };
  }, [studyId, seriesId, clientUrl, stackCount, sliceUrlAt]);

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
        <p className="text-[12.5px] text-ink-secondary">
          {progress ? `Reading slice ${progress.done} of ${progress.total}…` : "Building the volume…"}
        </p>
        <p className="max-w-xs text-[11px] text-ink-muted">
          {clientUrl
            ? "The whole series is read once. If you have already been scrolling it, the voxels are in memory and this is arithmetic."
            : stackCount
              ? `Every slice of this series is a separate file, so the render is stacked from an evenly spaced sample of the ${stackCount} — the first and the last included.`
              : "Every slice is decoded once, so the first load of a large series takes a few seconds."}
        </p>
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

        {/* The intensity window that was mapped onto 0-255 — shown so the sliders
            below are read as display controls over a known range, not as an edit
            to the stored values. */}
        {volume.window && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
            {formatLevel(volume.window[0])} … {formatLevel(volume.window[1])}
            {volume.windowUnit ? ` ${volume.windowUnit}` : ""}
          </span>
        )}

        {/* How much of the series this field is, when it is not all of it. */}
        {volume.detail && (
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
            {volume.detail}
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
  /** The intensity window that was mapped onto 0-255. Undefined if the header was absent. */
  window?: [number, number];
  /**
   * Unit for that window. `HU` for either DICOM route; omitted for NIfTI, where
   * the stored values are MR signal or PET SUV and labelling them HU would be
   * wrong.
   */
  windowUnit?: string;
  /**
   * What this field is, when it is not the whole acquisition — "48 of 443 slices ·
   * 7.4 mm". Shown verbatim, so a stacked render is never mistaken for the full
   * series.
   */
  detail?: string;
}

/**
 * The indexed route: the server reads the instance stack off disk and streams it
 * as one 8-bit scalar field, describing its own shape in response headers.
 */
async function loadServerVolume(studyId: string, seriesId: string): Promise<LoadedVolume> {
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
  return { data: new Uint8Array(buf), dims, spacing, window: huWindow, windowUnit: "HU" };
}

/**
 * The committed-NIfTI route.
 *
 * Imported on demand rather than at module scope so the NIfTI and DICOM decoders
 * do not get pulled into whichever chunk this component lands in — a reader who
 * never opens the 3-D view should not download them twice.
 */
async function loadClientVolume(volumeUrl: string): Promise<LoadedVolume> {
  const { loadDemoVolume8 } = await import("@/lib/demo/decode");
  return loadDemoVolume8(volumeUrl);
}

/**
 * The committed-DICOM route: an evenly spaced sample of the series' files, stacked.
 *
 * The window is labelled HU because the instances' rescale slope and intercept are
 * applied before it, exactly as on the server route.
 */
async function loadClientStack(
  sliceUrlAt: (index: number) => string | undefined,
  sliceCount: number,
  cacheKey: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<LoadedVolume> {
  const { loadDemoCtVolume8 } = await import("@/lib/demo/decode");
  const built = await loadDemoCtVolume8(sliceUrlAt, sliceCount, cacheKey, opts);
  const interval = built.intervalMm ? ` · ${built.intervalMm.toFixed(1)} mm` : "";
  return {
    ...built,
    windowUnit: "HU",
    detail: `${built.sampled.count} of ${built.sampled.of} slices${interval}`,
  };
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

/** The window bounds are HU integers on one route and SUV fractions on the other. */
function formatLevel(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10 ? String(Math.round(value)) : value.toFixed(2);
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
