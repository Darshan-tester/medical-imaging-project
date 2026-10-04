"use client";

import { memo, useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  RotateCcw,
  Check,
  Eye,
  EyeOff,
  Plus,
  ArrowRight,
  ShieldCheck,
  Activity,
  Layers,
  Heart,
  Wind,
  Brain,
  Stethoscope,
  ChevronRight,
  GitCompare,
} from "lucide-react";
import { Finding, Modality, SeriesInfo, Study } from "@/lib/types";
import { OrganMeshState } from "./AIAnalysisPanel";
import { Button } from "@/components/ui/Button";
import { ConfidenceIndicator } from "@/components/ui/ConfidenceIndicator";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export interface ClinicalAITask {
  id: string;
  name: string;
  description: string;
  pipeline: "segmentation" | "heart" | "lungs" | "brain" | "registration" | "all";
  icon: typeof Sparkles;
  applicableModalities: Modality[];
  applicableRegions?: string[];
  status: "idle" | "running" | "completed" | "failed";
  progress?: number;
  stage?: string;
  completedAt?: string;
  metricsSummary?: string;
}

interface ClinicalAIPanelProps {
  study: Study;
  activeSeries: SeriesInfo;
  organMeshes: OrganMeshState[];
  onOrganMeshesChange: (meshes: OrganMeshState[]) => void;
  onJumpToSlice?: (sliceIndex: number) => void;
  onAppendFindingToReport?: (text: string) => void;
  onOpenReportTab?: () => void;
  onSwitchTo3D?: () => void;
  priorStudyId?: string;
  findings: Finding[];
  onUpdateFinding: (id: string, patch: Partial<Finding>) => void;
  activeFindingId?: string | null;
  onSelectFinding?: (id: string) => void;
}

