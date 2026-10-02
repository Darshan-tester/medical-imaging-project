"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  Layers,
  Sparkles,
  GitCompare,
  RotateCcw,
  Clock,
  Cpu,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Eye,
  EyeOff,
  Sliders,
  Maximize2,
  ShieldCheck,
  Zap,
  Play,
  FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export interface OrganMeshState {
  id: string;
  name: string;
  group: string;
  color: string;
  opacity: number;
  visible: boolean;
  isolated?: boolean;
  volumeMl?: number;
  maxDiameterMm?: number;
}

interface HardwareInfo {
  gpuAvailable: boolean;
  gpuName: string;
  cudaAvailable: boolean;
  vramGb: number;
  monaiAvailable: boolean;
  monaiVersion: string | null;
  totalSegmentatorAvailable: boolean;
  vista3dAvailable: boolean;
  monaiPhysioAvailable: boolean;
  torchVersion: string | null;
  notice: string | null;
}

interface AIAnalysisPanelProps {
  studyId: string;
  seriesId: string;
  modality?: string;
  priorStudyId?: string;
  organMeshes: OrganMeshState[];
  onOrganMeshesChange: (meshes: OrganMeshState[]) => void;
  onRunQCCheck?: () => void;
  onTriggerRegistration?: () => void;
  onTriggerMotionAnalysis?: () => void;
  className?: string;
}

