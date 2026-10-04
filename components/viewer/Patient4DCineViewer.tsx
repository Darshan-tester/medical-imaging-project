"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Clock,
  Layers,
  Activity,
  AlertCircle,
  Film,
  Maximize2,
  Minimize2,
  Info,
} from "lucide-react";
import { Study } from "@/lib/types";
import { detectGenuine4D } from "@/lib/anatomy-state";
import { cn } from "@/lib/utils";

interface Patient4DCineViewerProps {
  study: Study;
  activePhase?: number;
  onPhaseChange?: (phase: number) => void;
  className?: string;
  height?: string | number;
}

const gltfLoader = new GLTFLoader();

export function Patient4DCineViewer({
  study,
  activePhase: controlledPhase,
  onPhaseChange,
  className,
  height = "560px",
}: Patient4DCineViewerProps) {
  const temporalInfo = useMemo(() => detectGenuine4D(study), [study]);

  const [internalPhase, setInternalPhase] = useState(0);
  const activePhase = controlledPhase !== undefined ? controlledPhase : internalPhase;

  const setPhase = useCallback(
    (action: number | ((prev: number) => number)) => {
      setInternalPhase((prev) => {
        const current = controlledPhase !== undefined ? controlledPhase : prev;
        const next = typeof action === "function" ? action(current) : action;
        onPhaseChange?.(next);
        return next;
      });
    },
    [controlledPhase, onPhaseChange]
  );

  const [isPlaying, setIsPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const [isLooping, setIsLooping] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const phaseModelsRef = useRef<Map<number, THREE.Group>>(new Map());
  const rootGroupRef = useRef<THREE.Group>(new THREE.Group());

  const [isLoadingPhases, setIsLoadingPhases] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Playback timer for genuine temporal acquisitions
  useEffect(() => {
    if (!isPlaying || !temporalInfo.hasTemporal || temporalInfo.phaseCount <= 1) return;

    const interval = setInterval(() => {
      setPhase((prev: number) => {
        const next = prev + 1;
        if (next >= temporalInfo.phaseCount) {
          if (isLooping) return 0;
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [isPlaying, fps, isLooping, temporalInfo.hasTemporal, temporalInfo.phaseCount, setPhase]);

  // Three.js Scene Setup (only mounted when genuine temporal data exists)
  useEffect(() => {
    if (!temporalInfo.hasTemporal) return;
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const h = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#080c14");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / h, 0.1, 100);
    camera.position.set(0, 0, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    // Clinical Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight1.position.set(3, 4, 5);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.6);
    dirLight2.position.set(-3, -2, -3);
    scene.add(dirLight2);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    rootGroupRef.current = rootGroup;

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h_ = container.clientHeight;
      camera.aspect = w / h_;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h_);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      phaseModelsRef.current.clear();
    };
  }, [temporalInfo.hasTemporal]);

  // Load genuine acquired phase frames
  useEffect(() => {
    if (!temporalInfo.hasTemporal || temporalInfo.phaseCount <= 0) return;

    let isMounted = true;
    setIsLoadingPhases(true);
    setLoadError(null);
    let loaded = 0;

    const rootGroup = rootGroupRef.current;
    if (!rootGroup) return;

    for (let p = 0; p < temporalInfo.phaseCount; p++) {
      const pStr = p.toString().padStart(2, "0");
      const url = `/api/studies/${study.id}/derived/motion4d/frames/phase_${pStr}.glb`;

      gltfLoader.load(
        url,
        (gltf) => {
          if (!isMounted) return;
          const model = gltf.scene;

          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.material = new THREE.MeshStandardMaterial({
                color: new THREE.Color("#F43F5E"),
                roughness: 0.35,
                metalness: 0.1,
                wireframe: wireframe,
                side: THREE.DoubleSide,
              });
            }
          });

          const group = new THREE.Group();
          group.add(model);
          group.visible = p === activePhase;
          rootGroup.add(group);
          phaseModelsRef.current.set(p, group);

          if (p === 0) {
            const box = new THREE.Box3().setFromObject(group);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const scale = 2.0 / maxDim;
            rootGroup.scale.set(scale, scale, scale);
            rootGroup.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
          }

          loaded++;
          if (isMounted) setLoadedCount(loaded);
          if (loaded >= temporalInfo.phaseCount && isMounted) setIsLoadingPhases(false);
        },
        undefined,
        () => {
          // If frame not found on disk
          loaded++;
          if (isMounted) {
            setLoadedCount(loaded);
            if (loaded >= temporalInfo.phaseCount) {
              setIsLoadingPhases(false);
              if (phaseModelsRef.current.size === 0) {
                setLoadError("Acquired phase mesh frames are not pre-rendered on disk.");
              }
            }
          }
        }
      );
    }

    return () => {
      isMounted = false;
    };
  }, [temporalInfo.hasTemporal, temporalInfo.phaseCount, study.id]);

  // Update active phase visibility
  useEffect(() => {
    phaseModelsRef.current.forEach((group, index) => {
      group.visible = index === activePhase;
    });
  }, [activePhase]);

  // Update wireframe mode
  useEffect(() => {
    phaseModelsRef.current.forEach((group) => {
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          if (m.material && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            (m.material as THREE.MeshStandardMaterial).wireframe = wireframe;
          }
        }
      });
    });
  }, [wireframe]);

  // =========================================================================
  // CASE 1: STATIC CT / MRI STUDY (NO TEMPORAL ACQUISITION)
  // Section 10: "4D unavailable — study contains no temporal acquisition."
  // Strictly avoid fabricating motion, LVEF, EDV, ESV, SV, heart rate, or strain.
  // =========================================================================
  if (!temporalInfo.hasTemporal) {
    return (
      <div
        className={cn(
          "relative flex flex-col rounded-xl border border-[#1e293b] bg-[#080c14] overflow-hidden select-none",
          className
        )}
        style={{ height }}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-slate-400" />
            <span className="text-xs font-semibold text-white tracking-tight">
              4D Dynamic Acquisition Telemetry
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
              {study.modality} · Static Volume
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span>Temporal Phases: 1 of 1</span>
          </div>
        </div>

        {/* Central Clinical Notice Viewport */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#111827] border border-[#1e293b] text-slate-400 shadow-inner mb-4">
            <Clock className="h-7 w-7 text-slate-400" />
          </div>

          <h3 className="text-sm font-semibold text-white tracking-tight mb-1">
            4D Dynamic Temporal Acquisition Unavailable
          </h3>
          <p className="text-xs font-mono text-amber-400/90 font-medium mb-3">
            {temporalInfo.reason}
          </p>

          <p className="max-w-md text-[11.5px] leading-relaxed text-slate-400 mb-6">
            Dynamic 4D cine requires an ECG-synchronized multi-phase CT or cine MRI acquisition
            protocol across the cardiac or respiratory cycle. This study was acquired as a single
            static volumetric scan without temporal gating.
          </p>

          {/* Clinical Telemetry Card */}
          <div className="w-full max-w-md rounded-lg border border-[#1e293b] bg-[#0d121c] p-3 text-left">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-2 border-b border-[#1e293b] pb-1">
              Acquisition Parameters
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div>
                <span className="text-slate-500">Scan Modality:</span>{" "}
                <span className="text-slate-200">{study.modality}</span>
              </div>
              <div>
                <span className="text-slate-500">Gating Status:</span>{" "}
                <span className="text-slate-200">Non-Gated Static</span>
              </div>
              <div>
                <span className="text-slate-500">Temporal Frames:</span>{" "}
                <span className="text-slate-200">None Acquired</span>
              </div>
              <div>
                <span className="text-slate-500">LVEF / Hemodynamics:</span>{" "}
                <span className="text-slate-400">Not Applicable</span>
              </div>
            </div>
          </div>
        </div>

        {/* Disabled Bottom Scrubber Bar */}
        <div className="border-t border-[#1e293b] bg-[#0d121c] px-4 py-2.5 flex items-center justify-between text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <button
              disabled
              className="flex h-7 w-7 items-center justify-center rounded bg-[#1e293b]/40 text-slate-600 cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5 ml-0.5" />
            </button>
            <span>Timeline disabled (No temporal phase data)</span>
          </div>

          <span className="text-[10.5px] text-slate-600">
            ECG-gated temporal acquisition required for 4D cine playback
          </span>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CASE 2: GENUINE MULTI-PHASE TEMPORAL DATA ACQUIRED
  // Uses actual patient phase frames, play/pause, timeline, frame stepping.
  // =========================================================================
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border border-[#1e293b] bg-[#080c14] overflow-hidden select-none",
        isFullscreen && "fixed inset-0 z-50 rounded-none border-0",
        className
      )}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-4 py-2.5 z-10">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-white tracking-tight">
            4D Gated Dynamic Cine Acquisition
          </span>
          <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300 font-bold">
            ACQUIRED MULTI-PHASE
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300">
          <span>Phase {activePhase + 1} / {temporalInfo.phaseCount}</span>
          <button
            onClick={() => setWireframe(!wireframe)}
            className={cn(
              "rounded p-1 text-xs transition-colors",
              wireframe ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"
            )}
            title="Wireframe Mesh"
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="rounded p-1 text-slate-400 hover:text-white transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* 3D Canvas Container */}
      <div ref={containerRef} className="flex-1 w-full h-full cursor-grab active:cursor-grabbing relative">
        {isLoadingPhases && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080c14]/80 backdrop-blur-sm z-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent mb-3" />
            <span className="text-xs font-medium text-white">
              Loading acquired phase frames ({loadedCount} / {temporalInfo.phaseCount})...
            </span>
          </div>
        )}

        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#080c14]/90 z-20">
            <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
            <p className="text-xs font-semibold text-white">{loadError}</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
              Volumetric cine images can be viewed slice-by-slice in the 2D MPR workspace.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Timeline & Controls */}
      <div className="border-t border-[#1e293b] bg-[#0d121c] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPhase((p: number) => Math.max(0, p - 1))}
            className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-[#1a2333] transition-colors"
            title="Previous Phase"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shadow"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
          </button>

          <button
            onClick={() => setPhase((p: number) => (p + 1) % temporalInfo.phaseCount)}
            className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-[#1a2333] transition-colors"
            title="Next Phase"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          <span className="font-mono text-xs font-semibold text-white ml-2">
            Phase {activePhase + 1}{" "}
            <span className="text-slate-500 font-normal">/ {temporalInfo.phaseCount}</span>
          </span>
        </div>

        {/* Phase Timeline Scrubber */}
        <div className="flex-1 min-w-[160px] max-w-md mx-2">
          <input
            type="range"
            min={0}
            max={Math.max(0, temporalInfo.phaseCount - 1)}
            value={activePhase}
            onChange={(e) => {
              setIsPlaying(false);
              setPhase(parseInt(e.target.value, 10));
            }}
            className="w-full h-1.5 cursor-pointer appearance-none rounded bg-[#1e293b] accent-emerald-500"
          />
        </div>

        {/* Speed / FPS Selector */}
        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
          <span>Speed:</span>
          <select
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value, 10))}
            className="rounded border border-[#1e293b] bg-[#111827] px-2 py-0.5 text-slate-200 outline-none"
          >
            <option value={2}>2 FPS (Slow)</option>
            <option value={4}>4 FPS</option>
            <option value={6}>6 FPS (Real-time)</option>
            <option value={10}>10 FPS</option>
          </select>
        </div>
      </div>
    </div>
  );
}
