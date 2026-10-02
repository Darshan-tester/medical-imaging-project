"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import {
  Boxes,
  ImageOff,
  Loader2,
  Palette,
  Sparkles,
  Sliders,
  RotateCcw,
  Eye,
  EyeOff,
  MapPin,
  Play,
  Pause,
  Scissors,
  Sun,
  Contrast,
  Activity,
  Compass,
} from "lucide-react";
import { SceneErrorBoundary } from "@/components/three/SceneErrorBoundary";
import { isDemoDicomUrl, isDemoVolumeUrl, DEMO_MIN_STACK_SLICES } from "@/lib/demo/types";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/hooks";
import { ColorMap3D, Quality3D, Annotation3D, Finding, Modality } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLOR_MAP_INDICES: Record<ColorMap3D, number> = {
  "mri-tissue": 0,
  "mri-t1": 1,
  "mri-flair": 2,
  "mri-perfusion": 3,
  bone: 4,
  grayscale: 5,
  rainbow: 6,
  hotiron: 7,
  pet: 8,
  viridis: 9,
  coolwarm: 10,
};

const QUALITY_CONFIG: Record<Quality3D, { steps: number; dpr: number; normalStep: number }> = {
  performance: { steps: 256, dpr: 1.0, normalStep: 0.015 },
  balanced: { steps: 512, dpr: 1.25, normalStep: 0.008 },
  high: { steps: 768, dpr: 1.5, normalStep: 0.004 },
  ultra: { steps: 1024, dpr: 2.0, normalStep: 0.002 },
};

/**
 * Session-level volume cache with bounded LRU eviction (max 2 volumes in memory).
 * Avoids re-downloading the full voxel volume when the user toggles between
 * 2D planes and 3D while capping memory usage under 35 MB.
 */
const MAX_CACHED_VOLUMES = 2;
const volumeCache = new Map<string, LoadedVolume>();

function setCachedVolume(key: string, vol: LoadedVolume) {
  if (volumeCache.has(key)) {
    volumeCache.delete(key);
  } else if (volumeCache.size >= MAX_CACHED_VOLUMES) {
    const oldestKey = volumeCache.keys().next().value;
    if (oldestKey) volumeCache.delete(oldestKey);
  }
  volumeCache.set(key, vol);
}

