"use client";

import { memo, useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
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
import { ClinicalAIFindingCard } from "./ClinicalAIFindingCard";

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
  onSelectSeries?: (seriesId: string) => void;
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
  onSelectSeries,
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
  const [findingFilter, setFindingFilter] = useState<"all" | "critical" | "pending" | "reviewed">("all");

  const filteredFindings = findings.filter((f) => {
    if (findingFilter === "critical") return f.isCritical;
    if (findingFilter === "pending") return f.status === "pending" || f.status === "unreviewed";
    if (findingFilter === "reviewed") return f.status === "accepted" || f.status === "modified" || f.status === "rejected";
    return true;
  });

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
      {/* 0. Global Clinical AI Safety Banner (Section 4) */}
      <div className="border-b border-amber-800/40 bg-amber-950/20 px-3.5 py-2.5 text-[11px] text-amber-200/90 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="leading-snug">
          <span className="font-semibold text-amber-300 block">
            AI decision support — radiologist review required.
          </span>
          <span className="text-[10px] text-amber-300/80">
            Automated model outputs are decision support detections. Diagnostic interpretation requires qualified radiologist review.
          </span>
        </div>
      </div>

      {/* 1. Header */}
      <div className="p-3.5 bg-base/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-ink-primary text-[12.5px]">
            <Sparkles className="h-4 w-4 text-clinical" />
            <span>AI Clinical Analysis &amp; Volumetrics</span>
          </div>
          <span className="flex items-center gap-1 rounded bg-clinical-dim px-2 py-0.5 text-[10.5px] font-medium text-clinical-strong">
            <ShieldCheck className="h-3 w-3" />
            <span>Decision Support</span>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-secondary leading-normal">
          Automated multi-planar detections and organ volumetrics for {study.modality}{" "}
          {study.bodyRegion ? `(${study.bodyRegion})` : ""}. Radiologist verification is required for all candidate findings.
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

      {/* 3. Clinical Findings & Evidence (Sections 10-17) */}
      <div className="p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              AI Decision Support Findings
            </span>
            <span className="rounded bg-clinical/20 text-clinical-strong font-mono px-1.5 py-0.2 text-[10px] font-semibold">
              {findings.length}
            </span>
          </div>
          <span className="text-[10px] text-ink-muted font-mono">
            Reviewed: {findings.filter((f) => f.status === "accepted" || f.status === "modified" || f.status === "rejected").length} / {findings.length}
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 border-b border-border/50 pb-2 text-[10.5px]">
          <button
            type="button"
            onClick={() => setFindingFilter("all")}
            className={cn(
              "px-2 py-0.5 rounded font-medium transition-colors",
              findingFilter === "all"
                ? "bg-clinical text-white font-semibold"
                : "text-ink-muted hover:text-ink-secondary hover:bg-base"
            )}
          >
            All ({findings.length})
          </button>
          <button
            type="button"
            onClick={() => setFindingFilter("critical")}
            className={cn(
              "px-2 py-0.5 rounded font-medium transition-colors",
              findingFilter === "critical"
                ? "bg-critical text-white font-semibold"
                : "text-ink-muted hover:text-ink-secondary hover:bg-base"
            )}
          >
            Critical ({findings.filter((f) => f.isCritical).length})
          </button>
          <button
            type="button"
            onClick={() => setFindingFilter("pending")}
            className={cn(
              "px-2 py-0.5 rounded font-medium transition-colors",
              findingFilter === "pending"
                ? "bg-amber-600 text-white font-semibold"
                : "text-ink-muted hover:text-ink-secondary hover:bg-base"
            )}
          >
            Pending ({findings.filter((f) => f.status === "pending" || f.status === "unreviewed").length})
          </button>
          <button
            type="button"
            onClick={() => setFindingFilter("reviewed")}
            className={cn(
              "px-2 py-0.5 rounded font-medium transition-colors",
              findingFilter === "reviewed"
                ? "bg-emerald-600 text-white font-semibold"
                : "text-ink-muted hover:text-ink-secondary hover:bg-base"
            )}
          >
            Reviewed ({findings.filter((f) => f.status === "accepted" || f.status === "modified" || f.status === "rejected").length})
          </button>
        </div>

        {filteredFindings.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-ink-muted text-[11px] space-y-1">
            <p className="font-medium text-ink-secondary">No findings in this category</p>
            <p className="text-[10px]">
              {findings.length === 0
                ? "No automated AI findings detected on reference study."
                : "Change filter tab to view other candidate findings."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFindings.map((f) => (
              <ClinicalAIFindingCard
                key={f.id}
                finding={f}
                study={study}
                isActive={activeFindingId === f.id}
                onSelectFinding={(id) => onSelectFinding?.(id)}
                onShowOnScan={(finding) => {
                  if (finding.seriesId && onSelectSeries) onSelectSeries(finding.seriesId);
                  if (finding.sliceIndex !== undefined && onJumpToSlice) onJumpToSlice(finding.sliceIndex);
                  onSelectFinding?.(finding.id);
                }}
                onAddToReport={(finding) => {
                  if (onAppendFindingToReport) {
                    const locStr = finding.anatomicalLocation || finding.location ? ` in ${finding.anatomicalLocation || finding.location}` : "";
                    const slStr = finding.sliceIndex !== undefined ? ` (Slice ${finding.sliceIndex + 1})` : "";
                    onAppendFindingToReport(`${finding.label}${locStr}${slStr}: ${finding.description || "Identified on AI decision support"}`);
                  }
                }}
                onUpdateFinding={onUpdateFinding}
                onSelectSeries={onSelectSeries}
                onJumpToSlice={onJumpToSlice}
              />
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-border/50 text-[10px] text-ink-muted leading-relaxed">
          AI candidate detections assist radiologist localization. Final diagnostic responsibility remains with the interpreting physician.
        </div>
      </div>
    </div>
  );
});
