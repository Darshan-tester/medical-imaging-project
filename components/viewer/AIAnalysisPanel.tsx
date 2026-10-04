"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  Pause,
  FileCheck,
  FileText,
  Check,
  X,
  Edit2,
  Plus,
  Download,
  ChevronRight,
  Heart,
  Wind,
  Stethoscope,
  RefreshCw,
  Lock,
  ArrowRight,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { RealStudy3DViewer } from "./RealStudy3DViewer";
import { RealStudy4DViewer } from "./RealStudy4DViewer";

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

interface FindingItem {
  findingId: string;
  id?: string;
  studyId: string;
  seriesId?: string;
  modality: string;
  anatomy: string;
  findingType: string;
  description: string;
  label?: string;
  location?: string;
  measurement?: any;
  confidence?: number;
  band?: string;
  source: string;
  pipeline?: string;
  model?: string;
  visualReference?: any;
  reviewStatus: "AI_GENERATED" | "RADIOLOGIST_REVIEWED" | "ACCEPTED" | "EDITED" | "REJECTED";
  status?: string;
  radiologistAction?: string | null;
  radiologistComments?: string;
  createdAt?: string;
}

interface ReportDraft {
  studyId: string;
  version: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "FINAL";
  sections: {
    clinicalInformation: string;
    technique: string;
    findings: string;
    impression: string;
  };
  aiTransparency?: {
    engine: string;
    version: string;
    findingsCount: number;
    disclaimer: string;
  };
  approval?: {
    approvedBy: string;
    radiologistName: string;
    licenseNumber: string;
    approvedAt: string;
    signatureHash: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface MotionMetadata {
  motionType: "ACQUIRED 4D" | "SIMULATED / MODEL-DERIVED" | string;
  isSimulated: boolean;
  provenance: string;
  phaseCount: number;
  cardiacMetrics?: {
    EDV?: { value: number; unit: string };
    ESV?: { value: number; unit: string };
    strokeVolume?: { value: number; unit: string };
    LVEF?: { value: number; unit: string; status: string };
  };
  disclaimer: string;
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
  onSelectOrgan?: (organId: string) => void;
  onJumpToSlice?: (sliceIndex: number) => void;
  onAppendFindingToReport?: (text: string) => void;
  onOpenReportTab?: () => void;
  className?: string;
  /** When true, renders as a full-screen takeover workspace */
  fullscreen?: boolean;
  /** Called when user clicks "Back to Viewer" in full-screen mode */
  onClose?: () => void;
  /** Patient alias for the workspace header */
  patientAlias?: string;
  /** Study description for the workspace header */
  studyDescription?: string;
}

type SubTab = "anatomy" | "motion" | "comparison" | "findings" | "report";

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
  onSelectOrgan,
  onJumpToSlice,
  onAppendFindingToReport,
  onOpenReportTab,
  className,
  fullscreen = false,
  onClose,
  patientAlias,
  studyDescription,
}: AIAnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<SubTab>("anatomy");
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

  // Quantitative Metrics State
  const [metrics, setMetrics] = useState<any | null>(null);
  const [anatomyFilter, setAnatomyFilter] = useState<string>("all");

  // 4D Motion State
  const [motionMeta, setMotionMeta] = useState<MotionMetadata | null>(null);
  const [activePhase, setActivePhase] = useState<number>(0);
  const [isPlayingMotion, setIsPlayingMotion] = useState<boolean>(false);
  const [motionFps, setMotionFps] = useState<number>(4);
  const motionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clinical Findings State
  const [findings, setFindings] = useState<FindingItem[]>([]);
  const [findingFilter, setFindingFilter] = useState<string>("all");
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState<string>("");
  const [isUpdatingFinding, setIsUpdatingFinding] = useState<boolean>(false);

  // Report Draft State
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [isCompilingDraft, setIsCompilingDraft] = useState<boolean>(false);
  const [signModalOpen, setSignModalOpen] = useState<boolean>(false);
  const [radiologistName, setRadiologistName] = useState<string>("Dr. Eleanor Vance, MD");
  const [licenseNumber, setLicenseNumber] = useState<string>("NPI-1942850124");
  const [isSigning, setIsSigning] = useState<boolean>(false);

  // Manual Finding Modal State
  const [addFindingOpen, setAddFindingOpen] = useState<boolean>(false);
  const [manualAnatomy, setManualAnatomy] = useState<string>("");
  const [manualDesc, setManualDesc] = useState<string>("");

  // Real 3D / 4D Model View Options
  const [anatomyViewMode, setAnatomyViewMode] = useState<"3d" | "split" | "layers">("split");
  const [motionViewMode, setMotionViewMode] = useState<"4d" | "split" | "metrics">("split");
  const [modal3DOpen, setModal3DOpen] = useState<boolean>(false);
  const [modal4DOpen, setModal4DOpen] = useState<boolean>(false);

  // 1. Fetch hardware detection
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