export const ClinicalAIPanel = memo(function ClinicalAIPanel({
  study,
  activeSeries,
  organMeshes,
  onOrganMeshesChange,
  onJumpToSlice,
  onAppendFindingToReport,
  onOpenReportTab,
  onSwitchTo3D,
  priorStudyId,
  findings,
  onUpdateFinding,
  activeFindingId,
  onSelectFinding,
}: ClinicalAIPanelProps) {
  const modality = study.modality;
  const region = (study.bodyRegion || "").toUpperCase();

  // Define clinical tasks based on study modality and body region
  const initialTasks = (): ClinicalAITask[] => {
    const list: ClinicalAITask[] = [];

    if (modality === "CT") {
      if (region.includes("CHEST") || region.includes("THORAX") || !region) {
        list.push({
          id: "task-lungs",
          name: "Lung & Airway Segmentation",
          description: "Extract left and right lung lobes, airways, and parenchymal density",
          pipeline: "lungs",
          icon: Wind,
          applicableModalities: ["CT"],
          status: organMeshes.some((m) => m.name.toLowerCase().includes("lung")) ? "completed" : "idle",
        });
        list.push({
          id: "task-heart",
          name: "Cardiac & Great Vessels",
          description: "Segment pericardium, myocardium, thoracic aorta, and pulmonary trunk",
          pipeline: "heart",
          icon: Heart,
          applicableModalities: ["CT"],
          status: organMeshes.some((m) => m.name.toLowerCase().includes("heart") || m.name.toLowerCase().includes("aorta")) ? "completed" : "idle",
        });
      }
      if (region.includes("HEAD") || region.includes("BRAIN")) {
        list.push({
          id: "task-brain",
          name: "Intracranial Structure Analysis",
          description: "Segment cerebrum, cerebellum, ventricles, and extra-axial spaces",
          pipeline: "brain",
          icon: Brain,
          applicableModalities: ["CT", "MRI"],
          status: organMeshes.some((m) => m.name.toLowerCase().includes("brain") || m.name.toLowerCase().includes("ventricle")) ? "completed" : "idle",
        });
      }
      list.push({
        id: "task-all-organs",
        name: "Full Multi-Organ Volumetrics",
        description: "Standardized 11-structure anatomical segmentation & 3D mesh reconstruction",
        pipeline: "segmentation",
        icon: Sparkles,
        applicableModalities: ["CT"],
        status: organMeshes.length >= 4 ? "completed" : "idle",
      });
    } else if (modality === "MRI") {
      list.push({
        id: "task-mri-brain",
        name: "Cerebral Parenchyma & Ventricles",
        description: "Multi-sequence tissue segmentation across T1, T2, and FLAIR",
        pipeline: "brain",
        icon: Brain,
        applicableModalities: ["MRI"],
        status: organMeshes.some((m) => m.name.toLowerCase().includes("brain")) ? "completed" : "idle",
      });
      list.push({
        id: "task-all-mri",
        name: "Multi-Sequence Structure Analysis",
        description: "Full sequence alignment and volumetric reconstruction",
        pipeline: "segmentation",
        icon: Sparkles,
        applicableModalities: ["MRI"],
        status: organMeshes.length > 0 ? "completed" : "idle",
      });
    } else {
      // General or PET
      list.push({
        id: "task-general-seg",
        name: "Anatomical Structure Analysis",
        description: "Segment available regions and correlate metabolic uptake",
        pipeline: "segmentation",
        icon: Sparkles,
        applicableModalities: [modality],
        status: organMeshes.length > 0 ? "completed" : "idle",
      });
    }

    if (priorStudyId) {
      list.push({
        id: "task-registration",
        name: "Longitudinal Prior Registration",
        description: "Rigid & deformable 3D spatial alignment against prior study",
        pipeline: "registration",
        icon: GitCompare,
        applicableModalities: ["CT", "MRI", "PET"],
        status: "idle",
      });
    }

    return list;
  };

  const [tasks, setTasks] = useState<ClinicalAITask[]>(initialTasks);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  // Sync tasks completion state with organMeshes
  useEffect(() => {
    if (organMeshes.length > 0) {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.pipeline === "lungs" && organMeshes.some((m) => m.name.toLowerCase().includes("lung"))) {
            return { ...t, status: "completed", progress: 100 };
          }
          if (t.pipeline === "heart" && organMeshes.some((m) => m.name.toLowerCase().includes("heart"))) {
            return { ...t, status: "completed", progress: 100 };
          }
          if (t.pipeline === "brain" && organMeshes.some((m) => m.name.toLowerCase().includes("brain"))) {
            return { ...t, status: "completed", progress: 100 };
          }
          if (t.pipeline === "segmentation" && organMeshes.length >= 3) {
            return { ...t, status: "completed", progress: 100 };
          }
          return t;
        })
      );
    }
  }, [organMeshes]);

  // Load derived meshes if available
  const reloadDerivedData = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${study.id}/analysis`);
      if (!res.ok) return;
      const data = await res.json();

      if (data && (data.status === "completed" || data.status === "COMPLETED")) {
        if (data.segments && Array.isArray(data.segments)) {
          const loadedMeshes: OrganMeshState[] = data.segments.map((seg: any) => ({
            id: seg.id,
            name: seg.name,
            group: seg.group || "organ",
            color: seg.color || "#38BDF8",
            opacity: 0.75,
            visible: true,
            isolated: false,
            volumeMl: seg.volumeMl,
            maxDiameterMm: seg.maxDiameterMm,
          }));
          onOrganMeshesChange(loadedMeshes);
        }
      }
    } catch {}
  }, [study.id, onOrganMeshesChange]);

  // Poll running AI job
  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJobId}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.status === "running" || job.status === "preparing") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === runningTaskId
                ? { ...t, status: "running", progress: job.progress || 35, stage: job.stage || "Processing..." }
                : t
            )
          );
        } else if (job.status === "completed") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === runningTaskId
                ? { ...t, status: "completed", progress: 100, stage: "Complete", completedAt: new Date().toLocaleTimeString() }
                : t
            )
          );
          setActiveJobId(null);
          setRunningTaskId(null);
          reloadDerivedData();
        } else if (job.status === "failed") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === runningTaskId
                ? { ...t, status: "failed", stage: job.error || "Analysis failed" }
                : t
            )
          );
          setActiveJobId(null);
          setRunningTaskId(null);
        }
      } catch {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJobId, runningTaskId, reloadDerivedData]);

  // Trigger Clinical Task
  const handleRunTask = async (task: ClinicalAITask) => {
    setRunningTaskId(task.id);
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: "running", progress: 15, stage: "Starting task..." } : t))
    );

    try {
      const res = await fetch(`/api/studies/${study.id}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: activeSeries.id,
          pipeline: task.pipeline,
          modality: study.modality,
          priorStudyId,
        }),
      });

      const data = await res.json();

      if (data.cached && data.result) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === task.id
              ? { ...t, status: "completed", progress: 100, stage: "Cached output loaded", completedAt: new Date().toLocaleTimeString() }
              : t
          )
        );
        setRunningTaskId(null);
        reloadDerivedData();
      } else if (data.jobId) {
        setActiveJobId(data.jobId);
      } else {
        setTasks((prev) =>
          prev.map((t) => (t.id === task.id ? { ...t, status: "failed", stage: data.error || "Failed to start" } : t))
        );
        setRunningTaskId(null);
      }
    } catch (err) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: "failed", stage: err instanceof Error ? err.message : "Network error" } : t
        )
      );
      setRunningTaskId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto divide-y divide-border bg-panel text-ink-primary select-none text-[12px]">
      {/* 1. Header */}
      <div className="p-3.5 bg-base/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-ink-primary text-[12.5px]">
            <Sparkles className="h-4 w-4 text-clinical" />
            <span>AI Clinical Analysis</span>
          </div>
          <span className="flex items-center gap-1 rounded bg-clinical-dim px-2 py-0.5 text-[10.5px] font-medium text-clinical-strong">
            <ShieldCheck className="h-3 w-3" />
            <span>Decision Support</span>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-secondary leading-normal">
          Automated volumetric segmentation and feature extraction for {study.modality}{" "}
          {study.bodyRegion ? `(${study.bodyRegion})` : ""}. Does not disrupt 2D diagnostic review.
        </p>
      </div>

      {/* 2. Clinical Tasks List */}
      <div className="p-3.5 space-y-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted block">
          Available Tasks ({tasks.length})
        </span>

        <div className="space-y-2">
          {tasks.map((task) => {
            const Icon = task.icon;
            const isRunning = task.status === "running";
            const isCompleted = task.status === "completed";
            const isFailed = task.status === "failed";

            return (
              <div
                key={task.id}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-3 transition-all",
                  isCompleted
                    ? "border-clinical/40 bg-clinical-dim/30"
                    : isRunning
                    ? "border-warning/50 bg-warning-dim/20"
                    : isFailed
                    ? "border-critical/40 bg-critical-dim/20"
                    : "border-border-strong/70 bg-base hover:border-clinical/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                        isCompleted
                          ? "bg-clinical text-white"
                          : isRunning
                          ? "bg-warning/20 text-warning"
                          : "bg-base border border-border text-ink-muted"
                      )}
                    >
                      {isRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isCompleted ? (
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[12px] text-ink-primary leading-tight">
                          {task.name}
                        </p>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-ink-secondary leading-normal">
                        {task.description}
                      </p>
                    </div>
                  </div>

                  {/* Task Action / Status Button */}
                  <div className="shrink-0">
                    {isCompleted ? (
                      <span className="flex items-center gap-1 rounded bg-success-dim px-2 py-0.5 text-[10.5px] font-semibold text-success">
                        <Check className="h-3 w-3" />
                        <span>Ready</span>
                      </span>
                    ) : isRunning ? (
                      <span className="flex items-center gap-1 rounded bg-warning-dim px-2 py-0.5 text-[10.5px] font-semibold text-warning">
                        <span>{task.progress ?? 0}%</span>
                      </span>
                    ) : isFailed ? (
                      <button
                        onClick={() => handleRunTask(task)}
                        className="flex items-center gap-1 rounded border border-critical/50 bg-critical-dim px-2 py-1 text-[10.5px] font-medium text-critical hover:bg-critical-dim/80 transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Retry</span>
                      </button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRunTask(task)}
                        disabled={Boolean(activeJobId)}
                        className="gap-1 text-[11px] h-7 px-2.5"
                      >
                        <Play className="h-3 w-3 fill-current text-clinical" />
                        <span>Run</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Live Progress Bar for running task */}
                {isRunning && (
                  <div className="space-y-1 pt-1">
                    <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full bg-clinical transition-all duration-300"
                        style={{ width: `${task.progress ?? 20}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-ink-muted italic block truncate">
                      {task.stage || "Processing patient volume..."}
                    </span>
                  </div>
                )}

                {/* Quick actions for completed task */}
                {isCompleted && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/50 text-[10.5px]">
                    {onSwitchTo3D && (
                      <button
                        onClick={onSwitchTo3D}
                        className="flex items-center gap-1 text-clinical hover:underline font-medium"
                      >
                        <span>View in 3D Anatomy</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    {organMeshes.length > 0 && (
                      <span className="text-ink-muted">
                        · {organMeshes.length} structures segmented
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Clinical Findings & Evidence */}
      <div className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Detected Findings ({findings.length})
          </span>
          <span className="text-[10.5px] text-ink-muted">Click to localize</span>
        </div>

        {findings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-center text-ink-muted text-[11px]">
            No acute AI findings detected on reference series.
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {findings.map((f) => {
              const isSelected = activeFindingId === f.id;

              return (
                <div
                  key={f.id}
                  onClick={() => {
                    if (onSelectFinding) onSelectFinding(f.id);
                    if (onJumpToSlice && f.sliceIndex !== undefined) onJumpToSlice(f.sliceIndex);
                  }}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-lg border p-2.5 cursor-pointer transition-all",
                    isSelected
                      ? "border-clinical bg-clinical-dim ring-1 ring-clinical"
                      : "border-border-strong/70 bg-base hover:border-clinical/50",
                    f.isCritical && "border-critical/60 bg-critical-dim/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[11.5px] text-ink-primary">
                          {f.label}
                        </span>
                        {f.isCritical && (
                          <span className="rounded bg-critical-dim px-1 py-0.2 text-[9px] font-bold uppercase text-critical">
                            STAT
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-ink-secondary line-clamp-2 mt-0.5">
                        {f.description}
                      </p>
                    </div>

                    <ConfidenceIndicator value={f.confidence} band={f.band} />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 text-[10px] text-ink-muted">
                    <span>
                      {f.location || "Thoracic"} · Slice {f.sliceIndex + 1}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {onAppendFindingToReport && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAppendFindingToReport(`${f.label}: ${f.description} (Slice ${f.sliceIndex + 1})`);
                            onUpdateFinding(f.id, { status: "accepted" });
                          }}
                          className="flex items-center gap-1 text-clinical hover:underline font-medium"
                          title="Append this finding directly to the working report"
                        >
                          <Plus className="h-3 w-3" />
                          <span>To Report</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
