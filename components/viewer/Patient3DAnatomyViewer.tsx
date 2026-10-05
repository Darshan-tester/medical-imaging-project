"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  Boxes,
  Box,
  Eye,
  EyeOff,
  Sliders,
  Scissors,
  RotateCcw,
  Sparkles,
  Layers,
  Compass,
  Activity,
  Maximize2,
  Minimize2,
  Check,
  Target,
  Sun,
  Palette,
  Info,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { SceneErrorBoundary } from "@/components/three/SceneErrorBoundary";
import { isDemoDicomUrl, isDemoVolumeUrl, DEMO_MIN_STACK_SLICES } from "@/lib/demo/types";
import { useWebGLSupport, usePrefersReducedMotion } from "@/lib/hooks";
import { ColorMap3D, Quality3D, Annotation3D, Finding, Modality, ViewerAnnotation } from "@/lib/types";
import {
  AnatomicalLayer,
  AnatomicalClipping,
  DEFAULT_CLIPPING,
  buildAnatomicalLayers,
  CATEGORY_LABELS,
  AnatomicalCategory,
} from "@/lib/anatomy-state";
import { cn } from "@/lib/utils";

const gltfLoader = new GLTFLoader();
const meshModelCache = new Map<string, THREE.Group>();

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

interface LoadedVolume {
  data: Uint8Array;
  dims: [number, number, number];
  spacing: [number, number, number];
  window?: [number, number];
  windowUnit?: string;
  detail?: string;
  modality?: string;
}

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

function parseTriple(raw: string | null): [number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return parts as [number, number, number];
  }
  return null;
}

function parsePair(raw: string | null): [number, number] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1]];
  }
  return undefined;
}

async function loadServerVolume(studyId: string, seriesId: string): Promise<LoadedVolume> {
  const res = await fetch(`/api/studies/${encodeURIComponent(studyId)}/volume/${encodeURIComponent(seriesId)}?edge=256`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `The server returned ${res.status}`);
  }
  const dims = parseTriple(res.headers.get("X-Volume-Dims"));
  const spacing = parseTriple(res.headers.get("X-Volume-Spacing"));
  if (!dims || !spacing) throw new Error("The volume response did not describe its own dimensions/spacing");
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

function getVolumeScale(volume: LoadedVolume): [number, number, number] {
  const lx = volume.dims[0] * volume.spacing[0];
  const ly = volume.dims[1] * volume.spacing[1];
  const lz = volume.dims[2] * volume.spacing[2];
  const longest = Math.max(lx, ly, lz) || 1;
  return [lx / longest, ly / longest, lz / longest];
}

export interface Patient3DAnatomyViewerProps {
  studyId: string;
  seriesId?: string;
  modality?: Modality;
  volumeUrl?: string;
  sliceCount?: number;
  sliceUrlAt?: (index: number) => string | undefined;
  crosshairPos?: { x: number; y: number; z: number } | null;
  onPointSelected?: (point: { x: number; y: number; z: number }) => void;
  // Annotations & Findings
  initialAnnotations?: Annotation3D[];
  onAnnotationsChange?: (annotations: Annotation3D[]) => void;
  findings?: Finding[];
  annotations?: ViewerAnnotation[];
  activeFindingId?: string | null;
  onSelectFinding?: (id: string) => void;
  onSelectFindingMarker?: (
    findingId: string,
    sliceIndex: number,
    normX: number,
    normY: number,
    seriesId?: string
  ) => void;
  // Legacy organ mesh bridges
  organMeshes?: any[];
  onOrganMeshesChange?: (meshes: any[]) => void;
  onSelectOrgan?: (id: string | null) => void;
  activeOrganId?: string | null;
  onLayerSelect?: (layer: AnatomicalLayer) => void;
  // External Layer State
  layers?: AnatomicalLayer[];
  onLayersChange?: (layers: AnatomicalLayer[]) => void;
  selectedStructureId?: string | null;
  onSelectStructure?: (structureId: string | null) => void;
  // External Clipping State
  clipping?: AnatomicalClipping;
  onClippingChange?: (clipping: AnatomicalClipping) => void;
  // UI Layout
  bodyRegion?: string;
  className?: string;
  height?: string | number;
  showLayerPanel?: boolean;
}