export function Volume3DViewer({
  studyId,
  seriesId,
  modality = "CT",
  volumeUrl,
  sliceCount,
  sliceUrlAt,
  initialAnnotations = [],
  onAnnotationsChange,
  findings = [],
  activeFindingId = null,
  onSelectFinding,
  crosshairPos = null,
  onPointSelected,
}: {
  studyId: string;
  seriesId: string;
  modality?: Modality;
  volumeUrl?: string;
  sliceCount?: number;
  sliceUrlAt?: (index: number) => string | undefined;
  initialAnnotations?: Annotation3D[];
  onAnnotationsChange?: (annotations: Annotation3D[]) => void;
  findings?: Finding[];
  activeFindingId?: string | null;
  onSelectFinding?: (id: string) => void;
  crosshairPos?: { x: number; y: number; z: number } | null;
  onPointSelected?: (point: { x: number; y: number; z: number }) => void;
}) {
  const webglSupported = useWebGLSupport();
  const reduced = usePrefersReducedMotion();

  const clientUrl = volumeUrl && isDemoVolumeUrl(volumeUrl) ? volumeUrl : undefined;
  const stackCount =
    !clientUrl && volumeUrl && isDemoDicomUrl(volumeUrl) && sliceCount && sliceCount >= DEMO_MIN_STACK_SLICES
      ? sliceCount
      : undefined;

  const [volume, setVolume] = useState<LoadedVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Clinical controls
  const [threshold, setThreshold] = useState(modality === "MRI" ? 0.10 : 0.22);
  const [density, setDensity] = useState(modality === "MRI" ? 0.85 : 0.65);
  const [intensity, setIntensity] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [mip, setMip] = useState(false);
  const [colorMap, setColorMap] = useState<ColorMap3D>(modality === "MRI" ? "mri-tissue" : "bone");
  const [quality, setQuality] = useState<Quality3D>("high");
  const [autoRotate, setAutoRotate] = useState(false);

  // Clipping controls (1.0 = full extent, < 1.0 clips into volume)
  const [clipAxial, setClipAxial] = useState(1.0);
  const [clipCoronal, setClipCoronal] = useState(1.0);
  const [clipSagittal, setClipSagittal] = useState(1.0);
  const [showClippingMenu, setShowClippingMenu] = useState(false);

  // 3D Annotations & Finding Overlays
  const [annotations, setAnnotations] = useState<Annotation3D[]>(initialAnnotations);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [isAddingMarker, setIsAddingMarker] = useState(false);

  const controlsRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setVolume(null);
    setError(null);
    setGpuError(null);
    setProgress(null);

    const cacheKey = `${studyId}:${seriesId}`;
    const cached = volumeCache.get(cacheKey);

    (async () => {
      try {
        let loaded: LoadedVolume;
        if (cached) {
          loaded = cached;
        } else {
          loaded = clientUrl
            ? await loadClientVolume(clientUrl)
            : stackCount && sliceUrlAt
              ? await loadClientStack(sliceUrlAt, stackCount, cacheKey, {
                  signal: controller.signal,
                  onProgress: (done, total) => {
                    if (!cancelled) setProgress({ done, total });
                  },
                })
              : await loadServerVolume(studyId, seriesId);
          setCachedVolume(cacheKey, loaded);
        }
        if (!cancelled) {
          setVolume(loaded);
          const isMri = loaded.modality === "MRI" || modality === "MRI";
          const isClipped = !isMri && clippedFraction(loaded.data) < CLIPPED_FOR_COMPOSITE;
          setMip(isClipped);
          if (isMri) {
            setColorMap("mri-tissue");
            setThreshold(0.08);
            setDensity(0.9);
          } else {
            setColorMap(isClipped ? "grayscale" : "bone");
          }
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [studyId, seriesId, clientUrl, stackCount, sliceUrlAt, modality]);

  // Auto-upgrade quality to high once idle
  useEffect(() => {
    if (!volume) return;
    const hasIdle = typeof window !== "undefined" && "requestIdleCallback" in window;
    const id = hasIdle
      ? (window as any).requestIdleCallback(() => setQuality((q) => (q === "balanced" ? "high" : q)), { timeout: 2000 })
      : setTimeout(() => setQuality((q) => (q === "balanced" ? "high" : q)), 1500);

    return () => {
      if (hasIdle && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(id);
      } else {
        clearTimeout(id as ReturnType<typeof setTimeout>);
      }
    };
  }, [volume]);

  const handleAddAnnotation = (pos: [number, number, number]) => {
    const newAnn: Annotation3D = {
      id: `ann3d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      studyId,
      seriesId,
      type: "marker",
      position: pos,
      label: `Marker ${annotations.length + 1}`,
      color: "#38BDF8",
      createdAt: new Date().toISOString(),
    };
    const next = [...annotations, newAnn];
    setAnnotations(next);
    onAnnotationsChange?.(next);
    setIsAddingMarker(false);
  };

  const handleDeleteAnnotation = (id: string) => {
    const next = annotations.filter((a) => a.id !== id);
    setAnnotations(next);
    onAnnotationsChange?.(next);
  };

  const handleResetCamera = (view?: "anterior" | "posterior" | "lateral" | "superior") => {
    if (!controlsRef.current) return;
    const ctrl = controlsRef.current;
    if (view === "anterior") {
      ctrl.object.position.set(0, 0, 1.8);
    } else if (view === "posterior") {
      ctrl.object.position.set(0, 0, -1.8);
    } else if (view === "lateral") {
      ctrl.object.position.set(1.8, 0, 0);
    } else if (view === "superior") {
      ctrl.object.position.set(0, 1.8, 0.001);
    } else {
      ctrl.object.position.set(0, 0, 1.8);
    }
    ctrl.target.set(0, 0, 0);
    ctrl.update();
  };

  if (webglSupported === false) {
    return <Notice title="3D view unavailable">This browser or GPU does not support WebGL 2.0.</Notice>;
  }
  if (error) {
    return <Notice title="Unable to build the 3D volume">{error}</Notice>;
  }
  if (gpuError) {
    return <Notice title="3D shader error">{gpuError}</Notice>;
  }
  if (!volume) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-black text-center">
        <Loader2 className="h-6 w-6 animate-spin text-clinical" strokeWidth={1.8} />
        <p className="text-[13px] font-medium text-ink-primary">
          {progress
            ? `Assembling volume… ${progress.done}/${progress.total} slices (${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%)`
            : "Reconstructing 3D Volume…"}
        </p>
        <p className="max-w-xs text-[11px] text-ink-muted">
          Building hardware-accelerated 3D voxel field with calibrated medical transfer functions.
        </p>
        {progress && (
          <div className="mt-1 h-1 w-48 overflow-hidden rounded-full bg-[rgb(var(--overlay-hover)/0.15)]">
            <div
              className="h-full rounded-full bg-clinical transition-all duration-200"
              style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  const qConfig = QUALITY_CONFIG[quality];
  const volumeScale = getVolumeScale(volume);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-black select-none">
      <SceneErrorBoundary fallback={<Notice title="3D render error">3D volume rendering failed on this GPU.</Notice>}>
        <Canvas
          dpr={[1, qConfig.dpr]}
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          camera={{ position: [0, 0, 1.8], fov: 45 }}
        >
          <color attach="background" args={["#000000"]} />
          <ShaderErrorReporter onError={setGpuError} />

          <VolumeMesh
            volume={volume}
            threshold={threshold}
            density={density}
            intensity={intensity}
            brightness={brightness}
            contrast={contrast}
            mip={mip}
            colorMapIndex={COLOR_MAP_INDICES[colorMap]}
            qualityConfig={qConfig}
            clipMax={[clipSagittal - 0.5, clipCoronal - 0.5, clipAxial - 0.5]}
            crosshairPos={crosshairPos}
            isAddingMarker={isAddingMarker}
            onAddMarker={handleAddAnnotation}
            onPointSelected={onPointSelected}
          />

          {showAnnotations && (
            <>
              {/* User 3D markers */}
              <Annotations3DLayer
                annotations={annotations}
                volumeScale={volumeScale}
                onDelete={handleDeleteAnnotation}
              />

              {/* AI Findings projected in 3D */}
              {findings.length > 0 && (
                <Findings3DLayer
                  findings={findings}
                  activeFindingId={activeFindingId}
                  totalSlices={sliceCount || volume.dims[2]}
                  volumeScale={volumeScale}
                  onSelect={onSelectFinding}
                />
              )}
            </>
          )}

          {/* Crosshair 3D spatial indicator */}
          {crosshairPos && (
            <Crosshair3DLayer crosshairPos={crosshairPos} volumeScale={volumeScale} />
          )}

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enablePan={true}
            autoRotate={autoRotate && !reduced}
            autoRotateSpeed={0.8}
            minDistance={0.5}
            maxDistance={5}
            dampingFactor={0.08}
          />
        </Canvas>
      </SceneErrorBoundary>

      {/* Adding Marker HUD overlay */}
      {isAddingMarker && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-clinical bg-panel/90 px-4 py-1.5 text-xs font-semibold text-clinical-strong shadow-lg backdrop-blur">
          Click anywhere on anatomical structure to drop a 3D Marker
        </div>
      )}

      {/* Top Controls Bar */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {/* Transfer Function / Color Map Selector */}
          <div className="flex items-center gap-1.5 rounded-md border border-border-strong bg-panel/90 px-2.5 py-1 backdrop-blur shadow">
            <Palette className="h-3.5 w-3.5 text-clinical" />
            <select
              value={colorMap}
              onChange={(e) => setColorMap(e.target.value as ColorMap3D)}
              className="bg-transparent text-[11px] font-medium text-ink-primary outline-none cursor-pointer"
            >
              <optgroup label="MRI Intensity & Tissue" className="bg-panel font-semibold">
                <option value="mri-tissue">MRI Multi-Tissue (CSF/Gray/White/Tumor)</option>
                <option value="mri-t1">MRI T1 Anatomical Contrast</option>
                <option value="mri-flair">MRI T2/FLAIR Pathology & Edema</option>
                <option value="mri-perfusion">MRI Perfusion / Angio Flow</option>
              </optgroup>
              <optgroup label="Radiological & CT" className="bg-panel font-semibold">
                <option value="bone">CT Bone & Soft Tissue</option>
                <option value="grayscale">Grayscale (Radiologic)</option>
                <option value="pet">PET / Thermal Perfusion</option>
              </optgroup>
              <optgroup label="Perceptual & Analysis" className="bg-panel font-semibold">
                <option value="viridis">Viridis Uniform</option>
                <option value="coolwarm">Cool-Warm Diverging</option>
                <option value="hotiron">Hot Iron</option>
                <option value="rainbow">Rainbow Spectral</option>
              </optgroup>
            </select>
          </div>

          {/* Quality Preset Selector */}
          <div className="flex items-center gap-1.5 rounded-md border border-border-strong bg-panel/90 px-2.5 py-1 backdrop-blur shadow">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality3D)}
              className="bg-transparent text-[11px] font-medium text-ink-primary outline-none cursor-pointer"
            >
              <option value="performance" className="bg-panel">Performance (256)</option>
              <option value="balanced" className="bg-panel">Balanced (512)</option>
              <option value="high" className="bg-panel">High Quality (768)</option>
              <option value="ultra" className="bg-panel">Ultra Quality (1024)</option>
            </select>
          </div>

          {/* Anatomical Camera Views */}
          <div className="flex items-center gap-0.5 rounded-md border border-border-strong bg-panel/90 p-0.5 backdrop-blur shadow">
            <button
              onClick={() => handleResetCamera("anterior")}
              className="px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary hover:text-ink-primary"
              title="Anterior (Front) View"
            >
              ANT
            </button>
            <button
              onClick={() => handleResetCamera("lateral")}
              className="px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary hover:text-ink-primary"
              title="Lateral (Side) View"
            >
              LAT
            </button>
            <button
              onClick={() => handleResetCamera("superior")}
              className="px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary hover:text-ink-primary"
              title="Superior (Top) View"
            >
              SUP
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* Clipping planes toggle */}
          <div className="relative">
            <button
              onClick={() => setShowClippingMenu((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium backdrop-blur shadow",
                showClippingMenu || clipAxial < 1.0 || clipCoronal < 1.0 || clipSagittal < 1.0
                  ? "border-clinical bg-clinical-dim text-clinical-strong"
                  : "border-border-strong bg-panel/90 text-ink-secondary hover:text-ink-primary"
              )}
              title="3D Anatomical Clipping / Cut Planes"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>Clipping</span>
            </button>

            {showClippingMenu && (
              <div className="absolute top-9 right-0 z-50 w-64 rounded-xl border border-border-strong bg-panel/95 p-3 shadow-2xl backdrop-blur-md">
                <div className="mb-2 flex items-center justify-between border-b border-border-strong pb-1.5">
                  <span className="text-[11px] font-semibold uppercase text-ink-primary">Anatomical Cut Planes</span>
                  <button
                    onClick={() => {
                      setClipAxial(1.0);
                      setClipCoronal(1.0);
                      setClipSagittal(1.0);
                    }}
                    className="text-[10px] text-ink-muted hover:text-ink-primary"
                  >
                    Reset
                  </button>
                </div>
                <div className="space-y-2.5 text-[11px]">
                  <div>
                    <div className="flex justify-between text-ink-secondary mb-1">
                      <span>Axial Cut (Superior → Inferior)</span>
                      <span className="font-mono text-[10px]">{Math.round(clipAxial * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.01}
                      value={clipAxial}
                      onChange={(e) => setClipAxial(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-ink-secondary mb-1">
                      <span>Coronal Cut (Anterior → Posterior)</span>
                      <span className="font-mono text-[10px]">{Math.round(clipCoronal * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.01}
                      value={clipCoronal}
                      onChange={(e) => setClipCoronal(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-ink-secondary mb-1">
                      <span>Sagittal Cut (Lateral)</span>
                      <span className="font-mono text-[10px]">{Math.round(clipSagittal * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.01}
                      value={clipSagittal}
                      onChange={(e) => setClipSagittal(Number(e.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Add 3D Marker */}
          <button
            onClick={() => setIsAddingMarker((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium backdrop-blur transition-all shadow",
              isAddingMarker
                ? "border-clinical bg-clinical text-white"
                : "border-border-strong bg-panel/90 text-ink-secondary hover:text-ink-primary"
            )}
            title="Place anatomical 3D marker"
          >
            <MapPin className="h-3.5 w-3.5" />
            <span>{isAddingMarker ? "Cancel Marker" : "+ 3D Marker"}</span>
          </button>

          {/* Show / Hide 3D Annotations & Findings */}
          <button
            onClick={() => setShowAnnotations((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium backdrop-blur shadow",
              showAnnotations
                ? "border-border-strong bg-panel/90 text-ink-primary"
                : "border-border-strong bg-panel/50 text-ink-muted"
            )}
            title="Toggle 3D annotations and AI findings visibility"
          >
            {showAnnotations ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span>({annotations.length + findings.length})</span>
          </button>

          {/* Auto Rotate Toggle */}
          <button
            onClick={() => setAutoRotate((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border-strong bg-panel/90 px-2 py-1 text-[11px] text-ink-secondary backdrop-blur hover:text-ink-primary shadow"
            title="Toggle turntable camera orbit"
          >
            {autoRotate ? <Pause className="h-3.5 w-3.5 text-clinical" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-panel/90 px-3.5 py-2 backdrop-blur-md shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
            <Boxes className="h-3.5 w-3.5 text-clinical" /> {volume.dims.join("×")}
          </span>

          {volume.spacing && (
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
              {volume.spacing.map((s) => s.toFixed(2)).join("×")} mm
            </span>
          )}

          {volume.modality && (
            <span className="rounded bg-clinical/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-clinical">
              {volume.modality}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Threshold Slider */}
          <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
            Threshold
            <input
              type="range"
              min={0.01}
              max={0.80}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
              aria-label="Density threshold"
            />
            <span className="font-mono text-[10px] w-7">{Math.round(threshold * 100)}%</span>
          </label>

          {/* Opacity Slider */}
          <label
            className={cn("flex items-center gap-2 text-[11px]", mip ? "text-ink-muted opacity-50" : "text-ink-secondary")}
          >
            Opacity
            <input
              type="range"
              min={0.05}
              max={1.0}
              step={0.01}
              value={density}
              disabled={mip}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical disabled:opacity-40"
              aria-label="Volume opacity"
            />
            <span className="font-mono text-[10px] w-7">{Math.round(density * 100)}%</span>
          </label>

          {/* Intensity / Gamma Slider */}
          <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
            Intensity
            <input
              type="range"
              min={0.3}
              max={2.5}
              step={0.05}
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-[rgb(var(--overlay-hover)/0.18)] accent-clinical"
              aria-label="Intensity / Gamma"
            />
            <span className="font-mono text-[10px] w-7">{intensity.toFixed(1)}x</span>
          </label>

          {/* Brightness & Contrast quick toggles */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setBrightness((b) => (b === 1.0 ? 1.3 : 1.0))}
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-0.5 text-[10.5px] transition-colors",
                brightness > 1.0 ? "border-clinical bg-clinical-dim text-clinical-strong" : "border-border-strong text-ink-secondary hover:text-ink-primary"
              )}
              title="Toggle brightness boost"
            >
              <Sun className="h-3 w-3" />
            </button>
            <button
              onClick={() => setContrast((c) => (c === 1.0 ? 1.4 : 1.0))}
              className={cn(
                "flex items-center gap-1 rounded border px-2 py-0.5 text-[10.5px] transition-colors",
                contrast > 1.0 ? "border-clinical bg-clinical-dim text-clinical-strong" : "border-border-strong text-ink-secondary hover:text-ink-primary"
              )}
              title="Toggle contrast enhance"
            >
              <Contrast className="h-3 w-3" />
            </button>
          </div>

          {/* MIP Mode Toggle */}
          <button
            onClick={() => setMip((m) => !m)}
            className={cn(
              "rounded border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors",
              mip
                ? "border-clinical bg-clinical-dim text-clinical-strong"
                : "border-border-strong text-ink-secondary hover:text-ink-primary"
            )}
          >
            {mip ? "MIP Mode" : "Shaded 3D"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getVolumeScale(volume: LoadedVolume): [number, number, number] {
  const physical = [
    volume.dims[0] * volume.spacing[0],
    volume.dims[1] * volume.spacing[1],
    volume.dims[2] * volume.spacing[2],
  ];
  const longest = Math.max(...physical) || 1;
  return [physical[0] / longest, physical[1] / longest, physical[2] / longest];
}

interface LoadedVolume {
  data: Uint8Array;
  dims: [number, number, number];
  spacing: [number, number, number];
  window?: [number, number];
  windowUnit?: string;
  detail?: string;
  modality?: string;
}

async function loadServerVolume(studyId: string, seriesId: string): Promise<LoadedVolume> {
  const res = await fetch(`/api/studies/${studyId}/volume/${seriesId}?edge=256`, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `The server returned ${res.status}`);
  }
  const dims = parseTriple(res.headers.get("X-Volume-Dims"));
  const spacing = parseTriple(res.headers.get("X-Volume-Spacing"));
  if (!dims || !spacing) throw new Error("The volume response did not describe its own shape");
  const huWindow = parsePair(res.headers.get("X-Volume-Window"));
  const modality = res.headers.get("X-Volume-Modality") || undefined;

  const buf = await res.arrayBuffer();
  const expected = dims[0] * dims[1] * dims[2];
  if (buf.byteLength !== expected) {
    throw new Error(`Expected ${expected} voxels but received ${buf.byteLength}`);
  }
  return {
    data: new Uint8Array(buf),
    dims,
    spacing,
    window: huWindow,
    windowUnit: modality === "CT" ? "HU" : "Intensity",
    modality,
  };
}

async function loadClientVolume(volumeUrl: string): Promise<LoadedVolume> {
  const { loadDemoVolume8 } = await import("@/lib/demo/decode");
  return loadDemoVolume8(volumeUrl);
}

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

/** 3D Annotations rendering layer for user-placed markers */
function Annotations3DLayer({
  annotations,
  volumeScale,
  onDelete,
}: {
  annotations: Annotation3D[];
  volumeScale: [number, number, number];
  onDelete: (id: string) => void;
}) {
  return (
    <group>
      {annotations.map((ann) => {
        const pos: [number, number, number] = [
          ann.position[0] * volumeScale[0],
          ann.position[1] * volumeScale[1],
          ann.position[2] * volumeScale[2],
        ];

        return (
          <group key={ann.id} position={pos}>
            <mesh>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshStandardMaterial
                color={ann.color || "#38BDF8"}
                emissive={ann.color || "#38BDF8"}
                emissiveIntensity={0.7}
              />
            </mesh>

            <Html distanceFactor={2.2} center>
              <div
                className="flex items-center gap-1.5 rounded-full border border-sky-400/80 bg-black/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow-xl backdrop-blur select-none pointer-events-auto"
                style={{ transform: "translateY(-140%)" }}
              >
                <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                <span>{ann.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(ann.id);
                  }}
                  className="ml-1 text-ink-muted hover:text-red-400"
                  title="Remove 3D marker"
                >
                  ×
                </button>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/** 3D Findings Layer: Projects 2D AI finding detections into spatial 3D volume bounding boxes & markers */
function Findings3DLayer({
  findings,
  activeFindingId,
  totalSlices,
  volumeScale,
  onSelect,
}: {
  findings: Finding[];
  activeFindingId: string | null;
  totalSlices: number;
  volumeScale: [number, number, number];
  onSelect?: (id: string) => void;
}) {
  return (
    <group>
      {findings.map((f) => {
        const isNegative = f.label.toLowerCase().startsWith("no ");
        if (isNegative) return null;

        const isActive = f.id === activeFindingId;
        const color = f.band === "high" ? "#22C55E" : f.band === "moderate" ? "#F59E0B" : "#EF4444";

        // Map normalized 2D image coordinates [0..1] and slice index into 3D box coordinates [-0.5..0.5]
        const posX = (f.region.x + f.region.w / 2 - 0.5) * volumeScale[0];
        const posY = -(f.region.y + f.region.h / 2 - 0.5) * volumeScale[1];
        const posZ = ((f.sliceIndex / Math.max(1, totalSlices - 1)) - 0.5) * volumeScale[2];

        const boxW = Math.max(0.04, f.region.w * volumeScale[0]);
        const boxH = Math.max(0.04, f.region.h * volumeScale[1]);
        const boxD = Math.max(0.03, (2 / Math.max(1, totalSlices)) * volumeScale[2]);

        return (
          <group
            key={f.id}
            position={[posX, posY, posZ]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(f.id);
            }}
          >
            {/* 3D Wireframe Bounding Box with proper GPU buffer disposal */}
            <Finding3DWireframeBox boxW={boxW} boxH={boxH} boxD={boxD} color={color} isActive={isActive} />

            {/* Glowing 3D Center Sphere */}
            <mesh>
              <sphereGeometry args={[0.015, 12, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>

            {/* Billboard HTML Pin with Label & Confidence */}
            <Html distanceFactor={2.4} center>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(f.id);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold text-white shadow-2xl backdrop-blur transition-all pointer-events-auto",
                  isActive
                    ? "border-white bg-black/95 ring-2 ring-clinical scale-110"
                    : "border-border-strong bg-black/80 hover:bg-black/95"
                )}
                style={{
                  transform: "translateY(-130%)",
                  borderColor: color,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
                <span className="whitespace-nowrap">{f.label}</span>
                <span className="opacity-75 font-mono text-[9px]">{f.confidence}%</span>
              </button>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function Finding3DWireframeBox({
  boxW,
  boxH,
  boxD,
  color,
  isActive,
}: {
  boxW: number;
  boxH: number;
  boxD: number;
  color: string;
  isActive: boolean;
}) {
  const geom = useMemo(() => {
    const box = new THREE.BoxGeometry(boxW, boxH, boxD);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [boxW, boxH, boxD]);

  useEffect(() => {
    return () => {
      geom.dispose();
    };
  }, [geom]);

  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color={color} linewidth={isActive ? 2 : 1} transparent opacity={isActive ? 0.95 : 0.65} />
    </lineSegments>
  );
}

/** 3D Reference Crosshair Layer: Displays the spatial position of the 2D crosshair inside the 3D volume */
function Crosshair3DLayer({
  crosshairPos,
  volumeScale,
}: {
  crosshairPos: { x: number; y: number; z: number };
  volumeScale: [number, number, number];
}) {
  const posX = (crosshairPos.x - 0.5) * volumeScale[0];
  const posY = -(crosshairPos.y - 0.5) * volumeScale[1];
  const posZ = (crosshairPos.z - 0.5) * volumeScale[2];

  return (
    <group position={[posX, posY, posZ]}>
      {/* 3D Focal target crosshair */}
      <mesh>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color="#00F0FF" />
      </mesh>
      {/* Orthogonal reference guides */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -0.08, 0, 0, 0.08, 0, 0,
                0, -0.08, 0, 0, 0.08, 0,
                0, 0, -0.08, 0, 0, 0.08,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#00F0FF" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

function VolumeMesh({
  volume,
  threshold,
  density,
  intensity,
  brightness,
  contrast,
  mip,
  colorMapIndex,
  qualityConfig,
  clipMax,
  crosshairPos,
  isAddingMarker,
  onAddMarker,
  onPointSelected,
}: {
  volume: LoadedVolume;
  threshold: number;
  density: number;
  intensity: number;
  brightness: number;
  contrast: number;
  mip: boolean;
  colorMapIndex: number;
  qualityConfig: { steps: number; normalStep: number };
  clipMax: [number, number, number];
  crosshairPos: { x: number; y: number; z: number } | null;
  isAddingMarker: boolean;
  onAddMarker: (pos: [number, number, number]) => void;
  onPointSelected?: (point: { x: number; y: number; z: number }) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

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
      uIntensity: { value: intensity },
      uBrightness: { value: brightness },
      uContrast: { value: contrast },
      uMip: { value: mip ? 1 : 0 },
      uColorMap: { value: colorMapIndex },
      uSteps: { value: qualityConfig.steps },
      uNormalStep: { value: qualityConfig.normalStep },
      uClipMax: { value: new THREE.Vector3(...clipMax) },
    }),
    [texture]
  );

  useEffect(() => {
    uniforms.uThreshold.value = threshold;
    uniforms.uDensity.value = density;
    uniforms.uIntensity.value = intensity;
    uniforms.uBrightness.value = brightness;
    uniforms.uContrast.value = contrast;
    uniforms.uMip.value = mip ? 1 : 0;
    uniforms.uColorMap.value = colorMapIndex;
    uniforms.uSteps.value = qualityConfig.steps;
    uniforms.uNormalStep.value = qualityConfig.normalStep;
    uniforms.uClipMax.value.set(...clipMax);
  }, [uniforms, threshold, density, intensity, brightness, contrast, mip, colorMapIndex, qualityConfig, clipMax]);

  const scale = useMemo(() => getVolumeScale(volume), [volume]);

  const handlePointerDown = (e: any) => {
    if (!meshRef.current || !e.point) return;
    const inv = meshRef.current.matrixWorld.clone().invert();
    const localPt = e.point.clone().applyMatrix4(inv);

    if (isAddingMarker) {
      e.stopPropagation();
      onAddMarker([localPt.x, localPt.y, localPt.z]);
    } else if (onPointSelected) {
      // 2D <-> 3D Synchronization: Convert 3D mesh coordinates [-0.5..0.5] to normalized patient space [0..1]
      const normX = Math.max(0, Math.min(1, localPt.x + 0.5));
      const normY = Math.max(0, Math.min(1, -localPt.y + 0.5));
      const normZ = Math.max(0, Math.min(1, localPt.z + 0.5));
      onPointSelected({ x: normX, y: normY, z: normZ });
    }
  };

  return (
    <mesh ref={meshRef} scale={scale} onPointerDown={handlePointerDown}>
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
    vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  layout(location = 0) out highp vec4 fragColor;

  uniform sampler3D uVolume;
  uniform float uThreshold;
  uniform float uDensity;
  uniform float uIntensity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uMip;
  uniform int uColorMap;
  uniform float uSteps;
  uniform float uNormalStep;
  uniform vec3 uClipMax;

  varying vec3 vOrigin;
  varying vec3 vDirection;

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

  // Central difference surface normal calculation
  vec3 sampleNormal(vec3 p, float stepSize) {
    vec3 tc = p + 0.5;
    float dx = texture(uVolume, tc + vec3(stepSize, 0.0, 0.0)).r - texture(uVolume, tc - vec3(stepSize, 0.0, 0.0)).r;
    float dy = texture(uVolume, tc + vec3(0.0, stepSize, 0.0)).r - texture(uVolume, tc - vec3(0.0, stepSize, 0.0)).r;
    float dz = texture(uVolume, tc + vec3(0.0, 0.0, stepSize)).r - texture(uVolume, tc - vec3(0.0, 0.0, stepSize)).r;
    vec3 n = vec3(dx, dy, dz);
    float l = length(n);
    return l > 0.001 ? n / l : vec3(0.0, 0.0, 1.0);
  }

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // Clinical transfer functions
  vec3 applyColorMap(float val, int cm) {
    // 0: MRI Multi-Tissue (Anatomical differentiation: CSF, Gray Matter, White Matter, Lesions)
    if (cm == 0) {
      if (val < 0.16) {
        return mix(vec3(0.04, 0.10, 0.25), vec3(0.12, 0.35, 0.55), val / 0.16);
      } else if (val < 0.45) {
        float t = (val - 0.16) / 0.29;
        return mix(vec3(0.68, 0.44, 0.30), vec3(0.86, 0.62, 0.44), t);
      } else if (val < 0.78) {
        float t = (val - 0.45) / 0.33;
        return mix(vec3(0.88, 0.82, 0.72), vec3(1.0, 0.98, 0.94), t);
      } else {
        float t = (val - 0.78) / 0.22;
        return mix(vec3(0.95, 0.25, 0.15), vec3(0.20, 0.95, 0.90), t);
      }
    }
    // 1: MRI T1 Anatomical Contrast
    if (cm == 1) {
      if (val < 0.20) {
        return mix(vec3(0.08, 0.08, 0.12), vec3(0.40, 0.35, 0.32), val / 0.20);
      } else if (val < 0.60) {
        return mix(vec3(0.40, 0.35, 0.32), vec3(0.85, 0.80, 0.76), (val - 0.20) / 0.40);
      } else {
        return mix(vec3(0.85, 0.80, 0.76), vec3(1.0, 0.98, 0.95), (val - 0.60) / 0.40);
      }
    }
    // 2: MRI T2/FLAIR Pathology & Edema
    if (cm == 2) {
      if (val < 0.30) {
        return mix(vec3(0.02, 0.03, 0.06), vec3(0.35, 0.38, 0.42), val / 0.30);
      } else if (val < 0.65) {
        return mix(vec3(0.35, 0.38, 0.42), vec3(0.75, 0.78, 0.82), (val - 0.30) / 0.35);
      } else {
        return mix(vec3(0.10, 0.85, 0.95), vec3(1.0, 0.95, 0.20), (val - 0.65) / 0.35);
      }
    }
    // 3: MRI Perfusion / Angio Flow
    if (cm == 3) {
      if (val < 0.25) {
        return mix(vec3(0.02, 0.05, 0.18), vec3(0.10, 0.65, 0.50), val / 0.25);
      } else if (val < 0.65) {
        return mix(vec3(0.10, 0.65, 0.50), vec3(0.95, 0.65, 0.10), (val - 0.25) / 0.40);
      } else {
        return mix(vec3(0.95, 0.65, 0.10), vec3(1.0, 0.15, 0.20), (val - 0.65) / 0.35);
      }
    }
    // 4: Bone & Soft Tissue (CT)
    if (cm == 4) {
      if (val < 0.25) {
        return mix(vec3(0.05, 0.1, 0.2), vec3(0.65, 0.2, 0.15), val / 0.25);
      } else if (val < 0.65) {
        return mix(vec3(0.65, 0.2, 0.15), vec3(0.92, 0.58, 0.35), (val - 0.25) / 0.4);
      } else {
        return mix(vec3(0.92, 0.58, 0.35), vec3(1.0, 0.98, 0.92), (val - 0.65) / 0.35);
      }
    }
    // 5: Grayscale
    if (cm == 5) {
      return vec3(val);
    }
    // 6: Rainbow / Spectrum
    if (cm == 6) {
      float h = (1.0 - val) * 0.8;
      vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      return c;
    }
    // 7: Hot Iron / Thermal
    if (cm == 7) {
      return vec3(
        smoothstep(0.0, 0.33, val),
        smoothstep(0.33, 0.66, val),
        smoothstep(0.66, 1.0, val)
      );
    }
    // 8: PET / Perfusion
    if (cm == 8) {
      if (val < 0.3) {
        return mix(vec3(0.02, 0.05, 0.25), vec3(0.0, 0.8, 0.6), val / 0.3);
      } else if (val < 0.7) {
        return mix(vec3(0.0, 0.8, 0.6), vec3(0.95, 0.8, 0.1), (val - 0.3) / 0.4);
      } else {
        return mix(vec3(0.95, 0.8, 0.1), vec3(1.0, 0.1, 0.4), (val - 0.7) / 0.3);
      }
    }
    // 9: Viridis
    if (cm == 9) {
      vec3 c0 = vec3(0.267, 0.004, 0.329);
      vec3 c1 = vec3(0.127, 0.566, 0.550);
      vec3 c2 = vec3(0.993, 0.906, 0.143);
      return val < 0.5 ? mix(c0, c1, val * 2.0) : mix(c1, c2, (val - 0.5) * 2.0);
    }
    // 10: Cool-Warm
    if (cm == 10) {
      return mix(vec3(0.23, 0.29, 0.75), vec3(0.70, 0.01, 0.15), val);
    }
    return vec3(val);
  }

  void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDir);
    if (bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);

    float dt = (bounds.y - bounds.x) / uSteps;
    // Stochastic ray jittering to eliminate wood-grain slicing artifacts
    float jitter = random(gl_FragCoord.xy) * dt;
    vec3 p = vOrigin + rayDir * (bounds.x + jitter);
    vec3 stepVec = rayDir * dt;

    float headroom = max(1.0 - uThreshold, 0.001);
    float brightest = 0.0;
    vec3 accColor = vec3(0.0);
    float accAlpha = 0.0;

    vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));

    for (float i = 0.0; i < 1024.0; i += 1.0) {
      if (i >= uSteps) break;

      // 3D Clipping Planes Check
      if (p.x > uClipMax.x || p.y > uClipMax.y || p.z > uClipMax.z) {
        p += stepVec;
        continue;
      }

      float v = texture(uVolume, p + 0.5).r;

      if (v > uThreshold) {
        float w = (v - uThreshold) / headroom;
        // Apply Contrast, Brightness & Intensity Gamma
        w = clamp(((w - 0.5) * uContrast + 0.5) * uBrightness, 0.0, 1.0);
        w = pow(w, 1.0 / max(0.2, uIntensity));

        if (uMip > 0.5) {
          brightest = max(brightest, w);
        } else {
          // Blinn-Phong shaded volume rendering with surface gradient normals
          vec3 n = sampleNormal(p, uNormalStep);
          float diffuse = max(dot(n, lightDir), 0.30);
          float specular = pow(max(dot(reflect(-lightDir, n), -rayDir), 0.0), 24.0) * 0.40;

          vec3 baseColor = applyColorMap(w, uColorMap);
          vec3 litColor = baseColor * (diffuse + 0.15) + vec3(specular);

          float a = w * uDensity * (512.0 / uSteps) * 0.14;
          a = clamp(a, 0.0, 1.0);

          accColor += (1.0 - accAlpha) * litColor * a;
          accAlpha += (1.0 - accAlpha) * a;
          if (accAlpha > 0.985) break;
        }
      }

      p += stepVec;
    }

    if (uMip > 0.5) {
      if (brightest <= 0.0) discard;
      vec3 col = applyColorMap(brightest, uColorMap);
      fragColor = vec4(col, 1.0);
    } else {
      if (accAlpha <= 0.0) discard;
      fragColor = vec4(accColor / max(accAlpha, 0.001) * accAlpha, accAlpha);
    }
  }
`;

function clippedFraction(data: Uint8Array): number {
  let clipped = 0;
  let seen = 0;
  for (let i = 0; i < data.length; i += 7) {
    if (data[i] >= 250) clipped++;
    seen++;
  }
  return seen > 0 ? clipped / seen : 0;
}

const CLIPPED_FOR_COMPOSITE = 0.04;

function ShaderErrorReporter({ onError }: { onError: (message: string) => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const previous = gl.debug.onShaderError;
    gl.debug.onShaderError = (context, program, vertexShader, fragmentShader) => {
      const vertexLog = context.getShaderInfoLog(vertexShader)?.trim() ?? "";
      const fragmentLog = context.getShaderInfoLog(fragmentShader)?.trim() ?? "";
      const programLog = context.getProgramInfoLog(program)?.trim() ?? "";
      const first =
        (fragmentLog || vertexLog || programLog).split("\n").find((line) => line.trim().length > 0) ??
        "no diagnostic";

      console.error(`[Volume3D] error: ${first}`);
      onError("The volume shader failed to link on this GPU.");
    };
    return () => {
      gl.debug.onShaderError = previous;
    };
  }, [gl, onError]);

  return null;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-black text-center p-6">
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

function parsePair(raw: string | null): [number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  return [parts[0], parts[1]];
}