export function AIAnalysisPanel({
  studyId,
  seriesId,
  modality = "CT",
  priorStudyId,
  organMeshes,
  onOrganMeshesChange,
  onRunQCCheck,
  onTriggerRegistration,
  onTriggerMotionAnalysis,
  className,
}: AIAnalysisPanelProps) {
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [isLoadingHw, setIsLoadingHw] = useState(false);

  // Pipeline states
  const [segStatus, setSegStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [segProgress, setSegProgress] = useState(0);
  const [segStage, setSegStage] = useState("");
  const [segTimeMs, setSegTimeMs] = useState(0);

  const [regStatus, setRegStatus] = useState<"idle" | "running" | "completed" | "failed" | "unsupported">("idle");
  const [regNotice, setRegNotice] = useState<string | null>(null);

  const [motionStatus, setMotionStatus] = useState<"idle" | "running" | "completed" | "unsupported">("idle");
  const [motionNotice, setMotionNotice] = useState<string | null>(null);

  const [qcStatus, setQcStatus] = useState<"idle" | "running" | "completed">("idle");
  const [qcResult, setQcResult] = useState<any | null>(null);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Fetch hardware detection
  useEffect(() => {
    let mounted = true;
    setIsLoadingHw(true);
    fetch("/api/ai/hardware")
      .then((res) => res.json())
      .then((data) => {
        if (mounted) {
          setHardware(data);
          setIsLoadingHw(false);
        }
      })
      .catch(() => {
        if (mounted) setIsLoadingHw(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Check if study already has derived segmentation
  const loadDerivedManifest = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/derived/${studyId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.status === "completed") {
        setSegStatus("completed");
        setSegTimeMs(data.processingTimeMs || 0);

        if (data.segments && Array.isArray(data.segments) && organMeshes.length === 0) {
          const loadedMeshes: OrganMeshState[] = data.segments.map((seg: any) => ({
            id: seg.id,
            name: seg.name,
            group: seg.group || "organ",
            color: seg.color || "#38BDF8",
            opacity: 0.7,
            visible: true,
            isolated: false,
            volumeMl: seg.volumeMl,
            maxDiameterMm: seg.maxDiameterMm,
          }));
          onOrganMeshesChange(loadedMeshes);
        }
      }
    } catch (err) {}
  }, [studyId, organMeshes.length, onOrganMeshesChange]);

  useEffect(() => {
    loadDerivedManifest();
  }, [loadDerivedManifest]);

  // Poll active background job
  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${activeJobId}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.status === "running" || job.status === "preparing") {
          setSegStatus("running");
          setSegProgress(job.progress || 20);
          setSegStage(job.stage || "Processing...");
        } else if (job.status === "completed") {
          setSegStatus("completed");
          setSegProgress(100);
          setSegTimeMs(job.processingTimeMs || 0);
          setActiveJobId(null);
          loadDerivedManifest();
        } else if (job.status === "failed") {
          setSegStatus("failed");
          setSegStage(job.error || "Segmentation pipeline failed");
          setActiveJobId(null);
        }
      } catch (err) {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobId, loadDerivedManifest]);

  // Run Segmentation & 3D Reconstruction
  const handleRunSegmentation = async () => {
    setSegStatus("running");
    setSegProgress(10);
    setSegStage("Initializing MONAI AI worker job");

    try {
      const res = await fetch("/api/ai/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          seriesId,
          pipeline: "segmentation",
        }),
      });

      const data = await res.json();
      if (data.cached && data.result) {
        setSegStatus("completed");
        setSegProgress(100);
        loadDerivedManifest();
      } else if (data.jobId) {
        setActiveJobId(data.jobId);
      } else {
        setSegStatus("failed");
        setSegStage(data.error || "Failed to start AI job");
      }
    } catch (err) {
      setSegStatus("failed");
      setSegStage(err instanceof Error ? err.message : "Network error");
    }
  };

  // Run Prior Registration
  const handleRunRegistration = async () => {
    if (!priorStudyId) {
      setRegNotice("No prior comparison study selected.");
      setRegStatus("unsupported");
      return;
    }
    setRegStatus("running");
    setRegNotice(null);

    try {
      const res = await fetch("/api/ai/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentStudyId: studyId,
          priorStudyId,
        }),
      });
      const data = await res.json();
      if (data.status === "SUCCESS" || data.status === "PARTIAL") {
        setRegStatus("completed");
        setRegNotice(`Registration ${data.status} (NCC: ${data.metrics?.normalizedCrossCorrelation})`);
        onTriggerRegistration?.();
      } else {
        setRegStatus("failed");
        setRegNotice(data.message || "Registration failed to converge");
      }
    } catch (err) {
      setRegStatus("failed");
      setRegNotice("Registration request failed");
    }
  };

  // Run 4D Motion Analysis
  const handleRunMotion = async () => {
    setMotionStatus("running");
    setMotionNotice(null);

    try {
      const res = await fetch("/api/ai/motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          seriesId,
        }),
      });
      const data = await res.json();
      if (data.status === "COMPLETED") {
        setMotionStatus("completed");
        setMotionNotice(`Dynamic 4D cine analyzed (${data.phaseCount} phases, LVEF: ${data.cardiacMetrics?.LVEF?.value}%)`);
        onTriggerMotionAnalysis?.();
      } else if (data.status === "UNSUPPORTED") {
        setMotionStatus("unsupported");
        setMotionNotice(data.message || "Static 3D acquisition (no 4D cardiac/respiratory phases)");
      } else {
        setMotionStatus("unsupported");
        setMotionNotice(data.message || "Motion pipeline unsupported on this series");
      }
    } catch (err) {
      setMotionStatus("unsupported");
      setMotionNotice("Motion pipeline check failed");
    }
  };

  // Run Anatomical QC
  const handleRunQC = async () => {
    setQcStatus("running");
    try {
      const res = await fetch("/api/ai/qc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          findings: [],
        }),
      });
      const data = await res.json();
      setQcStatus("completed");
      setQcResult(data);
      onRunQCCheck?.();
    } catch (err) {
      setQcStatus("idle");
    }
  };

  const toggleOrganVisibility = (id: string) => {
    const next = organMeshes.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m));
    onOrganMeshesChange(next);
  };

  const isolateOrgan = (id: string) => {
    const isCurrentlyIsolated = organMeshes.find((m) => m.id === id)?.isolated;
    const next = organMeshes.map((m) => ({
      ...m,
      isolated: isCurrentlyIsolated ? false : m.id === id,
      visible: isCurrentlyIsolated ? true : m.id === id,
    }));
    onOrganMeshesChange(next);
  };

  const updateOrganOpacity = (id: string, opacity: number) => {
    const next = organMeshes.map((m) => (m.id === id ? { ...m, opacity } : m));
    onOrganMeshesChange(next);
  };

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border-strong bg-panel/95 p-3.5 backdrop-blur-md shadow-xl text-ink-primary", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-strong pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-clinical/15 text-clinical">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-primary">MONAI 3D AI Workstation</h3>
            <p className="text-[10px] text-ink-muted">Physiological Segmentation & 3D Reconstruction</p>
          </div>
        </div>

        {/* Hardware Status Badge */}
        {hardware && (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono border",
              hardware.gpuAvailable
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            )}
            title={hardware.notice || `${hardware.gpuName} (${hardware.vramGb} GB VRAM)`}
          >
            <Cpu className="h-3 w-3" />
            <span>{hardware.gpuAvailable ? `${hardware.gpuName.slice(0, 14)}` : "CPU SIMD Engine"}</span>
          </div>
        )}
      </div>

      {/* Pipeline Action Cards */}
      <div className="grid grid-cols-2 gap-2">
        {/* 1. CT/MRI Segmentation */}
        <div className="flex flex-col justify-between rounded-md border border-border-strong bg-panel-alt/70 p-2.5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold text-ink-primary">Anatomical Segmentation</span>
            {segStatus === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
            {segStatus === "running" && <Activity className="h-3.5 w-3.5 animate-spin text-clinical" />}
          </div>
          <p className="text-[10px] text-ink-muted mt-0.5">Lungs, Heart, Spine, Aorta, Abdominal</p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-secondary">
              {segStatus === "completed" ? `${(segTimeMs / 1000).toFixed(1)}s` : segStatus}
            </span>
            <Button
              size="sm"
              variant={segStatus === "completed" ? "outline" : "primary"}
              onClick={handleRunSegmentation}
              disabled={segStatus === "running"}
              className="h-6 text-[10px] px-2"
            >
              {segStatus === "completed" ? "Re-run" : "Run 3D AI"}
            </Button>
          </div>
        </div>

        {/* 2. Prior Study Registration */}
        <div className="flex flex-col justify-between rounded-md border border-border-strong bg-panel-alt/70 p-2.5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold text-ink-primary">Prior Registration</span>
            {regStatus === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
            {regStatus === "unsupported" && <HelpCircle className="h-3.5 w-3.5 text-ink-muted" />}
          </div>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {priorStudyId ? "Rigid & deformable alignment" : "No prior study linked"}
          </p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-secondary">{regStatus}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunRegistration}
              disabled={regStatus === "running" || !priorStudyId}
              className="h-6 text-[10px] px-2"
            >
              Align Prior
            </Button>
          </div>
        </div>

        {/* 3. 4D Motion Analysis */}
        <div className="flex flex-col justify-between rounded-md border border-border-strong bg-panel-alt/70 p-2.5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold text-ink-primary">4D Motion Analysis</span>
            {motionStatus === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
            {motionStatus === "unsupported" && <HelpCircle className="h-3.5 w-3.5 text-ink-muted" />}
          </div>
          <p className="text-[10px] text-ink-muted mt-0.5">Cardiac cine & respiratory dynamics</p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-secondary">{motionStatus}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunMotion}
              disabled={motionStatus === "running"}
              className="h-6 text-[10px] px-2"
            >
              Scan 4D
            </Button>
          </div>
        </div>

        {/* 4. Anatomical QC Validation */}
        <div className="flex flex-col justify-between rounded-md border border-border-strong bg-panel-alt/70 p-2.5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold text-ink-primary">Anatomical QC Guard</span>
            {qcStatus === "completed" && <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
          </div>
          <p className="text-[10px] text-ink-muted mt-0.5">Verify coordinates vs 3D masks</p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-secondary">{qcStatus}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunQC}
              disabled={qcStatus === "running"}
              className="h-6 text-[10px] px-2"
            >
              Run QC
            </Button>
          </div>
        </div>
      </div>

      {/* Progress Notification */}
      {segStatus === "running" && (
        <div className="rounded-md border border-clinical/30 bg-clinical/10 p-2.5 text-xs text-clinical-strong">
          <div className="flex justify-between font-mono text-[10px] mb-1">
            <span>{segStage}</span>
            <span>{segProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel">
            <div className="h-full bg-clinical transition-all duration-300" style={{ width: `${segProgress}%` }} />
          </div>
        </div>
      )}

      {regNotice && (
        <div className="rounded border border-border-strong bg-panel-alt/80 px-2.5 py-1.5 text-[11px] text-ink-secondary flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-clinical shrink-0" />
          <span>{regNotice}</span>
        </div>
      )}

      {motionNotice && (
        <div className="rounded border border-border-strong bg-panel-alt/80 px-2.5 py-1.5 text-[11px] text-ink-secondary flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-clinical shrink-0" />
          <span>{motionNotice}</span>
        </div>
      )}

      {/* 3D Organ Meshes Layer Controls (Section 11) */}
      {organMeshes.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border-strong pt-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
              3D Anatomical Layers ({organMeshes.length})
            </span>
            <span className="text-[10px] text-ink-muted">GLB Surface Meshes</span>
          </div>

          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {organMeshes.map((organ) => (
              <div
                key={organ.id}
                className={cn(
                  "flex items-center justify-between rounded border px-2 py-1 text-xs transition-colors",
                  organ.visible ? "border-border-strong bg-panel-alt/60" : "border-transparent bg-panel-alt/20 opacity-60"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: organ.color }}
                  />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-ink-primary leading-tight">{organ.name}</span>
                    {organ.volumeMl !== undefined && (
                      <span className="font-mono text-[9px] text-ink-muted">
                        {organ.volumeMl} ml · {organ.maxDiameterMm} mm
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {/* Opacity Slider */}
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={organ.opacity}
                    onChange={(e) => updateOrganOpacity(organ.id, parseFloat(e.target.value))}
                    className="h-1 w-12 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
                    title={`Opacity: ${Math.round(organ.opacity * 100)}%`}
                  />

                  {/* Isolate Button */}
                  <button
                    onClick={() => isolateOrgan(organ.id)}
                    className={cn(
                      "px-1 py-0.5 rounded text-[9px] font-mono",
                      organ.isolated ? "bg-clinical text-white font-bold" : "text-ink-muted hover:text-ink-primary"
                    )}
                    title="Isolate this organ"
                  >
                    SOLO
                  </button>

                  {/* Visibility Eye */}
                  <button
                    onClick={() => toggleOrganVisibility(organ.id)}
                    className="p-1 text-ink-secondary hover:text-ink-primary"
                    title={organ.visible ? "Hide layer" : "Show layer"}
                  >
                    {organ.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-ink-muted" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