export function Patient3DAnatomyViewer({
  studyId,
  seriesId,
  modality = "CT",
  bodyRegion,
  volumeUrl,
  sliceCount,
  sliceUrlAt,
  crosshairPos = null,
  onPointSelected,
  initialAnnotations,
  onAnnotationsChange,
  findings = [],
  annotations = [],
  activeFindingId = null,
  onSelectFinding,
  onSelectFindingMarker,
  organMeshes,
  onOrganMeshesChange,
  onSelectOrgan,
  activeOrganId,
  onLayerSelect,
  layers: externalLayers,
  onLayersChange,
  selectedStructureId = null,
  onSelectStructure,
  clipping: externalClipping,
  onClippingChange,
  className,
  height = "100%",
  showLayerPanel = true,
}: Patient3DAnatomyViewerProps) {
  const webglSupported = useWebGLSupport();
  const controlsRef = useRef<any>(null);

  const clientUrl = volumeUrl && isDemoVolumeUrl(volumeUrl) ? volumeUrl : undefined;
  const stackCount =
    !clientUrl && volumeUrl && isDemoDicomUrl(volumeUrl) && sliceCount && sliceCount >= DEMO_MIN_STACK_SLICES
      ? sliceCount
      : undefined;

  // Volume state
  const [volume, setVolume] = useState<LoadedVolume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Internal Layers & Clipping if not controlled
  const [internalLayers, setInternalLayers] = useState<AnatomicalLayer[]>([]);
  const layers = externalLayers ?? internalLayers;
  const setLayers = onLayersChange || setInternalLayers;

  const [internalClipping, setInternalClipping] = useState<AnatomicalClipping>(DEFAULT_CLIPPING);
  const clipping = externalClipping ?? internalClipping;
  const setClipping = useCallback(
    (action: AnatomicalClipping | ((prev: AnatomicalClipping) => AnatomicalClipping)) => {
      setInternalClipping((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        onClippingChange?.(next);
        return next;
      });
    },
    [onClippingChange]
  );

  // Viewport Settings
  const [showOriginalVolume, setShowOriginalVolume] = useState(true);
  const [showSegmentedMeshes, setShowSegmentedMeshes] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [quality, setQuality] = useState<Quality3D>("high");
  const [colorMap, setColorMap] = useState<ColorMap3D>(modality === "MRI" ? "mri-tissue" : "bone");
  const [threshold, setThreshold] = useState(modality === "MRI" ? 0.08 : 0.22);
  const [density, setDensity] = useState(modality === "MRI" ? 0.9 : 0.65);
  const [intensity, setIntensity] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [mip, setMip] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<AnatomicalCategory>("ORGANS");
  const [hoveredFindingMarker, setHoveredFindingMarker] = useState<InteractiveMarkerData | null>(null);

  // Load canonical volume data
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
            : await loadServerVolume(studyId, seriesId || "volume");
          setCachedVolume(cacheKey, loaded);
        }
        if (!cancelled) {
          setVolume(loaded);
          const isMri = loaded.modality === "MRI" || modality === "MRI";
          if (isMri) {
            setColorMap("mri-tissue");
            setThreshold(0.08);
            setDensity(0.9);
          } else {
            setColorMap("bone");
            setThreshold(0.22);
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

  // Load derived segmentation manifest to populate anatomical layers
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/studies/${encodeURIComponent(studyId)}/analysis`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const initialLayers = buildAnatomicalLayers(
          studyId,
          data.segments || [],
          data.meshes || [],
          modality,
          false,
          bodyRegion
        );
        setLayers(initialLayers);
      })
      .catch(() => {
        if (!cancelled) {
          const fallbackLayers = buildAnatomicalLayers(studyId, [], [], modality, false, bodyRegion);
          setLayers(fallbackLayers);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [studyId, modality, bodyRegion]);

  // Synchronize 2D crosshair position with 3D clipping planes if syncWithSlice is enabled
  useEffect(() => {
    if (!crosshairPos) return;
    setClipping((prev) => {
      let changed = false;
      const next = { ...prev };
      if (prev.axial.syncWithSlice && Math.abs(prev.axial.position - crosshairPos.z) > 0.001) {
        next.axial = { ...prev.axial, position: crosshairPos.z };
        changed = true;
      }
      if (prev.coronal.syncWithSlice && Math.abs(prev.coronal.position - crosshairPos.y) > 0.001) {
        next.coronal = { ...prev.coronal, position: crosshairPos.y };
        changed = true;
      }
      if (prev.sagittal.syncWithSlice && Math.abs(prev.sagittal.position - crosshairPos.x) > 0.001) {
        next.sagittal = { ...prev.sagittal, position: crosshairPos.x };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [crosshairPos, setClipping]);

  const volumeScale = useMemo(
    () => (volume ? getVolumeScale(volume) : ([1, 1, 1] as [number, number, number])),
    [volume]
  );

  // Build physical 3D clipping planes passing through actual patient volume
  const clippingPlanes = useMemo(() => {
    if (!volume) return [];
    const planes: THREE.Plane[] = [];

    // Axial (Z axis)
    if (clipping.axial.enabled) {
      const normal = clipping.axial.reverse ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
      const constant = clipping.axial.reverse
        ? -(clipping.axial.position - 0.5) * volumeScale[2]
        : (clipping.axial.position - 0.5) * volumeScale[2];
      planes.push(new THREE.Plane(normal, constant));
    }

    // Coronal (Y axis)
    if (clipping.coronal.enabled) {
      const normal = clipping.coronal.reverse ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
      const constant = clipping.coronal.reverse
        ? (clipping.coronal.position - 0.5) * volumeScale[1]
        : -(clipping.coronal.position - 0.5) * volumeScale[1];
      planes.push(new THREE.Plane(normal, constant));
    }

    // Sagittal (X axis)
    if (clipping.sagittal.enabled) {
      const normal = clipping.sagittal.reverse ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
      const constant = clipping.sagittal.reverse
        ? -(clipping.sagittal.position - 0.5) * volumeScale[0]
        : (clipping.sagittal.position - 0.5) * volumeScale[0];
      planes.push(new THREE.Plane(normal, constant));
    }

    return planes;
  }, [clipping, volumeScale, volume]);

  // Layer Control Handlers
  const handleToggleLayer = (layerId: string) => {
    setLayers(
      layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible, isolated: false } : l))
    );
  };

  const handleLayerOpacity = (layerId: string, opacity: number) => {
    setLayers(layers.map((l) => (l.id === layerId ? { ...l, opacity } : l)));
  };

  const handleIsolateLayer = (layerId: string) => {
    const target = layers.find((l) => l.id === layerId);
    const currentlyIsolated = target?.isolated;

    setLayers(
      layers.map((l) => {
        if (l.id === layerId) {
          return { ...l, isolated: !currentlyIsolated, visible: true };
        }
        return { ...l, isolated: false, visible: currentlyIsolated ? true : false };
      })
    );
  };

  const handleShowAll = () => {
    setLayers(layers.map((l) => ({ ...l, visible: l.availability === "available", isolated: false, opacity: 0.75 })));
  };

  const handleHideAll = () => {
    setLayers(layers.map((l) => ({ ...l, visible: false, isolated: false })));
  };

  const handleResetLayers = () => {
    setLayers(
      layers.map((l) => ({
        ...l,
        visible: l.availability === "available" && l.id !== "skin_body",
        isolated: false,
        opacity: l.category === "BONE" ? 0.85 : 0.75,
      }))
    );
  };

  const handleIsolateSelected = () => {
    if (!selectedStructureId) return;
    handleIsolateLayer(selectedStructureId);
  };

  // Camera Orientation Presets
  const setCameraPreset = (view: "anterior" | "posterior" | "lateral_left" | "lateral_right" | "superior" | "inferior") => {
    if (!controlsRef.current) return;
    const ctrl = controlsRef.current;
    ctrl.reset();
    const d = 1.9;

    switch (view) {
      case "anterior": // AP
        ctrl.object.position.set(0, 0, d);
        break;
      case "posterior": // PA
        ctrl.object.position.set(0, 0, -d);
        break;
      case "lateral_left": // LAT-L
        ctrl.object.position.set(d, 0, 0);
        break;
      case "lateral_right": // LAT-R
        ctrl.object.position.set(-d, 0, 0);
        break;
      case "superior": // Cranial
        ctrl.object.position.set(0, d, 0.001);
        break;
      case "inferior": // Caudal
        ctrl.object.position.set(0, -d, 0.001);
        break;
    }
    ctrl.target.set(0, 0, 0);
    ctrl.update();
  };

  const resetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
      controlsRef.current.object.position.set(0, 0, 1.9);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const hasIsolated = layers.some((l) => l.isolated);
  const availableLayers = layers.filter((l) => l.availability === "available");
  const visibleMeshes = layers.filter(
    (l) => l.availability === "available" && l.meshUrl && (hasIsolated ? l.isolated : l.visible)
  );

  const qConfig = QUALITY_CONFIG[quality];

  return (
    <div
      className={cn(
        "relative flex h-full w-full overflow-hidden bg-[#000000] select-none text-slate-200",
        isFullscreen && "fixed inset-0 z-50",
        className
      )}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* ── 3D Viewport Left/Center Stage ── */}
      <div className="relative flex-1 h-full min-w-0 flex flex-col overflow-hidden bg-black">
        {/* Top Floating Diagnostic Toolbar */}
        <div className="absolute top-2 left-2 right-2 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          {/* Left: Study Provenance Header */}
          <div className="flex items-center gap-2 rounded-lg bg-[#0d121c]/90 px-3 py-1.5 backdrop-blur-md border border-[#1e293b] shadow pointer-events-auto">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-sky-500/20 text-sky-400">
              <Box className="h-3 w-3" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-white tracking-tight">Patient 3D Anatomy</span>
                <span className="rounded bg-sky-950/80 border border-sky-500/50 px-1.5 py-0.2 text-[9px] font-mono text-sky-300 font-bold">
                  PATIENT-DERIVED
                </span>
              </div>
              <span className="block text-[9.5px] font-mono text-slate-400">
                {availableLayers.length} segmented structures · MONAI TotalSegmentator
              </span>
            </div>
          </div>

          {/* Right: Camera Presets & Rendering Presets */}
          <div className="flex items-center gap-1.5 rounded-lg bg-[#0d121c]/90 p-1 backdrop-blur-md border border-[#1e293b] shadow pointer-events-auto">
            {/* Camera Presets */}
            <div className="flex items-center border-r border-[#1e293b] pr-1 mr-0.5 gap-0.5">
              {(
                [
                  { label: "AP", title: "Anterior (Frontal)", key: "anterior" },
                  { label: "PA", title: "Posterior (Back)", key: "posterior" },
                  { label: "LAT-L", title: "Left Lateral", key: "lateral_left" },
                  { label: "LAT-R", title: "Right Lateral", key: "lateral_right" },
                  { label: "SUP", title: "Superior (Cranial)", key: "superior" },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.key}
                  onClick={() => setCameraPreset(btn.key)}
                  title={btn.title}
                  className="rounded px-1.5 py-0.5 text-[9.5px] font-mono font-medium text-slate-300 hover:bg-sky-600/30 hover:text-sky-300 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Colormap Preset */}
            <select
              value={colorMap}
              onChange={(e) => setColorMap(e.target.value as ColorMap3D)}
              className="rounded border border-[#1e293b] bg-[#111827] px-2 py-0.5 text-[10.5px] font-mono text-slate-200 outline-none cursor-pointer"
            >
              <option value="bone">Bone CT</option>
              <option value="mri-tissue">Soft Tissue</option>
              <option value="grayscale">Grayscale</option>
              <option value="hotiron">Hot Iron</option>
              <option value="pet">PET Thermal</option>
            </select>

            {/* Quality Preset */}
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality3D)}
              className="rounded border border-[#1e293b] bg-[#111827] px-2 py-0.5 text-[10.5px] font-mono text-slate-200 outline-none cursor-pointer"
            >
              <option value="performance">256 Steps</option>
              <option value="balanced">512 Steps</option>
              <option value="high">768 Steps</option>
              <option value="ultra">1024 Steps</option>
            </select>

            {/* Wireframe Toggle */}
            <button
              onClick={() => setWireframe(!wireframe)}
              className={cn(
                "rounded p-1 text-xs transition-colors",
                wireframe ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
              )}
              title={wireframe ? "Solid Surfaces" : "Wireframe Mesh"}
            >
              <Layers className="h-3.5 w-3.5" />
            </button>

            {/* Reset Camera */}
            <button
              onClick={resetCamera}
              className="rounded p-1 text-slate-400 hover:text-white transition-colors"
              title="Reset Camera View"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="rounded p-1 text-slate-400 hover:text-white transition-colors"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Viewport"}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* ── WebGL Canvas Stage ── */}
        <div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing">
          {webglSupported === false && (
            <div className="flex h-full w-full items-center justify-center p-6 text-center text-slate-400">
              <AlertTriangle className="h-8 w-8 text-amber-400 mb-2" />
              <p className="text-xs">WebGL 2.0 is not supported by this browser or graphics device.</p>
            </div>
          )}

          {error && (
            <div className="flex h-full w-full items-center justify-center p-6 text-center text-slate-400">
              <AlertTriangle className="h-8 w-8 text-rose-400 mb-2" />
              <p className="text-xs font-semibold text-white">{error}</p>
            </div>
          )}

          {!volume && !error && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
              <p className="text-xs font-medium text-white">
                {progress
                  ? `Reconstructing Volume… ${progress.done}/${progress.total} slices`
                  : "Reconstructing Patient 3D Volume…"}
              </p>
              <p className="text-[10.5px] font-mono text-slate-500">
                GPU hardware raymarching voxel texture with physical DICOM coordinates
              </p>
            </div>
          )}

          {volume && (
            <SceneErrorBoundary fallback={<div className="p-4 text-xs text-rose-400">3D Shader Error</div>}>
              <Canvas
                dpr={[1, qConfig.dpr]}
                gl={{ antialias: true, alpha: false, powerPreference: "high-performance", localClippingEnabled: true }}
                camera={{ position: [0, 0, 1.9], fov: 42 }}
              >
                <color attach="background" args={["#000000"]} />

                {/* Clinical Studio Lighting */}
                <ambientLight intensity={0.75} />
                <directionalLight position={[3, 4, 5]} intensity={1.3} />
                <directionalLight position={[-3, -2, -3]} intensity={0.6} />

                {/* 1. Original Volumetric Voxel Field (GPU Raymarching) */}
                {showOriginalVolume && (
                  <VolumeRaymarchMesh
                    volume={volume}
                    threshold={threshold}
                    density={density}
                    intensity={intensity}
                    brightness={brightness}
                    contrast={contrast}
                    mip={mip}
                    colorMapIndex={COLOR_MAP_INDICES[colorMap]}
                    qualityConfig={qConfig}
                    clipMax={[
                      clipping.sagittal.enabled ? clipping.sagittal.position - 0.5 : 0.5,
                      clipping.coronal.enabled ? clipping.coronal.position - 0.5 : 0.5,
                      clipping.axial.enabled ? clipping.axial.position - 0.5 : 0.5,
                    ]}
                    onPointSelected={onPointSelected}
                  />
                )}

                {/* 2. Patient-Specific Segmented Organ Surface Meshes */}
                {showSegmentedMeshes && visibleMeshes.length > 0 && (
                  <OrganMeshesHierarchyLayer
                    layers={visibleMeshes}
                    volumeDims={volume.dims}
                    volumeSpacing={volume.spacing}
                    clippingPlanes={clippingPlanes}
                    wireframe={wireframe}
                    selectedStructureId={selectedStructureId}
                    onSelectOrgan={(id) => {
                      onSelectStructure?.(id);
                      // Select structure and highlight
                    }}
                    onOrganClicked={(id, pt) => {
                      onSelectStructure?.(id);
                      if (onPointSelected && pt) {
                        onPointSelected(pt);
                      }
                    }}
                  />
                )}

                {/* 3. 2D Crosshair Orthogonal Spatial Indicator (Disabled to prevent line clutter) */}
                {crosshairPos && (
                  <CrosshairOrthogonalLayer crosshairPos={crosshairPos} volumeScale={volumeScale} />
                )}

                {/* 4. Interactive Finding & Annotation 3D Markers Layer */}
                <InteractiveFindingMarkersLayer
                  findings={findings}
                  annotations={annotations}
                  activeFindingId={activeFindingId}
                  volumeDims={volume.dims}
                  volumeScale={volumeScale}
                  onSelectFindingMarker={onSelectFindingMarker}
                  onHoverMarker={setHoveredFindingMarker}
                />

                <OrbitControls
                  ref={controlsRef}
                  enableDamping
                  dampingFactor={0.08}
                  rotateSpeed={0.8}
                  zoomSpeed={1.0}
                  panSpeed={0.8}
                  minDistance={0.4}
                  maxDistance={8.0}
                />
              </Canvas>
            </SceneErrorBoundary>
          )}
        </div>

        {/* ── Bottom HUD: Spatial Telemetry & Clipping Shortcuts ── */}
        <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          {/* Coordinates HUD */}
          <div className="flex items-center gap-3 rounded-lg bg-[#0d121c]/90 px-3 py-1.5 backdrop-blur-md border border-[#1e293b] text-[10.5px] font-mono text-slate-400 pointer-events-auto">
            <span>
              X:{" "}
              <strong className="text-white">
                {crosshairPos ? (crosshairPos.x * 100).toFixed(1) : "50.0"}%
              </strong>
            </span>
            <span>
              Y:{" "}
              <strong className="text-white">
                {crosshairPos ? (crosshairPos.y * 100).toFixed(1) : "50.0"}%
              </strong>
            </span>
            <span>
              Z:{" "}
              <strong className="text-white">
                {crosshairPos ? (crosshairPos.z * 100).toFixed(1) : "50.0"}%
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-500">Click 3D anatomy to reposition 2D slices</span>
          </div>

          {/* Hovered Finding Telemetry Pill (Fixed 2D screen space - Never balloons or distorts) */}
          {hoveredFindingMarker && (
            <div className="flex items-center gap-2 rounded-lg bg-[#0d121c]/95 px-3 py-1.5 backdrop-blur-md border border-sky-500/50 shadow-xl text-[11px] text-white pointer-events-auto animate-in fade-in duration-150">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    hoveredFindingMarker.color || (hoveredFindingMarker.isAi ? "#F59E0B" : "#00F0FF"),
                }}
              />
              <span className="font-semibold text-white">{hoveredFindingMarker.label}</span>
              <span className="rounded bg-sky-950 px-1.5 py-0.2 font-mono text-[9px] text-sky-300 font-semibold border border-sky-500/30">
                Slice {hoveredFindingMarker.sliceIndex + 1}
              </span>
              {hoveredFindingMarker.measureValue && (
                <span className="font-mono text-slate-300 text-[10px]">
                  {hoveredFindingMarker.measureValue}
                </span>
              )}
              <button
                onClick={() => {
                  onSelectFindingMarker?.(
                    hoveredFindingMarker.id,
                    hoveredFindingMarker.sliceIndex,
                    hoveredFindingMarker.normX,
                    hoveredFindingMarker.normY,
                    hoveredFindingMarker.seriesId
                  );
                }}
                className="ml-1.5 flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm transition-colors cursor-pointer"
                title="View in 2D slice viewer"
              >
                <Target className="h-3 w-3" />
                <span>View in 2D</span>
              </button>
            </div>
          )}

          {/* Quick Render Modes */}
          <div className="flex items-center gap-1 rounded-lg bg-[#0d121c]/90 p-1 backdrop-blur-md border border-[#1e293b] text-[11px] font-mono pointer-events-auto">
            <button
              onClick={() => setShowOriginalVolume(!showOriginalVolume)}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                showOriginalVolume ? "bg-sky-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              )}
            >
              Voxel Field
            </button>
            <button
              onClick={() => setShowSegmentedMeshes(!showSegmentedMeshes)}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                showSegmentedMeshes ? "bg-sky-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              )}
            >
              AI Surfaces ({visibleMeshes.length})
            </button>
          </div>
        </div>
      </div>

      {/* ── Right Clinical Layer Control Panel (Section 6 & 14) ── */}
      {showLayerPanel && (
        <aside className="w-80 shrink-0 h-full border-l border-[#1e293b] bg-[#0b0f19] flex flex-col text-[12px] z-20">
          {/* Panel Header */}
          <div className="p-3 border-b border-[#1e293b] bg-[#0f172a] flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-white text-[12px]">
              <Layers className="h-4 w-4 text-sky-400" />
              <span>Anatomical Layers</span>
            </div>

            {/* Global Actions */}
            <div className="flex items-center gap-1.5 text-[10.5px]">
              <button
                onClick={handleShowAll}
                className="text-sky-400 hover:underline font-medium"
                title="Show all available layers"
              >
                All
              </button>
              <span className="text-slate-600">·</span>
              <button
                onClick={handleHideAll}
                className="text-slate-400 hover:underline"
                title="Hide all layers"
              >
                Hide
              </button>
              <span className="text-slate-600">·</span>
              <button
                onClick={handleResetLayers}
                className="text-slate-400 hover:underline"
                title="Reset layer opacities"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center border-b border-[#1e293b] bg-[#0d121c] p-1 overflow-x-auto gap-0.5 shrink-0 scrollbar-none">
            {(
              [
                { id: "ORGANS", label: "Organs" },
                { id: "BONE", label: "Bone" },
                { id: "CARDIAC", label: "Cardiac" },
                { id: "VESSELS", label: "Vessels" },
                { id: "SOFT_TISSUE", label: "Tissue" },
                { id: "FIBERS", label: "Fibers" },
                { id: "BLOOD", label: "Blood" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCategoryTab(tab.id)}
                className={cn(
                  "rounded px-2 py-1 text-[10.5px] font-medium whitespace-nowrap transition-colors",
                  activeCategoryTab === tab.id
                    ? "bg-sky-600 text-white font-semibold shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#1a2333]"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Active Category Layers List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 divide-y divide-[#1e293b]/40">
            {layers
              .filter((l) => l.category === activeCategoryTab)
              .map((layer) => {
                const isAvailable = layer.availability === "available";
                const isSelected = selectedStructureId === layer.id;

                return (
                  <div
                    key={layer.id}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border p-2 transition-all pt-2.5",
                      isAvailable
                        ? isSelected
                          ? "border-sky-500 bg-sky-950/30 ring-1 ring-sky-500/50"
                          : layer.visible
                          ? "border-[#1e293b] bg-[#111827]"
                          : "border-[#1e293b]/40 bg-[#0d121c] opacity-60"
                        : "border-[#1e293b]/20 bg-[#090d14] opacity-50 cursor-not-allowed"
                    )}
                  >
                    {/* Layer Header */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full shrink-0 border border-black/40",
                            !isAvailable && "opacity-30"
                          )}
                          style={{ backgroundColor: layer.color }}
                        />
                        <span
                          className={cn(
                            "truncate font-medium text-[11.5px]",
                            isAvailable ? (layer.visible ? "text-slate-100" : "text-slate-400") : "text-slate-500"
                          )}
                        >
                          {layer.name}
                        </span>
                      </div>

                      {/* Controls (Disabled if not available) */}
                      <div className="flex items-center gap-1 shrink-0">
                        {isAvailable ? (
                          <>
                            <button
                              onClick={() => handleIsolateLayer(layer.id)}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[9.5px] font-mono font-medium transition-colors",
                                layer.isolated
                                  ? "bg-sky-600 text-white font-bold"
                                  : "border border-[#1e293b] text-slate-400 hover:text-white"
                              )}
                              title={layer.isolated ? "Clear isolation" : "Isolate this structure"}
                            >
                              Iso
                            </button>
                            <button
                              onClick={() => handleToggleLayer(layer.id)}
                              className={cn(
                                "p-1 rounded transition-colors",
                                layer.visible ? "text-sky-400 hover:bg-sky-950" : "text-slate-500 hover:bg-[#1a2333]"
                              )}
                              title={layer.visible ? "Hide layer" : "Show layer"}
                            >
                              {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>
                          </>
                        ) : (
                          <span
                            className="text-[9.5px] font-mono text-slate-600 rounded bg-[#111827] px-1.5 py-0.5 border border-[#1e293b]/60"
                            title={layer.unavailabilityReason}
                          >
                            ○ Not available
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata & Opacity Slider */}
                    {isAvailable ? (
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-mono text-sky-400 font-semibold">
                          {layer.volumeMl !== undefined ? `${layer.volumeMl.toFixed(1)} mL` : "Patient Isosurface"}
                        </span>
                        {layer.visible && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 text-[9.5px]">Opacity:</span>
                            <input
                              type="range"
                              min={0.1}
                              max={1.0}
                              step={0.05}
                              value={layer.opacity}
                              onChange={(e) => handleLayerOpacity(layer.id, parseFloat(e.target.value))}
                              className="w-14 h-1 accent-sky-500 cursor-pointer"
                            />
                            <span className="font-mono text-[9px] w-5 text-right text-slate-300">
                              {Math.round(layer.opacity * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-500 italic mt-0.5">
                        {layer.unavailabilityReason || "Not available for this study."}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>

          {/* ── Section 8: Anatomical 3D Clipping Planes ── */}
          <div className="p-3 border-t border-[#1e293b] bg-[#0d121c] space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <Scissors className="h-3 w-3 text-sky-400" />
                3D Anatomical Clipping
              </span>
              <button
                onClick={() => setClipping(DEFAULT_CLIPPING)}
                className="text-[10px] text-slate-400 hover:underline"
              >
                Reset Planes
              </button>
            </div>

            {/* Clipping Plane Controls: Axial, Coronal, Sagittal */}
            {(
              [
                { axis: "axial", label: "Axial (Z)", color: "text-sky-400" },
                { axis: "coronal", label: "Coronal (Y)", color: "text-amber-400" },
                { axis: "sagittal", label: "Sagittal (X)", color: "text-purple-400" },
              ] as const
            ).map(({ axis, label, color }) => {
              const state = clipping[axis];
              return (
                <div key={axis} className="flex flex-col gap-1 rounded bg-[#111827] p-2 border border-[#1e293b]">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-200">
                      <input
                        type="checkbox"
                        checked={state.enabled}
                        onChange={(e) =>
                          setClipping({
                            ...clipping,
                            [axis]: { ...state, enabled: e.target.checked },
                          })
                        }
                        className="rounded accent-sky-500"
                      />
                      <span className={color}>{label}</span>
                    </label>

                    <div className="flex items-center gap-1 text-[10px] font-mono">
                      <button
                        onClick={() =>
                          setClipping({
                            ...clipping,
                            [axis]: { ...state, reverse: !state.reverse },
                          })
                        }
                        className={cn(
                          "rounded px-1.5 py-0.2 border transition-colors",
                          state.reverse
                            ? "border-sky-500 bg-sky-950 text-sky-300"
                            : "border-[#1e293b] text-slate-400 hover:text-white"
                        )}
                        title="Reverse clipping direction"
                      >
                        {state.reverse ? "Rev" : "Fwd"}
                      </button>
                      <button
                        onClick={() =>
                          setClipping({
                            ...clipping,
                            [axis]: { ...state, syncWithSlice: !state.syncWithSlice },
                          })
                        }
                        className={cn(
                          "rounded px-1.5 py-0.2 border transition-colors",
                          state.syncWithSlice
                            ? "border-emerald-500 bg-emerald-950 text-emerald-300"
                            : "border-[#1e293b] text-slate-500"
                        )}
                        title="Synchronize plane with 2D slice position"
                      >
                        Sync
                      </button>
                    </div>
                  </div>

                  {state.enabled && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={state.position}
                        onChange={(e) =>
                          setClipping({
                            ...clipping,
                            [axis]: { ...state, position: parseFloat(e.target.value), syncWithSlice: false },
                          })
                        }
                        className="w-full h-1 accent-sky-500 cursor-pointer"
                      />
                      <span className="font-mono text-[10px] w-8 text-right text-slate-300">
                        {Math.round(state.position * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </div>
  );
}

/** 3D GPU Volume Raymarching Submesh */
function VolumeRaymarchMesh({
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
    if (!meshRef.current || !e.point || !onPointSelected) return;
    const inv = meshRef.current.matrixWorld.clone().invert();
    const localPt = e.point.clone().applyMatrix4(inv);
    const normX = Math.max(0, Math.min(1, localPt.x + 0.5));
    const normY = Math.max(0, Math.min(1, -localPt.y + 0.5));
    const normZ = Math.max(0, Math.min(1, localPt.z + 0.5));
    onPointSelected({ x: normX, y: normY, z: normZ });
  };

  return (
    <mesh ref={meshRef} scale={scale} onPointerDown={handlePointerDown}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VOLUME_VERTEX_SHADER}
        fragmentShader={VOLUME_FRAGMENT_SHADER}
        glslVersion={THREE.GLSL3}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

/** Layer for rendering patient-derived TotalSegmentator organ meshes */
function OrganMeshesHierarchyLayer({
  layers,
  volumeDims,
  volumeSpacing,
  clippingPlanes,
  wireframe,
  selectedStructureId,
  onSelectOrgan,
  onOrganClicked,
}: {
  layers: AnatomicalLayer[];
  volumeDims: [number, number, number];
  volumeSpacing: [number, number, number];
  clippingPlanes: THREE.Plane[];
  wireframe: boolean;
  selectedStructureId?: string | null;
  onSelectOrgan?: (id: string) => void;
  onOrganClicked?: (id: string, pt: { x: number; y: number; z: number }) => void;
}) {
  const { scaleVec, posVec } = useMemo(() => {
    const lx = volumeDims[0] * volumeSpacing[0];
    const ly = volumeDims[1] * volumeSpacing[1];
    const lz = volumeDims[2] * volumeSpacing[2];
    const longest = Math.max(lx, ly, lz) || 1;
    return {
      scaleVec: new THREE.Vector3(1 / longest, -1 / longest, 1 / longest),
      posVec: new THREE.Vector3(-lx / (2 * longest), ly / (2 * longest), -lz / (2 * longest)),
    };
  }, [volumeDims, volumeSpacing]);

  return (
    <group position={posVec} scale={scaleVec}>
      {layers.map((layer) => (
        <SingleMeshActor
          key={layer.id}
          layer={layer}
          clippingPlanes={clippingPlanes}
          wireframe={wireframe}
          isSelected={selectedStructureId === layer.id}
          onSelectOrgan={onSelectOrgan}
          onOrganClicked={onOrganClicked}
        />
      ))}
    </group>
  );
}

function SingleMeshActor({
  layer,
  clippingPlanes,
  wireframe,
  isSelected,
  onSelectOrgan,
  onOrganClicked,
}: {
  layer: AnatomicalLayer;
  clippingPlanes: THREE.Plane[];
  wireframe: boolean;
  isSelected: boolean;
  onSelectOrgan?: (id: string) => void;
  onOrganClicked?: (id: string, pt: { x: number; y: number; z: number }) => void;
}) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [hovered, setHovered] = useState(false);
  const [hoverPt, setHoverPt] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    if (!layer.meshUrl) return;
    let cancelled = false;

    if (meshModelCache.has(layer.meshUrl)) {
      setModel(meshModelCache.get(layer.meshUrl)!.clone());
      return;
    }

    gltfLoader.load(
      layer.meshUrl,
      (gltf) => {
        if (cancelled) return;
        meshModelCache.set(layer.meshUrl!, gltf.scene);
        setModel(gltf.scene.clone());
      },
      undefined,
      () => {
        // Quietly fail if specific mesh file is absent
      }
    );

    return () => {
      cancelled = true;
    };
  }, [layer.meshUrl]);

  useEffect(() => {
    if (!model) return;
    const baseColor = new THREE.Color(layer.color || "#38BDF8");
    const effOpacity = layer.isolated ? 0.95 : isSelected ? 0.92 : hovered ? 0.85 : layer.opacity;

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
        m.material = new THREE.MeshStandardMaterial({
          color: isSelected ? baseColor.clone().offsetHSL(0, 0, 0.15) : baseColor,
          roughness: 0.35,
          metalness: 0.1,
          transparent: effOpacity < 1.0,
          opacity: effOpacity,
          wireframe,
          side: THREE.DoubleSide,
          clippingPlanes,
          clipShadows: true,
          depthWrite: effOpacity > 0.8,
        });
      }
    });
  }, [model, layer.color, layer.opacity, layer.isolated, isSelected, hovered, wireframe, clippingPlanes]);

  if (!model) return null;

  return (
    <primitive
      object={model}
      onPointerOver={(e: any) => {
        e.stopPropagation();
        setHovered(true);
        if (e.point) setHoverPt([e.point.x, e.point.y, e.point.z]);
      }}
      onPointerOut={(e: any) => {
        e.stopPropagation();
        setHovered(false);
        setHoverPt(null);
      }}
      onClick={(e: any) => {
        e.stopPropagation();
        onSelectOrgan?.(layer.id);
        if (e.point && onOrganClicked) {
          // Convert to normalized physical coords
          onOrganClicked(layer.id, {
            x: Math.max(0, Math.min(1, e.point.x + 0.5)),
            y: Math.max(0, Math.min(1, -e.point.y + 0.5)),
            z: Math.max(0, Math.min(1, e.point.z + 0.5)),
          });
        }
      }}
    >
      {hovered && hoverPt && (
        <Html position={hoverPt} center zIndexRange={[50, 0]}>
          <div className="pointer-events-none z-50 flex flex-col gap-0.5 rounded-lg border border-sky-400 bg-[#0d121c]/95 px-2.5 py-1.5 shadow-2xl backdrop-blur-md text-white whitespace-nowrap text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: layer.color }} />
              <span className="text-[11px] font-bold text-sky-300">{layer.name}</span>
            </div>
            {layer.volumeMl !== undefined && (
              <div className="flex items-center justify-between gap-3 font-mono text-[9.5px] text-slate-300">
                <span>Volume:</span>
                <span className="font-semibold text-white">{layer.volumeMl.toFixed(1)} mL</span>
              </div>
            )}
            <div className="mt-0.5 border-t border-[#1e293b] pt-0.5 text-[8.5px] font-mono text-slate-400">
              TotalSegmentator Patient Mesh
            </div>
          </div>
        </Html>
      )}
    </primitive>
  );
}

/** 3D Spatial Crosshair Orthogonal Guide - Disabled to keep 3D volume view clean */
function CrosshairOrthogonalLayer({
  crosshairPos,
  volumeScale,
}: {
  crosshairPos: { x: number; y: number; z: number };
  volumeScale: [number, number, number];
}) {
  return null;
}

/** 3D Interactive Finding & Annotation Spatial Model */
interface InteractiveMarkerData {
  id: string;
  label: string;
  findingType?: string;
  sliceIndex: number;
  seriesId?: string;
  normX: number;
  normY: number;
  normZ: number;
  bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  contourPoints?: Array<{ x: number; y: number }>;
  isAi?: boolean;
  measureValue?: string;
  color?: string;
  note?: string;
}

/** Professional 3D Anatomical Region Highlight & Contour */
function AnatomicalRegionHighlight({
  marker,
  volumeScale,
  isSelected,
  onSelect,
  onHover,
}: {
  marker: InteractiveMarkerData;
  volumeScale: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
  onHover?: (hovered: boolean, marker: InteractiveMarkerData | null) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const posX = (marker.normX - 0.5) * volumeScale[0];
  const posY = -(marker.normY - 0.5) * volumeScale[1];
  const posZ = (marker.normZ - 0.5) * volumeScale[2];

  const highlightColor = isSelected
    ? "#00F0FF"
    : marker.color || (marker.isAi ? "#F59E0B" : "#EF4444");

  // Projected 2D contour points in 3D volume coordinates on the slice cut
  const contourArray = useMemo(() => {
    if (!marker.contourPoints || marker.contourPoints.length < 2) return null;
    const coords: number[] = [];
    for (const cp of marker.contourPoints) {
      coords.push(
        (cp.x - 0.5) * volumeScale[0],
        -(cp.y - 0.5) * volumeScale[1],
        posZ
      );
    }
    return new Float32Array(coords);
  }, [marker.contourPoints, volumeScale, posZ]);

  const handlePointerOver = (e: any) => {
    e.stopPropagation();
    setHovered(true);
    onHover?.(true, marker);
  };

  const handlePointerOut = (e: any) => {
    e.stopPropagation();
    setHovered(false);
    onHover?.(false, null);
  };

  const handleClick = (e: any) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group>
      {/* 1. Real 2D slice contour projected directly on the 3D axial plane slice */}
      {contourArray && (
        <lineLoop
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[contourArray, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={highlightColor}
            transparent
            opacity={isSelected ? 1.0 : hovered ? 0.95 : 0.8}
            depthWrite={false}
          />
        </lineLoop>
      )}

      {/* 2. Delicate Planar Focal Reticle (Flat on the slice plane, no 3D vertical lines, no diamond dot, no box) */}
      <group position={[posX, posY, posZ]}>
        {/* Subtle flat ring directly on the axial plane cut */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <ringGeometry args={[0.007, 0.010, 32]} />
          <meshBasicMaterial
            color={highlightColor}
            transparent
            opacity={isSelected ? 0.95 : hovered ? 0.85 : 0.6}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Delicate inner focal dot when hovered or selected */}
        {(isSelected || hovered) && (
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            onClick={handleClick}
          >
            <circleGeometry args={[0.0035, 16]} />
            <meshBasicMaterial
              color={highlightColor}
              transparent
              opacity={isSelected ? 0.9 : 0.7}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}

function InteractiveFindingMarkersLayer({
  findings = [],
  annotations = [],
  activeFindingId,
  volumeDims,
  volumeScale,
  onSelectFindingMarker,
  onHoverMarker,
}: {
  findings?: Finding[];
  annotations?: ViewerAnnotation[];
  activeFindingId?: string | null;
  volumeDims: [number, number, number];
  volumeScale: [number, number, number];
  onSelectFindingMarker?: (
    findingId: string,
    sliceIndex: number,
    normX: number,
    normY: number,
    seriesId?: string
  ) => void;
  onHoverMarker?: (marker: InteractiveMarkerData | null) => void;
}) {
  const markerItems: InteractiveMarkerData[] = useMemo(() => {
    const list: InteractiveMarkerData[] = [];
    const maxSlice = Math.max(1, volumeDims[2] - 1);

    // 1. Registered Findings (AI and formal Radiologist Findings)
    for (const f of findings) {
      const normX = f.region.x + f.region.w / 2;
      const normY = f.region.y + f.region.h / 2;
      const normZ = f.sliceIndex / maxSlice;
      const bounds = {
        minX: f.region.x,
        maxX: f.region.x + f.region.w,
        minY: f.region.y,
        maxY: f.region.y + f.region.h,
      };
      const contourPoints = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
      ];

      list.push({
        id: f.id,
        label: f.label || "Diagnostic Finding",
        findingType: "Lesion",
        sliceIndex: f.sliceIndex,
        seriesId: f.seriesId,
        normX,
        normY,
        normZ,
        bounds,
        contourPoints,
        isAi: f.confidence > 0,
        note: f.radiologistNote || f.description,
      });
    }

    // 2. All 2D Annotations (Rectangles, Polygons, Circles, Freehand, Points, Calipers)
    for (const a of annotations) {
      if (a.visible === false) continue;
      if (list.some((item) => item.id === a.id || (a.findingId && item.id === a.findingId))) {
        continue;
      }

      const normZ = a.sliceIndex / maxSlice;
      const labelText = a.label || a.finding || a.findingType || "Diagnostic ROI";

      if (a.type === "rectangle" && a.points.length >= 2) {
        const [p0, p1] = a.points;
        const minX = Math.min(p0.x, p1.x);
        const maxX = Math.max(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const maxY = Math.max(p0.y, p1.y);
        list.push({
          id: a.id,
          label: labelText,
          findingType: a.findingType,
          sliceIndex: a.sliceIndex,
          seriesId: a.seriesId,
          normX: (minX + maxX) / 2,
          normY: (minY + maxY) / 2,
          normZ,
          bounds: { minX, maxX, minY, maxY },
          contourPoints: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
          ],
          isAi: false,
          color: a.color,
          measureValue: a.measureValue,
          note: a.radiologistNote,
        });
      } else if (a.type === "circle" && a.points.length >= 2) {
        const [p0, p1] = a.points;
        const r = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const contour: Array<{ x: number; y: number }> = [];
        const steps = 24;
        for (let i = 0; i < steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          contour.push({ x: p0.x + Math.cos(theta) * r, y: p0.y + Math.sin(theta) * r });
        }
        list.push({
          id: a.id,
          label: labelText,
          findingType: a.findingType,
          sliceIndex: a.sliceIndex,
          seriesId: a.seriesId,
          normX: p0.x,
          normY: p0.y,
          normZ,
          bounds: { minX: p0.x - r, maxX: p0.x + r, minY: p0.y - r, maxY: p0.y + r },
          contourPoints: contour,
          isAi: false,
          color: a.color,
          measureValue: a.measureValue,
          note: a.radiologistNote,
        });
      } else if ((a.type === "polygon" || a.type === "freehand") && a.points.length >= 3) {
        const minX = Math.min(...a.points.map((p) => p.x));
        const maxX = Math.max(...a.points.map((p) => p.x));
        const minY = Math.min(...a.points.map((p) => p.y));
        const maxY = Math.max(...a.points.map((p) => p.y));
        list.push({
          id: a.id,
          label: labelText,
          findingType: a.findingType,
          sliceIndex: a.sliceIndex,
          seriesId: a.seriesId,
          normX: (minX + maxX) / 2,
          normY: (minY + maxY) / 2,
          normZ,
          bounds: { minX, maxX, minY, maxY },
          contourPoints: a.points,
          isAi: false,
          color: a.color,
          measureValue: a.measureValue,
          note: a.radiologistNote,
        });
      } else if ((a.type === "marker" || a.type === "point") && a.points.length >= 1) {
        const p0 = a.points[0];
        list.push({
          id: a.id,
          label: labelText,
          findingType: a.findingType,
          sliceIndex: a.sliceIndex,
          seriesId: a.seriesId,
          normX: p0.x,
          normY: p0.y,
          normZ,
          bounds: { minX: p0.x - 0.015, maxX: p0.x + 0.015, minY: p0.y - 0.015, maxY: p0.y + 0.015 },
          isAi: false,
          color: a.color,
          note: a.radiologistNote,
        });
      } else if (
        (a.type === "line" || a.type === "measurement" || a.type === "arrow") &&
        a.points.length >= 2
      ) {
        const [p0, p1] = a.points;
        const minX = Math.min(p0.x, p1.x);
        const maxX = Math.max(p0.x, p1.x);
        const minY = Math.min(p0.y, p1.y);
        const maxY = Math.max(p0.y, p1.y);
        list.push({
          id: a.id,
          label: labelText,
          findingType: a.findingType,
          sliceIndex: a.sliceIndex,
          seriesId: a.seriesId,
          normX: (p0.x + p1.x) / 2,
          normY: (p0.y + p1.y) / 2,
          normZ,
          bounds: { minX, maxX, minY, maxY },
          contourPoints: [p0, p1],
          isAi: false,
          color: a.color,
          measureValue: a.measureValue,
          note: a.radiologistNote,
        });
      }
    }

    return list;
  }, [findings, annotations, volumeDims]);

  return (
    <group>
      {markerItems.map((m) => (
        <AnatomicalRegionHighlight
          key={m.id}
          marker={m}
          volumeScale={volumeScale}
          isSelected={activeFindingId === m.id}
          onSelect={() => {
            onSelectFindingMarker?.(m.id, m.sliceIndex, m.normX, m.normY, m.seriesId);
          }}
          onHover={(hovered, marker) => {
            onHoverMarker?.(hovered ? marker : null);
          }}
        />
      ))}
    </group>
  );
}

const VOLUME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vOrigin;
  varying vec3 vDirection;

  void main() {
    vOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUME_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  layout(location = 0) out highp vec4 fragColor;

  uniform sampler3D uVolume;
  uniform float uThreshold;
  uniform float uDensity;
  uniform float uIntensity;
  uniform float uBrightness;
  uniform float uContrast;
  uniform int uMip;
  uniform int uColorMap;
  uniform int uSteps;
  uniform float uNormalStep;
  uniform vec3 uClipMax;

  varying vec3 vOrigin;
  varying vec3 vDirection;

  vec2 hitBox(vec3 orig, vec3 dir) {
    vec3 box_min = vec3(-0.5);
    vec3 box_max = min(vec3(0.5), uClipMax);
    vec3 inv_dir = 1.0 / dir;
    vec3 tmin_tmp = (box_min - orig) * inv_dir;
    vec3 tmax_tmp = (box_max - orig) * inv_dir;
    vec3 tmin = min(tmin_tmp, tmax_tmp);
    vec3 tmax = max(tmin_tmp, tmax_tmp);
    float t0 = max(tmin.x, max(tmin.y, tmin.z));
    float t1 = min(tmax.x, min(tmax.y, tmax.z));
    return vec2(t0, t1);
  }

  vec3 sampleColorMap(float val, int mapIdx) {
    if (mapIdx == 4) { // Bone CT
      if (val < 0.15) return vec3(0.0);
      if (val < 0.35) return mix(vec3(0.2, 0.1, 0.05), vec3(0.6, 0.4, 0.25), (val - 0.15) / 0.20);
      if (val < 0.70) return mix(vec3(0.6, 0.4, 0.25), vec3(0.95, 0.90, 0.82), (val - 0.35) / 0.35);
      return mix(vec3(0.95, 0.90, 0.82), vec3(1.0, 1.0, 1.0), (val - 0.70) / 0.30);
    }
    if (mapIdx == 0) { // Soft Tissue
      if (val < 0.08) return vec3(0.0);
      if (val < 0.30) return mix(vec3(0.1, 0.02, 0.05), vec3(0.55, 0.20, 0.22), (val - 0.08) / 0.22);
      if (val < 0.65) return mix(vec3(0.55, 0.20, 0.22), vec3(0.85, 0.65, 0.55), (val - 0.30) / 0.35);
      return mix(vec3(0.85, 0.65, 0.55), vec3(1.0, 0.95, 0.90), (val - 0.65) / 0.35);
    }
    if (mapIdx == 7) { // Hot Iron
      if (val < 0.33) return mix(vec3(0.0), vec3(0.8, 0.0, 0.0), val * 3.0);
      if (val < 0.66) return mix(vec3(0.8, 0.0, 0.0), vec3(1.0, 0.8, 0.0), (val - 0.33) * 3.0);
      return mix(vec3(1.0, 0.8, 0.0), vec3(1.0, 1.0, 1.0), (val - 0.66) * 3.0);
    }
    // Grayscale
    return vec3(val);
  }

  vec3 computeNormal(vec3 pos, float stepSize) {
    float dx = texture(uVolume, pos + vec3(stepSize, 0.0, 0.0)).r - texture(uVolume, pos - vec3(stepSize, 0.0, 0.0)).r;
    float dy = texture(uVolume, pos + vec3(0.0, stepSize, 0.0)).r - texture(uVolume, pos - vec3(0.0, stepSize, 0.0)).r;
    float dz = texture(uVolume, pos + vec3(0.0, 0.0, stepSize)).r - texture(uVolume, pos - vec3(0.0, 0.0, stepSize)).r;
    return -normalize(vec3(dx, dy, dz) + 0.00001);
  }

  void main() {
    vec3 rayDir = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDir);
    if (bounds.x > bounds.y || bounds.y < 0.0) discard;

    bounds.x = max(bounds.x, 0.0);
    float dt = (bounds.y - bounds.x) / float(uSteps);
    vec3 p = vOrigin + bounds.x * rayDir;

    vec4 accum = vec4(0.0);
    float maxVal = 0.0;

    for (int i = 0; i < uSteps; i++) {
      vec3 uv = p + 0.5;
      if (any(lessThan(uv, vec3(0.0))) || any(greaterThan(uv, vec3(1.0)))) break;

      float val = texture(uVolume, uv).r;
      val = clamp((val - 0.5) * uContrast + 0.5 + (uBrightness - 1.0), 0.0, 1.0);

      if (uMip == 1) {
        if (val > uThreshold) maxVal = max(maxVal, val);
      } else {
        if (val > uThreshold) {
          float normVal = (val - uThreshold) / (1.0 - uThreshold);
          float alpha = normVal * normVal * uDensity * 0.04;

          vec3 norm = computeNormal(uv, uNormalStep);
          vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
          float diff = max(dot(norm, lightDir), 0.25);

          vec3 col = sampleColorMap(val, uColorMap) * diff * uIntensity;
          accum.rgb += (1.0 - accum.a) * col * alpha;
          accum.a += (1.0 - accum.a) * alpha;

          if (accum.a >= 0.97) break;
        }
      }
      p += rayDir * dt;
    }

    if (uMip == 1) {
      if (maxVal <= uThreshold) discard;
      vec3 col = sampleColorMap(maxVal, uColorMap) * uIntensity;
      fragColor = vec4(col, min(1.0, maxVal * uDensity));
    } else {
      if (accum.a <= 0.01) discard;
      fragColor = accum;
    }
  }
`;