  // 2. Load Derived Manifest & Metadata
  const loadDerivedManifest = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/analysis`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && (data.status === "completed" || data.status === "COMPLETED")) {
        setSegStatus("completed");
        setSegTimeMs(data.processingTimeMs || 0);

        if (data.metrics) {
          setMetrics(data.metrics);
        }

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

  // 3. Load 4D Motion Metadata (strictly genuine acquired temporal data only)
  const loadMotionMetadata = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/derived/motion4d/motion_metadata.json`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.isSimulated && data.motionType === "ACQUIRED 4D") {
          setMotionMeta(data);
          setMotionStatus("completed");
        } else {
          setMotionMeta(null);
          setMotionStatus("unsupported");
        }
      }
    } catch (err) {}
  }, [studyId]);

  // 4. Load Findings
  const loadFindings = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/findings`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setFindings(data);
        }
      }
    } catch (err) {}
  }, [studyId]);

  // 5. Load Report Draft
  const loadDraft = useCallback(async () => {
    try {
      const res = await fetch(`/api/studies/${studyId}/report/draft`);
      if (res.ok) {
        const data = await res.json();
        setDraft(data);
      }
    } catch (err) {}
  }, [studyId]);

  useEffect(() => {
    loadDerivedManifest();
    loadMotionMetadata();
    loadFindings();
    loadDraft();
  }, [loadDerivedManifest, loadMotionMetadata, loadFindings, loadDraft]);

  // 4D Cine Playback Timer with requestAnimationFrame for jitter-free 60 FPS synchronization
  useEffect(() => {
    if (!isPlayingMotion || !motionMeta || motionMeta.phaseCount <= 1) {
      return;
    }

    let rafId: number;
    let lastTime = performance.now();
    const intervalMs = 1000 / motionFps;

    const loop = (now: number) => {
      if (now - lastTime >= intervalMs) {
        setActivePhase((prev) => (prev + 1) % motionMeta.phaseCount);
        lastTime = now;
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isPlayingMotion, motionFps, motionMeta]);

  // Poll active background job
  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJobId}`);
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
          loadFindings();
          loadDraft();
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
  }, [activeJobId, loadDerivedManifest, loadFindings, loadDraft]);

  // Run Segmentation & 3D Reconstruction
  const handleRunSegmentation = async () => {
    setSegStatus("running");
    setSegProgress(10);
    setSegStage("Initializing MONAI AI worker job");

    try {
      const res = await fetch(`/api/studies/${studyId}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId,
          pipeline: "segmentation",
          modality,
        }),
      });

      const data = await res.json();
      if (data.cached && data.result) {
        setSegStatus("completed");
        setSegProgress(100);
        loadDerivedManifest();
        loadFindings();
        loadDraft();
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
        loadFindings();
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
        loadMotionMetadata();
        loadFindings();
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

  // Review Finding Action (Accept, Edit, Reject)
  const handleReviewFinding = async (findingId: string, action: "ACCEPTED" | "EDITED" | "REJECTED", comment?: string) => {
    setIsUpdatingFinding(true);
    try {
      const res = await fetch(`/api/studies/${studyId}/findings/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewStatus: action,
          radiologistComments: comment !== undefined ? comment : "",
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setFindings((prev) => prev.map((f) => (f.findingId === findingId ? updated : f)));
        setEditingFindingId(null);
        setEditComment("");
      }
    } catch (err) {
    } finally {
      setIsUpdatingFinding(false);
    }
  };

  // Append finding to report draft
  const handleAddFindingToReport = (f: FindingItem) => {
    const text = `• [${f.anatomy}]: ${f.description}`;
    if (onAppendFindingToReport) {
      onAppendFindingToReport(text);
    }
    // Also mark finding as ACCEPTED
    handleReviewFinding(f.findingId, "ACCEPTED");
  };

  // Compile / Refresh Report Draft
  const handleCompileDraft = async () => {
    setIsCompilingDraft(true);
    try {
      const res = await fetch(`/api/studies/${studyId}/report/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setDraft(data);
      }
    } catch (err) {
    } finally {
      setIsCompilingDraft(false);
    }
  };

  // Approve & Sign Report
  const handleApproveReport = async () => {
    setIsSigning(true);
    try {
      const res = await fetch(`/api/studies/${studyId}/report/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          radiologistName,
          licenseNumber,
          findings: findings.filter((f) => f.reviewStatus !== "REJECTED").map((f) => f.description),
          impression: draft?.sections.impression || "Study reviewed and verified with AI assistance.",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraft((prev) => (prev ? { ...prev, status: "APPROVED", approval: data.approval } : null));
        setSignModalOpen(false);
      }
    } catch (err) {
    } finally {
      setIsSigning(false);
    }
  };

  // Manual Radiologist Finding Submission
  const handleAddManualFinding = async () => {
    if (!manualAnatomy.trim() || !manualDesc.trim()) return;
    try {
      const res = await fetch(`/api/studies/${studyId}/findings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anatomy: manualAnatomy,
          description: manualDesc,
          findingType: "Radiologist Clinical Observation",
          location: "Visualized anatomical region",
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setFindings((prev) => [created, ...prev]);
        setAddFindingOpen(false);
        setManualAnatomy("");
        setManualDesc("");
      }
    } catch (err) {}
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

  const filteredFindings = findings.filter((f) => {
    if (findingFilter === "all") return true;
    if (findingFilter === "pending") return f.reviewStatus === "AI_GENERATED";
    return f.reviewStatus.toLowerCase() === findingFilter.toLowerCase();
  });

  const filteredOrgans = organMeshes.filter((m) => {
    if (anatomyFilter === "all") return true;
    return m.group.toLowerCase() === anatomyFilter.toLowerCase();
  });

  // ============================================================
  // FULL-SCREEN WORKSPACE RENDER
  // ============================================================
  if (fullscreen) {
    return (
      <div className="flex flex-col h-full bg-base text-ink-primary" style={{ minHeight: 0 }}>
        {/* ── Workspace Header ── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-strong bg-panel px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-clinical hover:bg-clinical/10 hover:text-clinical shrink-0"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" />
              Back to Viewer
            </button>
            <div className="h-4 w-px bg-border-strong shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-clinical/15 text-clinical">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink-primary truncate">MONAI Physio AI Workstation</h2>
                {patientAlias && (
                  <p className="text-[10px] text-ink-muted truncate">{patientAlias}{studyDescription ? ` · ${studyDescription}` : ""}</p>
                )}
              </div>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {hardware && (
              <div
                className={cn(
                  "hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-mono border",
                  hardware.gpuAvailable
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                )}
                title={hardware.notice || `${hardware.gpuName} (${hardware.vramGb} GB VRAM)`}
              >
                <Cpu className="h-3 w-3" />
                <span>{hardware.gpuAvailable ? hardware.gpuName.slice(0, 18) : "CPU SIMD Engine"}</span>
              </div>
            )}
            {segStatus === "completed" && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            )}
            {segStatus === "running" && (
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-clinical/10 px-2.5 py-1 text-[10px] font-mono text-clinical border border-clinical/20 animate-pulse">
                <Zap className="h-3 w-3" /> Reconstructing…
              </span>
            )}
          </div>
        </div>

        {/* ── Mode Navigation ── */}
        <div className="flex shrink-0 items-center border-b border-border bg-panel px-4">
          {([
            { key: "anatomy" as SubTab, label: "3D Anatomy", icon: Layers },
            { key: "motion" as SubTab, label: "4D Motion", icon: Heart, dot: !!motionMeta },
            { key: "findings" as SubTab, label: "Findings", icon: Sparkles, count: findings.length },
            { key: "report" as SubTab, label: "Report", icon: FileText, check: draft?.status === "APPROVED" },
          ] as Array<{ key: SubTab; label: string; icon: any; dot?: boolean; count?: number; check?: boolean }>).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[12px] font-medium transition-colors",
                activeTab === t.key
                  ? "border-clinical text-ink-primary"
                  : "border-transparent text-ink-muted hover:text-ink-secondary"
              )}
            >
              <t.icon className="h-3.5 w-3.5 shrink-0" />
              <span>{t.label}</span>
              {t.dot && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              {t.count !== undefined && t.count > 0 && (
                <span className="rounded bg-[rgb(var(--overlay-hover)/0.12)] px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">{t.count}</span>
              )}
              {t.check && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
            </button>
          ))}
        </div>

        {/* ── Main Body: Visualization + Sidebar ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Primary content area */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5 gap-4">

            {/* ─── 3D ANATOMY ─── */}
            {activeTab === "anatomy" && (
              <>
                {/* Status / Run Bar + View Options */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-panel px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink-primary">Volumetric 3D Reconstruction</span>
                      {segStatus === "completed" && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">TotalSegmentator-v2 + MONAI Physio Organ Models · {modality}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* View Mode Toggle: Patient 3D Anatomy | Split View | Layers & Metrics */}
                    <div className="flex items-center rounded-lg bg-panel-alt p-1 border border-border">
                      <button
                        onClick={() => setAnatomyViewMode("3d")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          anatomyViewMode === "3d"
                            ? "bg-clinical text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Focus on Full Patient 3D Anatomy Viewport"
                      >
                        <Boxes className="h-3.5 w-3.5" />
                        <span>Patient 3D Anatomy</span>
                      </button>
                      <button
                        onClick={() => setAnatomyViewMode("split")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          anatomyViewMode === "split"
                            ? "bg-clinical text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Synchronized Split View: Patient 3D Anatomy + Layer Controls"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span>Split View</span>
                      </button>
                      <button
                        onClick={() => setAnatomyViewMode("layers")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          anatomyViewMode === "layers"
                            ? "bg-clinical text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Quantitative Metrics and Layers Table"
                      >
                        <Activity className="h-3.5 w-3.5" />
                        <span>Layers & Metrics</span>
                      </button>
                    </div>

                    <Button size="sm" variant={segStatus === "completed" ? "outline" : "primary"} onClick={handleRunSegmentation} disabled={segStatus === "running"}>
                      {segStatus === "running" ? "Reconstructing..." : segStatus === "completed" ? "Re-run Analysis" : "Run 3D AI"}
                    </Button>
                  </div>
                </div>

                {/* Progress bar */}
                {segStatus === "running" && (
                  <div className="rounded-lg border border-clinical/30 bg-clinical/10 px-4 py-3 text-sm text-clinical-strong">
                    <div className="flex justify-between font-mono text-[11px] mb-2">
                      <span>{segStage}</span>
                      <span>{segProgress}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-panel">
                      <div className="h-full bg-clinical transition-all duration-300" style={{ width: `${segProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* ── 3D Anatomy Main Content based on View Mode ── */}
                {anatomyViewMode === "3d" && (
                  <div className="flex flex-col gap-3">
                    <RealStudy3DViewer
                      studyId={studyId}
                      organMeshes={organMeshes}
                      onOrganMeshesChange={onOrganMeshesChange}
                      onSelectOrgan={onSelectOrgan}
                      height="640px"
                    />
                  </div>
                )}

                {anatomyViewMode === "split" && (
                  <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
                    {/* Left: 3D Real Model Canvas */}
                    <div className="flex flex-col gap-3">
                      <RealStudy3DViewer
                        studyId={studyId}
                        organMeshes={organMeshes}
                        onOrganMeshesChange={onOrganMeshesChange}
                        onSelectOrgan={onSelectOrgan}
                        height="540px"
                      />
                    </div>

                    {/* Right: Volumetric Metrics & Anatomical Layer Controls */}
                    <div className="flex flex-col gap-3">
                      {metrics && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {metrics.heart && (
                            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                              <div className="flex items-center justify-between text-rose-400 font-semibold mb-1.5">
                                <span className="flex items-center gap-1.5 text-xs"><Heart className="h-3.5 w-3.5" /> Cardiac Silhouette</span>
                                <span className="font-mono text-xs">{metrics.heart.cardiacIndex || "CTR 0.65"}</span>
                              </div>
                              <div className="space-y-1 text-[11px] font-mono text-ink-secondary">
                                <div className="flex justify-between"><span>Total Vol:</span><span className="text-ink-primary font-bold">{metrics.heart.totalHeartVolumeMl} mL</span></div>
                                <div className="flex justify-between"><span>Left Ventricle:</span><span>{metrics.heart.leftVentricleVolumeMl} mL</span></div>
                                <div className="flex justify-between"><span>Aorta:</span><span>{metrics.heart.aortaVolumeMl} mL</span></div>
                              </div>
                            </div>
                          )}
                          {metrics.lungs && (
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                              <div className="flex items-center justify-between text-cyan-400 font-semibold mb-1.5">
                                <span className="flex items-center gap-1.5 text-xs"><Wind className="h-3.5 w-3.5" /> Pulmonary Vol</span>
                                <span className="font-mono text-xs">TLC {metrics.lungs.totalLungCapacityMl} mL</span>
                              </div>
                              <div className="space-y-1 text-[11px] font-mono text-ink-secondary">
                                <div className="flex justify-between"><span>Right Lung:</span><span className="text-ink-primary">{metrics.lungs.rightLungVolumeMl} mL</span></div>
                                <div className="flex justify-between"><span>Left Lung:</span><span>{metrics.lungs.leftLungVolumeMl} mL</span></div>
                                <div className="flex justify-between"><span>Emphysema %:</span><span className="text-amber-400 font-bold">{metrics.lungs.emphysemaIndexPercentage}%</span></div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Organ Layers List */}
                      <div className="rounded-lg border border-border bg-panel flex-1 flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-panel-alt/40">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
                            Anatomical Layers ({filteredOrgans.length})
                          </span>
                          <div className="flex items-center gap-1">
                            {["all", "cardiac", "pulmonary", "abdominal", "bone"].map((cat) => (
                              <button key={cat} onClick={() => setAnatomyFilter(cat)}
                                className={cn("px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono transition-colors",
                                  anatomyFilter === cat ? "bg-clinical text-white font-bold" : "text-ink-muted hover:text-ink-primary hover:bg-panel-alt"
                                )}>{cat}</button>
                            ))}
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
                          {filteredOrgans.length === 0 ? (
                            <p className="p-4 text-xs text-ink-muted text-center">No organ layers available.</p>
                          ) : filteredOrgans.map((organ) => (
                            <div key={organ.id} className={cn("flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-panel-alt/50", !organ.visible && "opacity-50")}>
                              <div className="flex items-center gap-2 cursor-pointer" onClick={() => onSelectOrgan?.(organ.id)}>
                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: organ.color }} />
                                <div>
                                  <span className="font-medium text-ink-primary block leading-tight">{organ.name}</span>
                                  {organ.volumeMl !== undefined && (
                                    <span className="block font-mono text-[9.5px] text-ink-muted">{organ.volumeMl} mL · {organ.maxDiameterMm} mm</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <input type="range" min={0.1} max={1.0} step={0.05} value={organ.opacity}
                                  onChange={(e) => updateOrganOpacity(organ.id, parseFloat(e.target.value))}
                                  className="h-1 w-14 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
                                  title={`Opacity: ${Math.round(organ.opacity * 100)}%`}
                                />
                                <button onClick={() => isolateOrgan(organ.id)}
                                  className={cn("px-1 py-0.5 rounded text-[8.5px] font-mono border",
                                    organ.isolated ? "bg-clinical text-white border-clinical" : "border-border text-ink-muted hover:text-ink-primary"
                                  )} title="Isolate this organ">SOLO</button>
                                <button onClick={() => toggleOrganVisibility(organ.id)} className="p-1 text-ink-secondary hover:text-ink-primary">
                                  {organ.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-ink-muted" />}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {anatomyViewMode === "layers" && (
                  <div className="flex flex-col gap-4">
                    {metrics && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {metrics.heart && (
                          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                            <div className="flex items-center justify-between text-rose-400 font-semibold mb-3">
                              <span className="flex items-center gap-1.5 text-sm"><Heart className="h-4 w-4" /> Cardiac Silhouette</span>
                              <span className="font-mono text-xs">{metrics.heart.cardiacIndex || "CTR 0.65"}</span>
                            </div>
                            <div className="space-y-1.5 text-xs font-mono text-ink-secondary">
                              <div className="flex justify-between"><span>Total Volume:</span><span className="text-ink-primary font-bold">{metrics.heart.totalHeartVolumeMl} mL</span></div>
                              <div className="flex justify-between"><span>Left Ventricle:</span><span>{metrics.heart.leftVentricleVolumeMl} mL</span></div>
                              <div className="flex justify-between"><span>Aorta Volume:</span><span>{metrics.heart.aortaVolumeMl} mL</span></div>
                            </div>
                          </div>
                        )}
                        {metrics.lungs && (
                          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
                            <div className="flex items-center justify-between text-cyan-400 font-semibold mb-3">
                              <span className="flex items-center gap-1.5 text-sm"><Wind className="h-4 w-4" /> Pulmonary Volumes</span>
                              <span className="font-mono text-xs">TLC {metrics.lungs.totalLungCapacityMl} mL</span>
                            </div>
                            <div className="space-y-1.5 text-xs font-mono text-ink-secondary">
                              <div className="flex justify-between"><span>Right Lung:</span><span className="text-ink-primary">{metrics.lungs.rightLungVolumeMl} mL</span></div>
                              <div className="flex justify-between"><span>Left Lung:</span><span>{metrics.lungs.leftLungVolumeMl} mL</span></div>
                              <div className="flex justify-between"><span>Emphysema %:</span><span className="text-amber-400 font-bold">{metrics.lungs.emphysemaIndexPercentage}%</span></div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-border bg-panel">
                      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                        <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">Anatomical Layers ({filteredOrgans.length})</span>
                        <div className="flex items-center gap-1">
                          {["all", "cardiac", "pulmonary", "abdominal", "bone"].map((cat) => (
                            <button key={cat} onClick={() => setAnatomyFilter(cat)}
                              className={cn("px-2 py-0.5 rounded text-[10px] uppercase font-mono transition-colors",
                                anatomyFilter === cat ? "bg-clinical text-white font-bold" : "text-ink-muted hover:text-ink-primary hover:bg-panel-alt"
                              )}>{cat}</button>
                          ))}
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-border/50">
                        {filteredOrgans.map((organ) => (
                          <div key={organ.id} className={cn("flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-panel-alt/50", !organ.visible && "opacity-50")}>
                            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onSelectOrgan?.(organ.id)}>
                              <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: organ.color }} />
                              <div>
                                <span className="text-sm font-medium text-ink-primary">{organ.name}</span>
                                {organ.volumeMl !== undefined && (
                                  <span className="block font-mono text-[10px] text-ink-muted">{organ.volumeMl} mL · {organ.maxDiameterMm} mm</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="range" min={0.1} max={1.0} step={0.05} value={organ.opacity}
                                onChange={(e) => updateOrganOpacity(organ.id, parseFloat(e.target.value))}
                                className="h-1 w-16 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
                                title={`Opacity: ${Math.round(organ.opacity * 100)}%`}
                              />
                              <button onClick={() => isolateOrgan(organ.id)}
                                className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono border",
                                  organ.isolated ? "bg-clinical text-white border-clinical" : "border-border text-ink-muted hover:text-ink-primary hover:border-clinical/50"
                                )}>{organ.isolated ? "SOLO" : "SOLO"}</button>
                              <button onClick={() => toggleOrganVisibility(organ.id)} className="p-1 text-ink-secondary hover:text-ink-primary">
                                {organ.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-ink-muted" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ─── 4D MOTION ─── */}
            {activeTab === "motion" && (
              <>
                {/* Header & View Mode Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-panel px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink-primary">4D Dynamic Cardiac Motion Analysis</span>
                      {motionMeta && (
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[10px] font-mono uppercase font-bold border",
                            motionMeta.isSimulated
                              ? "border-purple-500/30 bg-purple-500/10 text-purple-300"
                              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          )}
                        >
                          {motionMeta.isSimulated ? "Simulated 4D Cine" : "Acquired 4D"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">
                      MONAI Physio / PhysicsNeMo Dynamic Biomechanical Motion &amp; Wall Strain
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* View Mode Toggle: 4D Temporal Cine | Split View | Metrics Only */}
                    <div className="flex items-center rounded-lg bg-panel-alt p-1 border border-border">
                      <button
                        onClick={() => setMotionViewMode("4d")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          motionViewMode === "4d"
                            ? "bg-rose-600 text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Full 4D Temporal Cine Viewport"
                      >
                        <Heart className="h-3.5 w-3.5" />
                        <span>4D Temporal Cine</span>
                      </button>
                      <button
                        onClick={() => setMotionViewMode("split")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          motionViewMode === "split"
                            ? "bg-rose-600 text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Synchronized View: 4D Heart Model + Hemodynamic Metrics"
                      >
                        <Activity className="h-3.5 w-3.5" />
                        <span>Split View</span>
                      </button>
                      <button
                        onClick={() => setMotionViewMode("metrics")}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors",
                          motionViewMode === "metrics"
                            ? "bg-rose-600 text-white shadow-sm font-semibold"
                            : "text-ink-secondary hover:text-ink-primary"
                        )}
                        title="Hemodynamic Metric Cards Only"
                      >
                        <Sliders className="h-3.5 w-3.5" />
                        <span>Metrics Only</span>
                      </button>
                    </div>

                    {motionMeta && (
                      <div className="inline-flex items-center gap-1.5 rounded bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span>Acquired 4D Cine ({motionMeta.phaseCount} phases)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4D Disclaimer / Status Banner */}
                {motionMeta && !motionMeta.isSimulated ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs flex items-center justify-between text-emerald-300">
                    <div className="flex items-center gap-2">
                      <Heart className="h-4 w-4 shrink-0 text-rose-400" />
                      <span>{motionMeta.disclaimer || "Acquired multi-phase physiological motion."}</span>
                    </div>
                    <span className="font-mono text-[11px] rounded bg-panel/60 px-2 py-0.5 shrink-0">
                      {motionMeta.phaseCount} Acquired Phases
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-panel p-6 text-center">
                    <Activity className="h-8 w-8 text-slate-500/40 mx-auto mb-2" />
                    <h4 className="text-sm font-semibold text-slate-200 mb-1">4D unavailable — study contains no temporal acquisition</h4>
                    <p className="text-xs text-slate-400 max-w-lg mx-auto mb-3">
                      This series is a static volumetric scan. 4D dynamic cine playback and calculated hemodynamics (LVEF, EDV, ESV) are enabled strictly when authentic ECG-gated multi-phase clinical acquisition frames exist.
                    </p>
                    <div className="inline-flex items-center gap-1.5 rounded bg-slate-900/80 border border-slate-700/60 px-3 py-1 text-[11px] font-mono text-slate-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                      <span>Temporal Acquisition: Not Present</span>
                    </div>
                  </div>
                )}

                {/* ── 4D Dynamic Motion Display based on View Mode ── */}
                {motionViewMode === "4d" && (
                  <div className="flex flex-col gap-3">
                    <RealStudy4DViewer
                      studyId={studyId}
                      activePhase={activePhase}
                      totalPhases={motionMeta?.phaseCount || 8}
                      isPlaying={isPlayingMotion}
                      fps={motionFps}
                      onPhaseChange={(p) => {
                        setIsPlayingMotion(false);
                        setActivePhase(p);
                      }}
                      onTogglePlay={() => setIsPlayingMotion(!isPlayingMotion)}
                      cardiacMetrics={motionMeta?.cardiacMetrics}
                      isSimulated={motionMeta?.isSimulated ?? true}
                      height="640px"
                    />
                  </div>
                )}

                {motionViewMode === "split" && (
                  <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
                    {/* Left: 4D Dynamic Beating Heart Model Canvas */}
                    <RealStudy4DViewer
                      studyId={studyId}
                      activePhase={activePhase}
                      totalPhases={motionMeta?.phaseCount || 8}
                      isPlaying={isPlayingMotion}
                      fps={motionFps}
                      onPhaseChange={(p) => {
                        setIsPlayingMotion(false);
                        setActivePhase(p);
                      }}
                      onTogglePlay={() => setIsPlayingMotion(!isPlayingMotion)}
                      cardiacMetrics={motionMeta?.cardiacMetrics}
                      isSimulated={motionMeta?.isSimulated ?? true}
                      height="540px"
                    />

                    {/* Right: Cine Controls & Quantitative Hemodynamic Cards */}
                    <div className="flex flex-col gap-3">
                      {/* Playback Controls Box */}
                      <div className="rounded-lg border border-border-strong bg-panel p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setIsPlayingMotion(!isPlayingMotion)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-600 text-white shadow hover:bg-rose-500 transition-colors"
                              title={isPlayingMotion ? "Pause 4D Cine" : "Play 4D Cine"}
                            >
                              {isPlayingMotion ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                            </button>
                            <div>
                              <span className="text-sm font-semibold font-mono text-ink-primary">
                                Phase {activePhase + 1} / {motionMeta?.phaseCount || 8}
                              </span>
                              <span className="block text-[10px] text-ink-muted">
                                {activePhase === 0
                                  ? "End-Diastole (Max Filling)"
                                  : activePhase === 3 || activePhase === 4
                                  ? "Peak Systole (Max Ejection)"
                                  : "Ventricular Cycle"}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono text-ink-muted">
                            <span>{motionFps} FPS</span>
                            <input
                              type="range"
                              min={2}
                              max={12}
                              step={1}
                              value={motionFps}
                              onChange={(e) => setMotionFps(parseInt(e.target.value))}
                              className="h-1 w-20 accent-rose-500"
                            />
                          </div>
                        </div>

                        <input
                          type="range"
                          min={0}
                          max={(motionMeta?.phaseCount || 8) - 1}
                          value={activePhase}
                          onChange={(e) => {
                            setIsPlayingMotion(false);
                            setActivePhase(parseInt(e.target.value));
                          }}
                          className="w-full h-2 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-rose-500"
                        />
                      </div>

                      {/* Hemodynamic Metrics Cards */}
                      {motionMeta?.cardiacMetrics && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg bg-panel-alt p-3 border border-border">
                            <span className="text-[10px] text-ink-muted block uppercase font-medium">LVEF (Ejection Fraction)</span>
                            <span className="text-xl font-bold font-mono text-ink-primary">
                              {motionMeta.cardiacMetrics.LVEF?.value}%
                            </span>
                            <span className="text-[10px] block text-amber-400 mt-0.5">
                              {motionMeta.cardiacMetrics.LVEF?.status}
                            </span>
                          </div>
                          <div className="rounded-lg bg-panel-alt p-3 border border-border">
                            <span className="text-[10px] text-ink-muted block uppercase font-medium">Stroke Volume</span>
                            <span className="text-xl font-bold font-mono text-ink-primary">
                              {motionMeta.cardiacMetrics.strokeVolume?.value} mL
                            </span>
                          </div>
                          <div className="rounded-lg bg-panel-alt p-3 border border-border">
                            <span className="text-[10px] text-ink-muted block uppercase font-medium">EDV (End-Diastole)</span>
                            <span className="text-xl font-bold font-mono text-ink-primary">
                              {motionMeta.cardiacMetrics.EDV?.value} mL
                            </span>
                          </div>
                          <div className="rounded-lg bg-panel-alt p-3 border border-border">
                            <span className="text-[10px] text-ink-muted block uppercase font-medium">ESV (End-Systole)</span>
                            <span className="text-xl font-bold font-mono text-ink-primary">
                              {motionMeta.cardiacMetrics.ESV?.value} mL
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {motionViewMode === "metrics" && (
                  <div className="rounded-lg border border-border-strong bg-panel p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setIsPlayingMotion(!isPlayingMotion)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-clinical text-white shadow hover:bg-clinical-strong"
                        >
                          {isPlayingMotion ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                        </button>
                        <span className="text-sm font-semibold font-mono">
                          Phase {activePhase + 1} / {motionMeta?.phaseCount || 8}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono text-ink-muted">
                        <span>{motionFps} FPS</span>
                        <input
                          type="range"
                          min={2}
                          max={12}
                          step={1}
                          value={motionFps}
                          onChange={(e) => setMotionFps(parseInt(e.target.value))}
                          className="h-1 w-20 accent-clinical"
                        />
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={(motionMeta?.phaseCount || 8) - 1}
                      value={activePhase}
                      onChange={(e) => {
                        setIsPlayingMotion(false);
                        setActivePhase(parseInt(e.target.value));
                      }}
                      className="w-full h-2 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
                    />
                    {motionMeta?.cardiacMetrics && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border">
                        <div className="rounded-lg bg-panel-alt p-3">
                          <span className="text-[10px] text-ink-muted block">LVEF (Ejection Fraction)</span>
                          <span className="text-xl font-bold font-mono text-ink-primary">
                            {motionMeta.cardiacMetrics.LVEF?.value}%
                          </span>
                          <span className="text-[10px] block text-amber-400 mt-0.5">
                            {motionMeta.cardiacMetrics.LVEF?.status}
                          </span>
                        </div>
                        <div className="rounded-lg bg-panel-alt p-3">
                          <span className="text-[10px] text-ink-muted block">Stroke Volume</span>
                          <span className="text-xl font-bold font-mono text-ink-primary">
                            {motionMeta.cardiacMetrics.strokeVolume?.value} mL
                          </span>
                        </div>
                        <div className="rounded-lg bg-panel-alt p-3">
                          <span className="text-[10px] text-ink-muted block">EDV</span>
                          <span className="text-xl font-bold font-mono text-ink-primary">
                            {motionMeta.cardiacMetrics.EDV?.value} mL
                          </span>
                        </div>
                        <div className="rounded-lg bg-panel-alt p-3">
                          <span className="text-[10px] text-ink-muted block">ESV</span>
                          <span className="text-xl font-bold font-mono text-ink-primary">
                            {motionMeta.cardiacMetrics.ESV?.value} mL
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ─── FINDINGS ─── */}
            {activeTab === "findings" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {["all", "pending", "accepted", "edited", "rejected"].map((flt) => (
                      <button key={flt} onClick={() => setFindingFilter(flt)}
                        className={cn("px-2.5 py-1 rounded text-[11px] font-mono uppercase transition-colors",
                          findingFilter === flt ? "bg-clinical text-white font-bold" : "text-ink-muted hover:text-ink-primary hover:bg-panel-alt"
                        )}>{flt}</button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setAddFindingOpen(true)} className="gap-1">
                    <Plus className="h-3.5 w-3.5" /> Add Observation
                  </Button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filteredFindings.length === 0 ? (
                    <div className="col-span-full rounded-lg border border-border bg-panel p-8 text-center">
                      <Sparkles className="h-10 w-10 text-ink-muted/30 mx-auto mb-2" />
                      <p className="text-sm text-ink-muted">No findings match this filter.</p>
                    </div>
                  ) : (
                    filteredFindings.map((f) => (
                      <div key={f.findingId} className={cn(
                        "rounded-lg border p-4 text-sm transition-colors",
                        f.reviewStatus === "ACCEPTED" ? "border-emerald-500/30 bg-emerald-500/5"
                          : f.reviewStatus === "REJECTED" ? "border-rose-500/30 bg-rose-500/5 opacity-60"
                          : f.reviewStatus === "EDITED" ? "border-cyan-500/30 bg-cyan-500/5"
                          : "border-border-strong bg-panel"
                      )}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <span className="font-semibold text-ink-primary block">{f.anatomy}</span>
                            <span className="text-xs text-ink-muted">{f.findingType}</span>
                          </div>
                          <span className={cn("rounded px-2 py-0.5 text-[10px] font-mono uppercase font-bold shrink-0",
                            f.reviewStatus === "ACCEPTED" ? "bg-emerald-500/20 text-emerald-400"
                              : f.reviewStatus === "REJECTED" ? "bg-rose-500/20 text-rose-400"
                              : f.reviewStatus === "EDITED" ? "bg-cyan-500/20 text-cyan-400"
                              : "bg-amber-500/20 text-amber-300"
                          )}>{f.reviewStatus}</span>
                        </div>
                        <p className="text-xs text-ink-secondary leading-relaxed">{f.description}</p>
                        {f.radiologistComments && (
                          <div className="mt-2 rounded bg-panel-alt p-2 text-[11px] text-ink-primary border border-border">
                            <span className="font-semibold text-clinical block">Radiologist Note:</span>{f.radiologistComments}
                          </div>
                        )}
                        {editingFindingId === f.findingId && (
                          <div className="mt-2 space-y-2">
                            <textarea value={editComment} onChange={(e) => setEditComment(e.target.value)}
                              placeholder="Add radiologist clarification..."
                              className="w-full h-16 rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical"
                            />
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" onClick={() => setEditingFindingId(null)} className="h-7 text-xs">Cancel</Button>
                              <Button size="sm" variant="primary" onClick={() => handleReviewFinding(f.findingId, "EDITED", editComment)} className="h-7 text-xs">Save & Edit</Button>
                            </div>
                          </div>
                        )}
                        {editingFindingId !== f.findingId && (
                          <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/50">
                            <button onClick={() => handleAddFindingToReport(f)} className="flex items-center gap-1 text-[11px] text-clinical hover:underline font-medium">
                              <FileCheck className="h-3.5 w-3.5" /> Append to Report
                            </button>
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setEditingFindingId(f.findingId); setEditComment(f.radiologistComments || ""); }}
                                className="p-1.5 rounded text-ink-muted hover:text-ink-primary hover:bg-panel-alt" title="Edit with comments"><Edit2 className="h-3.5 w-3.5" /></button>
                              <button onClick={() => handleReviewFinding(f.findingId, "ACCEPTED")}
                                className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10" title="Accept finding"><Check className="h-4 w-4" /></button>
                              <button onClick={() => handleReviewFinding(f.findingId, "REJECTED")}
                                className="p-1.5 rounded text-rose-400 hover:bg-rose-500/10" title="Reject finding"><X className="h-4 w-4" /></button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* ─── REPORT ─── */}
            {activeTab === "report" && (
              <>
                {draft ? (
                  <div className="space-y-4">
                    <div className={cn("rounded-lg border p-4 flex items-center justify-between",
                      draft.status === "APPROVED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    )}>
                      <div>
                        <span className="font-semibold block text-sm">{draft.status === "APPROVED" ? "Official Signed Clinical Report" : "Draft Study Report (AI-Assisted)"}</span>
                        <span className="text-xs opacity-80">{draft.status === "APPROVED" ? `Signed by ${draft.approval?.radiologistName} (${draft.approval?.licenseNumber})` : "Pending final review and electronic signature"}</span>
                      </div>
                      {draft.status === "APPROVED" ? (
                        <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => setSignModalOpen(true)}>Sign & Finalize</Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {[{ title: "Clinical Information", content: draft?.sections?.clinicalInformation },
                        { title: "Technique", content: draft?.sections?.technique },
                      ].map(({ title, content }) => (
                        <div key={title} className="rounded-lg bg-panel-alt/60 p-4 border border-border">
                          <span className="text-[10px] font-semibold text-ink-muted uppercase">{title}</span>
                          <p className="mt-1 text-sm text-ink-primary whitespace-pre-line">{content || "Pending..."}</p>
                        </div>
                      ))}
                      <div className="rounded-lg bg-panel-alt/60 p-4 border border-border lg:col-span-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold text-ink-muted uppercase">Findings</span>
                          <button onClick={handleCompileDraft} disabled={isCompilingDraft} className="text-[11px] text-clinical hover:underline flex items-center gap-1">
                            <RefreshCw className={cn("h-3 w-3", isCompilingDraft && "animate-spin")} /> Recompile
                          </button>
                        </div>
                        <p className="text-sm text-ink-primary whitespace-pre-line leading-relaxed">{draft?.sections?.findings || "No findings recorded yet"}</p>
                      </div>
                      <div className="rounded-lg bg-panel-alt/60 p-4 border border-border lg:col-span-2">
                        <span className="text-[10px] font-semibold text-ink-muted uppercase">Impression</span>
                        <p className="mt-1 text-sm text-ink-primary font-medium">{draft?.sections?.impression || "Pending radiologist review"}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {onOpenReportTab && (
                        <button onClick={onOpenReportTab} className="text-sm text-clinical hover:underline font-medium flex items-center gap-1">
                          Open Full Radiology Report Workspace <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {draft.status === "APPROVED" && (
                        <a href={`/api/studies/${studyId}/derived/report/report.pdf`} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-sm text-emerald-400 hover:underline font-mono">
                          <Download className="h-4 w-4" /> PDF Export
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-panel p-10 text-center">
                    <FileText className="h-12 w-12 text-ink-muted/30 mx-auto mb-3" />
                    <p className="text-sm text-ink-muted mb-4">No report draft compiled yet. Run AI analysis first, then compile.</p>
                    <Button size="sm" variant="primary" onClick={handleCompileDraft} disabled={isCompilingDraft}>
                      {isCompilingDraft ? "Compiling Report..." : "Compile Initial Report Draft"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Shared Modals (always rendered so state is maintained) ── */}
        <Modal open={addFindingOpen} onClose={() => setAddFindingOpen(false)} title="Add Clinical Observation">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-ink-secondary block mb-1">Target Anatomy / Organ</label>
              <input type="text" value={manualAnatomy} onChange={(e) => setManualAnatomy(e.target.value)}
                placeholder="e.g. Left Ventricle, Thoracic Aorta, Pleura..."
                className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-secondary block mb-1">Observation Description</label>
              <textarea value={manualDesc} onChange={(e) => setManualDesc(e.target.value)}
                placeholder="Clinical observation, caliber measurement, or morphological note..."
                className="w-full h-24 rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setAddFindingOpen(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleAddManualFinding}>Save Observation</Button>
            </div>
          </div>
        </Modal>

        <Modal open={signModalOpen} onClose={() => setSignModalOpen(false)} title="Electronically Approve Study Report">
          <div className="space-y-3 text-xs text-ink-secondary">
            <p>By signing, you confirm that you have reviewed the AI-generated findings, volumetric segmentations, and hemodynamic metrics for this patient study.</p>
            <div>
              <label className="text-xs font-medium text-ink-primary block mb-1">Radiologist Name</label>
              <input type="text" value={radiologistName} onChange={(e) => setRadiologistName(e.target.value)}
                className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-primary block mb-1">License / NPI Number</label>
              <input type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)}
                className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical" />
            </div>
            <div className="rounded bg-panel p-2 border border-border text-[10px] text-ink-muted">
              <Lock className="h-3 w-3 inline mr-1 text-clinical" />
              A cryptographic SHA-256 signature hash will be permanently attached and archived.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setSignModalOpen(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleApproveReport} disabled={isSigning}>
                {isSigning ? "Signing..." : "Sign & Finalize Report"}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // ============================================================
  // COMPACT SIDEBAR RENDER (fullscreen=false, original layout)
  // ============================================================
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border-strong bg-panel/95 p-3.5 backdrop-blur-md shadow-xl text-ink-primary", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-strong pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-clinical/15 text-clinical">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-primary">MONAI Physio AI Workstation</h3>
            <p className="text-[10px] text-ink-muted">Clinical 3D Anatomy · 4D Motion · Findings Review · Reporting</p>
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

      {/* Primary Sub-Tabs Navigation */}
      <div className="flex items-center gap-1 rounded-md bg-panel-alt p-1 border border-border">
        <button
          onClick={() => setActiveTab("anatomy")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1 px-2 rounded text-[11px] font-medium transition-colors",
            activeTab === "anatomy"
              ? "bg-clinical text-white shadow-sm font-semibold"
              : "text-ink-secondary hover:text-ink-primary hover:bg-panel"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>3D Anatomy</span>
        </button>

        <button
          onClick={() => setActiveTab("motion")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1 px-2 rounded text-[11px] font-medium transition-colors",
            activeTab === "motion"
              ? "bg-clinical text-white shadow-sm font-semibold"
              : "text-ink-secondary hover:text-ink-primary hover:bg-panel"
          )}
        >
          <Heart className="h-3.5 w-3.5" />
          <span>4D Motion</span>
          {motionMeta && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("findings")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1 px-2 rounded text-[11px] font-medium transition-colors",
            activeTab === "findings"
              ? "bg-clinical text-white shadow-sm font-semibold"
              : "text-ink-secondary hover:text-ink-primary hover:bg-panel"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Findings</span>
          {findings.length > 0 && (
            <span className="rounded bg-panel px-1 py-0.2 font-mono text-[9px] text-ink-primary">
              {findings.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("report")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 py-1 px-2 rounded text-[11px] font-medium transition-colors",
            activeTab === "report"
              ? "bg-clinical text-white shadow-sm font-semibold"
              : "text-ink-secondary hover:text-ink-primary hover:bg-panel"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Report</span>
          {draft?.status === "APPROVED" && (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: 3D ANATOMY */}
      {/* ========================================================================= */}
      {activeTab === "anatomy" && (
        <div className="flex flex-col gap-3">
          {/* Quick Action & Status Bar */}
          <div className="flex items-center justify-between rounded-md border border-border bg-panel-alt/50 px-2.5 py-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-primary">Volumetric Reconstruction</span>
                {segStatus === "completed" && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-mono text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Ready
                  </span>
                )}
              </div>
              <p className="text-[10px] text-ink-muted">TotalSegmentator-v2 + MONAI Physio Organ Models</p>
            </div>
            <Button
              size="sm"
              variant={segStatus === "completed" ? "outline" : "primary"}
              onClick={handleRunSegmentation}
              disabled={segStatus === "running"}
              className="h-7 text-xs px-2.5"
            >
              {segStatus === "running" ? "Reconstructing..." : segStatus === "completed" ? "Re-run" : "Run 3D AI"}
            </Button>
          </div>

          {/* Quick Launch Patient 3D Anatomy Modal */}
          <button
            onClick={() => setModal3DOpen(true)}
            className="flex items-center justify-between rounded-lg border border-clinical/30 bg-clinical/10 px-3 py-2 text-xs font-semibold text-clinical hover:bg-clinical/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4" />
              <span>Patient 3D Anatomy Viewport</span>
            </div>
            <span className="text-[10px] font-mono opacity-80">Launch 3D View →</span>
          </button>

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

          {/* Specialized Quantitative Cards */}
          {metrics && (
            <div className="grid grid-cols-2 gap-2">
              {/* Cardiac Metrics */}
              {metrics.heart && (
                <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2 text-xs">
                  <div className="flex items-center justify-between text-rose-400 font-semibold mb-1">
                    <span className="flex items-center gap-1 text-[11px]"><Heart className="h-3 w-3" /> Cardiac Silhouette</span>
                    <span className="font-mono text-[10px]">{metrics.heart.cardiacIndex || "CTR 0.65"}</span>
                  </div>
                  <div className="space-y-0.5 text-[10px] font-mono text-ink-secondary">
                    <div className="flex justify-between"><span>Total Volume:</span><span className="text-ink-primary font-bold">{metrics.heart.totalHeartVolumeMl} mL</span></div>
                    <div className="flex justify-between"><span>Left Ventricle:</span><span>{metrics.heart.leftVentricleVolumeMl} mL</span></div>
                    <div className="flex justify-between"><span>Aorta Volume:</span><span>{metrics.heart.aortaVolumeMl} mL</span></div>
                  </div>
                </div>
              )}

              {/* Pulmonary Metrics */}
              {metrics.lungs && (
                <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2 text-xs">
                  <div className="flex items-center justify-between text-cyan-400 font-semibold mb-1">
                    <span className="flex items-center gap-1 text-[11px]"><Wind className="h-3 w-3" /> Pulmonary Volumes</span>
                    <span className="font-mono text-[10px]">TLC {metrics.lungs.totalLungCapacityMl} mL</span>
                  </div>
                  <div className="space-y-0.5 text-[10px] font-mono text-ink-secondary">
                    <div className="flex justify-between"><span>Right Lung:</span><span className="text-ink-primary">{metrics.lungs.rightLungVolumeMl} mL</span></div>
                    <div className="flex justify-between"><span>Left Lung:</span><span>{metrics.lungs.leftLungVolumeMl} mL</span></div>
                    <div className="flex justify-between"><span>Emphysema %:</span><span className="text-amber-400 font-bold">{metrics.lungs.emphysemaIndexPercentage}%</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Organ Systems Filter */}
          <div className="flex items-center justify-between border-t border-border-strong pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
              Anatomical Layers ({filteredOrgans.length})
            </span>
            <div className="flex items-center gap-1">
              {["all", "cardiac", "pulmonary", "abdominal", "bone"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setAnatomyFilter(cat)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono transition-colors",
                    anatomyFilter === cat
                      ? "bg-clinical text-white font-bold"
                      : "text-ink-muted hover:text-ink-primary hover:bg-panel-alt"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Organ Mesh List */}
          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
            {filteredOrgans.map((organ) => (
              <div
                key={organ.id}
                className={cn(
                  "flex items-center justify-between rounded border px-2 py-1 text-xs transition-colors",
                  organ.visible ? "border-border-strong bg-panel-alt/60" : "border-transparent bg-panel-alt/20 opacity-60"
                )}
              >
                <div
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => onSelectOrgan?.(organ.id)}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: organ.color }}
                  />
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-ink-primary leading-tight">{organ.name}</span>
                    {organ.volumeMl !== undefined && (
                      <span className="font-mono text-[9px] text-ink-muted">
                        {organ.volumeMl} mL · {organ.maxDiameterMm} mm
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={organ.opacity}
                    onChange={(e) => updateOrganOpacity(organ.id, parseFloat(e.target.value))}
                    className="h-1 w-10 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
                    title={`Opacity: ${Math.round(organ.opacity * 100)}%`}
                  />

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

      {/* ========================================================================= */}
      {/* TAB 2: 4D MOTION */}
      {/* ========================================================================= */}
      {activeTab === "motion" && (
        <div className="flex flex-col gap-3">
          {/* Provenance Banner (Strict Clinical Safety requirement: Section 11 & 12) */}
          {motionMeta ? (
            <div
              className={cn(
                "rounded-md border p-2.5 text-xs",
                motionMeta.isSimulated
                  ? "border-purple-500/30 bg-purple-500/10 text-purple-200"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              )}
            >
              <div className="flex items-center justify-between font-semibold mb-1">
                <span className="flex items-center gap-1.5">
                  <Heart className="h-3.5 w-3.5" />
                  {motionMeta.motionType}
                </span>
                <span className="font-mono text-[10px] rounded px-1.5 py-0.5 bg-panel/60">
                  {motionMeta.phaseCount} Phases
                </span>
              </div>
              <p className="text-[10px] opacity-90 leading-relaxed">{motionMeta.disclaimer}</p>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-panel-alt/50 p-3 text-center">
              <p className="text-xs text-ink-muted mb-2">No 4D motion cine has been synthesized or scanned yet.</p>
              <Button size="sm" variant="primary" onClick={handleRunMotion} disabled={motionStatus === "running"}>
                {motionStatus === "running" ? "Synthesizing 4D..." : "Generate 4D Motion"}
              </Button>
            </div>
          )}

          {/* Quick Launch Real 4D Model Modal */}
          {motionMeta && (
            <button
              onClick={() => setModal4DOpen(true)}
              className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Heart className="h-4 w-4 animate-pulse" />
                <span>Interactive 4D Dynamic Heart Model</span>
              </div>
              <span className="text-[10px] font-mono opacity-80">Launch 4D View →</span>
            </button>
          )}

          {/* 4D Cine Scrubber Controls */}
          {motionMeta && (
            <div className="rounded-md border border-border-strong bg-panel-alt/70 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsPlayingMotion(!isPlayingMotion)}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-clinical text-white shadow hover:bg-clinical-strong"
                  >
                    {isPlayingMotion ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
                  </button>
                  <span className="text-xs font-semibold text-ink-primary font-mono">
                    Phase {activePhase + 1} / {motionMeta.phaseCount}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-muted">
                  <span>{motionFps} FPS</span>
                  <input
                    type="range"
                    min={2}
                    max={12}
                    step={1}
                    value={motionFps}
                    onChange={(e) => setMotionFps(parseInt(e.target.value))}
                    className="h-1 w-14 accent-clinical"
                  />
                </div>
              </div>

              {/* Slider Scrubber */}
              <input
                type="range"
                min={0}
                max={motionMeta.phaseCount - 1}
                value={activePhase}
                onChange={(e) => {
                  setIsPlayingMotion(false);
                  setActivePhase(parseInt(e.target.value));
                }}
                className="w-full h-1.5 cursor-pointer appearance-none rounded bg-[rgb(var(--overlay-hover)/0.2)] accent-clinical"
              />

              {/* Hemodynamic Functional Metrics */}
              {motionMeta.cardiacMetrics && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                  <div className="rounded bg-panel p-2">
                    <span className="text-[10px] text-ink-muted block">LVEF (Ejection Fraction)</span>
                    <span className="text-sm font-bold font-mono text-ink-primary">
                      {motionMeta.cardiacMetrics.LVEF?.value}%
                    </span>
                    <span className="text-[9px] block text-amber-400 mt-0.5">
                      {motionMeta.cardiacMetrics.LVEF?.status}
                    </span>
                  </div>
                  <div className="rounded bg-panel p-2">
                    <span className="text-[10px] text-ink-muted block">Stroke Volume / EDV</span>
                    <span className="text-sm font-bold font-mono text-ink-primary">
                      {motionMeta.cardiacMetrics.strokeVolume?.value} mL
                    </span>
                    <span className="text-[9px] block text-ink-muted mt-0.5">
                      EDV: {motionMeta.cardiacMetrics.EDV?.value} mL · ESV: {motionMeta.cardiacMetrics.ESV?.value} mL
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: FINDINGS REVIEW (Sections 14, 15, 16) */}
      {/* ========================================================================= */}
      {activeTab === "findings" && (
        <div className="flex flex-col gap-2.5">
          {/* Filter Bar & Add Manual Finding */}
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <div className="flex items-center gap-1">
              {["all", "pending", "accepted", "edited", "rejected"].map((flt) => (
                <button
                  key={flt}
                  onClick={() => setFindingFilter(flt)}
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-colors",
                    findingFilter === flt
                      ? "bg-clinical text-white font-bold"
                      : "text-ink-muted hover:text-ink-primary"
                  )}
                >
                  {flt}
                </button>
              ))}
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddFindingOpen(true)}
              className="h-6 text-[10px] px-2 gap-1"
            >
              <Plus className="h-3 w-3" /> Add Observation
            </Button>
          </div>

          {/* Finding Cards List */}
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {filteredFindings.length === 0 ? (
              <p className="text-xs text-ink-muted text-center py-4">No findings match this filter.</p>
            ) : (
              filteredFindings.map((f) => (
                <div
                  key={f.findingId}
                  className={cn(
                    "rounded-md border p-2.5 text-xs transition-colors",
                    f.reviewStatus === "ACCEPTED"
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : f.reviewStatus === "REJECTED"
                      ? "border-rose-500/30 bg-rose-500/5 opacity-60"
                      : f.reviewStatus === "EDITED"
                      ? "border-cyan-500/30 bg-cyan-500/5"
                      : "border-border-strong bg-panel-alt/70"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-semibold text-ink-primary block leading-tight">
                        {f.anatomy}
                      </span>
                      <span className="text-[10px] text-ink-muted block">{f.findingType}</span>
                    </div>

                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-mono uppercase font-bold shrink-0",
                        f.reviewStatus === "ACCEPTED"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : f.reviewStatus === "REJECTED"
                          ? "bg-rose-500/20 text-rose-400"
                          : f.reviewStatus === "EDITED"
                          ? "bg-cyan-500/20 text-cyan-400"
                          : "bg-amber-500/20 text-amber-300"
                      )}
                    >
                      {f.reviewStatus}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11px] text-ink-secondary leading-relaxed">
                    {f.description}
                  </p>

                  {f.radiologistComments && (
                    <div className="mt-1.5 rounded bg-panel p-1.5 text-[10px] text-ink-primary border border-border">
                      <span className="font-semibold text-clinical block">Radiologist Note:</span>
                      {f.radiologistComments}
                    </div>
                  )}

                  {/* Inline Comment Box */}
                  {editingFindingId === f.findingId && (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={editComment}
                        onChange={(e) => setEditComment(e.target.value)}
                        placeholder="Add radiologist clarification, adjustment, or clinical correlation..."
                        className="w-full h-16 rounded border border-border bg-panel p-1.5 text-xs text-ink-primary outline-none focus:border-clinical"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingFindingId(null)}
                          className="h-6 text-[10px]"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleReviewFinding(f.findingId, "EDITED", editComment)}
                          className="h-6 text-[10px]"
                        >
                          Save & Edit
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Radiologist Action Bar */}
                  {editingFindingId !== f.findingId && (
                    <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-border/50 text-[10px]">
                      <button
                        onClick={() => handleAddFindingToReport(f)}
                        className="flex items-center gap-1 text-clinical hover:underline font-medium"
                      >
                        <FileCheck className="h-3 w-3" /> Append to Report
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingFindingId(f.findingId);
                            setEditComment(f.radiologistComments || "");
                          }}
                          className="p-1 rounded text-ink-muted hover:text-ink-primary hover:bg-panel"
                          title="Edit with comments"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => handleReviewFinding(f.findingId, "ACCEPTED")}
                          className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10"
                          title="Accept finding"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleReviewFinding(f.findingId, "REJECTED")}
                          className="p-1 rounded text-rose-400 hover:bg-rose-500/10"
                          title="Reject finding"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: REPORT DRAFT & FINAL SIGN-OFF (Sections 16, 17, 18) */}
      {/* ========================================================================= */}
      {activeTab === "report" && (
        <div className="flex flex-col gap-3">
          {draft ? (
            <div className="space-y-2.5">
              {/* Draft Status Banner */}
              <div
                className={cn(
                  "rounded-md border p-2.5 text-xs flex items-center justify-between",
                  draft.status === "APPROVED"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                )}
              >
                <div>
                  <span className="font-semibold block">
                    {draft.status === "APPROVED" ? "Official Signed Clinical Report" : "Draft Study Report (AI-Assisted)"}
                  </span>
                  <span className="text-[10px] opacity-80">
                    {draft.status === "APPROVED"
                      ? `Signed by ${draft.approval?.radiologistName} (${draft.approval?.licenseNumber})`
                      : "Pending final review and electronic signature"}
                  </span>
                </div>
                {draft.status === "APPROVED" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setSignModalOpen(true)}
                    className="h-7 text-xs px-2.5"
                  >
                    Sign & Finalize
                  </Button>
                )}
              </div>

              {/* Report Sections Preview */}
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1 text-xs">
                <div className="rounded bg-panel-alt/60 p-2 border border-border">
                  <span className="text-[10px] font-semibold text-ink-muted uppercase">Clinical Information</span>
                  <p className="mt-0.5 text-ink-primary whitespace-pre-line">{draft?.sections?.clinicalInformation || "Pending clinical info..."}</p>
                </div>

                <div className="rounded bg-panel-alt/60 p-2 border border-border">
                  <span className="text-[10px] font-semibold text-ink-muted uppercase">Technique</span>
                  <p className="mt-0.5 text-ink-primary whitespace-pre-line">{draft?.sections?.technique || "Standard diagnostic protocol"}</p>
                </div>

                <div className="rounded bg-panel-alt/60 p-2 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-ink-muted uppercase">Findings</span>
                    <button
                      onClick={handleCompileDraft}
                      disabled={isCompilingDraft}
                      className="text-[10px] text-clinical hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className={cn("h-2.5 w-2.5", isCompilingDraft && "animate-spin")} />
                      Recompile
                    </button>
                  </div>
                  <p className="mt-0.5 text-ink-primary whitespace-pre-line text-[11px] leading-relaxed">
                    {draft?.sections?.findings || "No findings recorded yet"}
                  </p>
                </div>

                <div className="rounded bg-panel-alt/60 p-2 border border-border">
                  <span className="text-[10px] font-semibold text-ink-muted uppercase">Impression</span>
                  <p className="mt-0.5 text-ink-primary font-medium">{draft?.sections?.impression || "Pending radiologist review"}</p>
                </div>

                {draft?.aiTransparency && (
                  <div className="rounded bg-panel p-2 border border-border/50 text-[10px] text-ink-muted">
                    <span className="font-semibold text-ink-secondary block">AI Model Transparency:</span>
                    <span>Engine: {draft.aiTransparency.engine} · Findings: {draft.aiTransparency.findingsCount}</span>
                    <p className="mt-1 italic">{draft.aiTransparency.disclaimer}</p>
                  </div>
                )}
              </div>

              {/* Report Actions */}
              <div className="flex items-center justify-between pt-1 border-t border-border">
                {onOpenReportTab && (
                  <button
                    onClick={onOpenReportTab}
                    className="text-xs text-clinical hover:underline font-medium flex items-center gap-1"
                  >
                    Open Full Radiology Report Workspace <ArrowRight className="h-3 w-3" />
                  </button>
                )}
                {draft.status === "APPROVED" && (
                  <a
                    href={`/api/studies/${studyId}/derived/report/report.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:underline font-mono"
                  >
                    <Download className="h-3 w-3" /> PDF Export
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <Button size="sm" variant="primary" onClick={handleCompileDraft} disabled={isCompilingDraft}>
                {isCompilingDraft ? "Compiling Report..." : "Compile Initial Report Draft"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Manual Finding Entry Modal */}
      <Modal open={addFindingOpen} onClose={() => setAddFindingOpen(false)} title="Add Clinical Observation">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-ink-secondary block mb-1">Target Anatomy / Organ</label>
            <input
              type="text"
              value={manualAnatomy}
              onChange={(e) => setManualAnatomy(e.target.value)}
              placeholder="e.g. Left Ventricle, Thoracic Aorta, Pleura..."
              className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-secondary block mb-1">Observation Description</label>
            <textarea
              value={manualDesc}
              onChange={(e) => setManualDesc(e.target.value)}
              placeholder="Clinical observation, caliber measurement, or morphological note..."
              className="w-full h-24 rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setAddFindingOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleAddManualFinding}>
              Save Observation
            </Button>
          </div>
        </div>
      </Modal>

      {/* Radiologist Approval & Digital Signature Modal */}
      <Modal open={signModalOpen} onClose={() => setSignModalOpen(false)} title="Electronically Approve Study Report">
        <div className="space-y-3 text-xs text-ink-secondary">
          <p>
            By signing, you confirm that you have reviewed the AI-generated findings, volumetric segmentations, and
            hemodynamic metrics for this patient study.
          </p>
          <div>
            <label className="text-xs font-medium text-ink-primary block mb-1">Radiologist Name</label>
            <input
              type="text"
              value={radiologistName}
              onChange={(e) => setRadiologistName(e.target.value)}
              className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-primary block mb-1">License / NPI Number</label>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="w-full rounded border border-border bg-panel p-2 text-xs text-ink-primary outline-none focus:border-clinical"
            />
          </div>
          <div className="rounded bg-panel p-2 border border-border text-[10px] text-ink-muted">
            <Lock className="h-3 w-3 inline mr-1 text-clinical" />
            A cryptographic SHA-256 signature hash will be permanently attached and archived in the study's version audit trail.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setSignModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleApproveReport} disabled={isSigning}>
              {isSigning ? "Signing..." : "Sign & Finalize Report"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 3D Patient Anatomy Modal for Compact View */}
      <Modal open={modal3DOpen} onClose={() => setModal3DOpen(false)} title="Patient 3D Anatomy Reconstruction">
        <div className="w-full min-h-[540px]">
          <RealStudy3DViewer
            studyId={studyId}
            organMeshes={organMeshes}
            onOrganMeshesChange={onOrganMeshesChange}
            onSelectOrgan={onSelectOrgan}
            height="540px"
          />
        </div>
      </Modal>

      {/* 4D Temporal Cine Modal for Compact View */}
      <Modal open={modal4DOpen} onClose={() => setModal4DOpen(false)} title="4D Temporal Cine Reconstruction">
        <div className="w-full min-h-[540px]">
          <RealStudy4DViewer
            studyId={studyId}
            activePhase={activePhase}
            totalPhases={motionMeta?.phaseCount || 8}
            isPlaying={isPlayingMotion}
            fps={motionFps}
            onPhaseChange={(p) => {
              setIsPlayingMotion(false);
              setActivePhase(p);
            }}
            onTogglePlay={() => setIsPlayingMotion(!isPlayingMotion)}
            cardiacMetrics={motionMeta?.cardiacMetrics}
            isSimulated={motionMeta?.isSimulated ?? true}
            height="540px"
          />
        </div>
      </Modal>
    </div>
  );
}
