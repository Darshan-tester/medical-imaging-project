"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Layers,
  Box,
  Play,
  Sparkles,
  FileText,
  Maximize2,
  Minimize2,
  Info,
  Download,
  CheckCircle2,
  Activity,
  Calendar,
  Clock,
  ScanLine,
  Sliders,
  Crosshair,
  Keyboard,
} from "lucide-react";
import { Study, Modality, StudyPriority, StudyStatus } from "@/lib/types";
import { ModalityBadge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";

export type ClinicalWorkflowMode = "images" | "3d" | "4d" | "ai" | "report";

interface ClinicalTopBarProps {
  study: Study;
  activeMode: ClinicalWorkflowMode;
  onSelectMode: (mode: ClinicalWorkflowMode) => void;
  annotationMode?: "2d" | "3d" | null;
  onSelectAnnotationMode?: (mode: "2d" | "3d") => void;
  annotationCount?: number;
  hasGenuine4D?: boolean;
  onOpenPatientInfo?: () => void;
  onOpenStudyInfo?: () => void;
  onOpenShortcuts?: () => void;
  onExport?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  aiStatus?: string;
  hasUnsavedReport?: boolean;
  annotation3DDisplayMode?: "original" | "annotated";
  onToggleAnnotation3DDisplayMode?: (mode: "original" | "annotated") => void;
}

export const ClinicalTopBar = memo(function ClinicalTopBar({
  study,
  activeMode,
  onSelectMode,
  annotationMode = null,
  onSelectAnnotationMode,
  annotationCount = 0,
  hasGenuine4D = false,
  onOpenPatientInfo,
  onOpenStudyInfo,
  onOpenShortcuts,
  onExport,
  isFullscreen = false,
  onToggleFullscreen,
  aiStatus = "complete",
  hasUnsavedReport = false,
  annotation3DDisplayMode = "annotated",
  onToggleAnnotation3DDisplayMode,
}: ClinicalTopBarProps) {
  const router = useRouter();
  const [showWorkflowStatus, setShowWorkflowStatus] = useState(false);

  const reviewedAiCount = study.findings.filter(
    (f) => f.status === "accepted" || f.status === "modified" || f.status === "rejected"
  ).length;
  const isReportSigned = study.report.status === "approved";

  const formattedDate = study.date
    ? new Date(study.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Date N/A";

  const demographics = [
    study.age !== undefined ? `${study.age}y` : undefined,
    study.sex,
    study.bodyRegion,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-white/10 bg-[#060b14]/85 backdrop-blur-xl px-3.5 select-none z-30 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      {/* Left: Worklist Navigation & Patient Identity */}
      <div className="flex items-center gap-3 min-w-0 shrink">
        <Tooltip label="Return to Worklist (Esc)">
          <button
            onClick={() => router.push("/studies")}
            className="flex items-center gap-1.5 rounded border border-[#1e293b] bg-[#111827] px-2.5 py-1 text-[11.5px] font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline font-mono">WORKLIST</span>
          </button>
        </Tooltip>

        <div className="h-4 w-[1px] bg-[#1e293b] shrink-0" aria-hidden />

        {/* Patient Block */}
        <div className="flex flex-col min-w-0 max-w-[180px] sm:max-w-[240px] lg:max-w-[320px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-[13.5px] font-bold text-white tracking-tight" title={study.patientAlias}>
              {study.patientAlias}
            </span>
            <span className="hidden font-mono text-[11px] text-slate-400 xl:inline truncate">
              MRN: {study.studyId}
            </span>
            {study.priority === "stat" && (
              <span className="shrink-0 flex items-center gap-1 rounded bg-rose-950/80 border border-rose-500/60 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-rose-400 animate-pulse">
                STAT
              </span>
            )}
            {study.priority === "urgent" && (
              <span className="shrink-0 rounded bg-amber-950/80 border border-amber-500/60 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-amber-400">
                URGENT
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 min-w-0">
            <span className="truncate">{demographics || "Diagnostic Study"}</span>
            <span className="shrink-0">·</span>
            <span className="font-mono text-slate-400 shrink-0">{formattedDate}</span>
          </div>
        </div>
      </div>

      {/* Center: Clinical Workflow Segmented Mode Switcher */}
      <nav aria-label="Clinical workflow modes" className="flex items-center gap-1 sm:gap-1.5 min-w-0 shrink">
        <div className="flex items-center gap-0.5 md:gap-1 rounded-lg border border-[#1e293b] bg-[#111827] p-1 shadow-inner shrink-0">
          {/* 1. 2D / MPR (Primary Diagnostic Workspace) */}
          <button
            onClick={() => onSelectMode("images")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-medium transition-all shrink-0",
              activeMode === "images"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Multi-Planar Diagnostic Viewer (Axial, Coronal, Sagittal)"
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xl:inline">2D / MPR</span>
            <span className="xl:hidden">2D</span>
          </button>

          {/* 2. 3D Anatomy */}
          <button
            onClick={() => onSelectMode("3d")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-medium transition-all shrink-0",
              activeMode === "3d"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Patient-specific 3D anatomy reconstruction & segmented structures"
          >
            <Box className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xl:inline">3D Anatomy</span>
            <span className="xl:hidden">3D</span>
          </button>

          {/* 3. 4D Cine (Only when genuine temporal cine data exists) */}
          {hasGenuine4D && (
            <button
              onClick={() => onSelectMode("4d")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-medium transition-all shrink-0",
                activeMode === "4d"
                  ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                  : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
              )}
              title="Dynamic 4D cine acquisition sequence (temporal phases)"
            >
              <Play className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden xl:inline">4D Cine</span>
              <span className="xl:hidden">4D</span>
            </button>
          )}

          {/* 4. AI / Analysis (MONAI clinical tasks) */}
          <button
            onClick={() => onSelectMode("ai")}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-medium transition-all shrink-0",
              activeMode === "ai"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Clinical AI: organ segmentation, volumetrics, and lesion detection"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="hidden xl:inline">Clinical AI</span>
            <span className="xl:hidden">AI</span>
            {aiStatus === "running" && (
              <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          {/* 5. Report */}
          <button
            onClick={() => onSelectMode("report")}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-2 sm:px-3 py-1.5 text-[11.5px] sm:text-[12px] font-medium transition-all shrink-0",
              activeMode === "report"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Diagnostic radiology report and formal sign-off"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>Report</span>
            {study.report.status === "approved" ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400 ml-0.5" />
            ) : hasUnsavedReport ? (
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            ) : null}
          </button>
        </div>

        {/* Dedicated 2D & 3D Annotation Modes */}
        {onSelectAnnotationMode && (
          <div className="flex items-center gap-0.5 sm:gap-1 rounded-lg border border-sky-500/30 bg-sky-950/20 p-1 shadow-inner shrink-0">
            <span className="hidden 2xl:inline px-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-400/80">
              Annotate:
            </span>
            <button
              onClick={() => onSelectAnnotationMode("2d")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[11.5px] font-medium transition-all shrink-0",
                annotationMode === "2d" && activeMode === "images"
                  ? "bg-sky-500 text-white shadow-sm font-semibold ring-1 ring-sky-300"
                  : "text-sky-300 hover:bg-sky-900/40 hover:text-white"
              )}
              title="2D Annotation Mode: draw precise ROIs, contours, calipers, and lesions on the current slice"
            >
              <Crosshair className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span className="hidden xl:inline">2D Annotation</span>
              <span className="xl:hidden">2D</span>
              {annotationCount > 0 && (
                <span className="ml-0.5 rounded-full bg-sky-500/30 px-1.5 py-0.2 font-mono text-[9px] font-bold text-sky-200 border border-sky-400/40">
                  {annotationCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectAnnotationMode("3d")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[11.5px] font-medium transition-all shrink-0",
                annotationMode === "3d" && activeMode === "3d"
                  ? "bg-amber-500 text-white shadow-sm font-semibold ring-1 ring-amber-300"
                  : "text-amber-300 hover:bg-amber-900/40 hover:text-white"
              )}
              title="3D Annotation Mode: view 3D VOI spatial bounding highlights and anatomical regions"
            >
              <Box className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="hidden xl:inline">3D Annotation</span>
              <span className="xl:hidden">3D</span>
            </button>

            {/* Original vs Annotated toggle for 3D annotation */}
            {annotationMode === "3d" && activeMode === "3d" && onToggleAnnotation3DDisplayMode && (
              <div className="flex items-center rounded bg-black/60 p-0.5 border border-white/10 text-[9.5px] font-mono ml-1">
                <button
                  type="button"
                  onClick={() => onToggleAnnotation3DDisplayMode("original")}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-all font-medium",
                    annotation3DDisplayMode === "original"
                      ? "bg-sky-500 text-white font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                  title="View original 3D volume without annotations"
                >
                  Original
                </button>
                <button
                  type="button"
                  onClick={() => onToggleAnnotation3DDisplayMode("annotated")}
                  className={cn(
                    "rounded px-1.5 py-0.5 transition-all font-medium",
                    annotation3DDisplayMode === "annotated"
                      ? "bg-amber-500 text-white font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                  title="View annotated 3D volume with spatial VOIs"
                >
                  Annotated
                </button>
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Right: Modality, Status, and Workstation Actions */}
      <div className="flex items-center gap-2">
        <div className="relative hidden lg:flex items-center gap-2 mr-1">
          <ModalityBadge modality={study.modality} />
          <button
            type="button"
            onClick={() => setShowWorkflowStatus((v) => !v)}
            className="flex items-center gap-1.5 rounded bg-[#1e293b]/90 border border-[#334155]/80 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-300 hover:border-sky-500 transition-colors"
            title="View comprehensive study review status (Section 30)"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", isReportSigned ? "bg-emerald-400" : "bg-amber-400 animate-pulse")} />
            <span>{isReportSigned ? "FINALIZED" : study.status.replace("-", " ").toUpperCase()}</span>
          </button>

          {showWorkflowStatus && (
            <div className="absolute top-9 right-0 z-50 w-72 rounded-lg border border-border-strong bg-[#0f172a] p-3 shadow-2xl text-[11px] space-y-2.5">
              <div className="flex items-center justify-between border-b border-border pb-1.5">
                <span className="font-semibold text-slate-200 uppercase tracking-wider text-[10px]">
                  Study Review Status
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {study.modality} · {study.studyId}
                </span>
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">IMAGES:</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    ✓ Reviewed
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">AI FINDINGS:</span>
                  <span className={cn("font-semibold", reviewedAiCount === study.findings.length ? "text-emerald-400" : "text-amber-400")}>
                    {reviewedAiCount} / {study.findings.length} Reviewed
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">REPORT:</span>
                  <span className={isReportSigned ? "text-emerald-400 font-semibold" : "text-slate-300"}>
                    {isReportSigned ? "Final Attested" : "Draft (In Progress)"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">QC AUDIT:</span>
                  <span className={isReportSigned ? "text-emerald-400 font-semibold" : "text-amber-400"}>
                    {isReportSigned ? "✓ Passed" : "Pending Verification"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">SIGNATURE:</span>
                  <span className={isReportSigned ? "text-emerald-400 font-semibold" : "text-amber-400"}>
                    {isReportSigned ? "✓ Electronically Signed" : "Pending Radiologist Sign"}
                  </span>
                </div>
              </div>
              <p className="text-[9.5px] text-slate-500 italic pt-1 border-t border-slate-800">
                AI decision support requires complete radiologist verification before signing.
              </p>
            </div>
          )}
        </div>

        {onOpenPatientInfo && (
          <Tooltip label="Patient Demographics & Clinical History">
            <button
              onClick={onOpenPatientInfo}
              className="flex h-7.5 w-7.5 items-center justify-center rounded border border-[#1e293b] bg-[#111827] text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {onOpenShortcuts && (
          <Tooltip label="Workstation Keyboard Shortcuts (?)">
            <button
              onClick={onOpenShortcuts}
              className="flex h-7.5 w-7.5 items-center justify-center rounded border border-[#1e293b] bg-[#111827] text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {onExport && (
          <Tooltip label="Export Diagnostic Package">
            <button
              onClick={onExport}
              className="hidden sm:flex h-7.5 w-7.5 items-center justify-center rounded border border-[#1e293b] bg-[#111827] text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        )}

        {onToggleFullscreen && (
          <Tooltip label={isFullscreen ? "Exit Fullscreen (F)" : "Reading Room Fullscreen (F)"}>
            <button
              onClick={onToggleFullscreen}
              className={cn(
                "flex h-7.5 w-7.5 items-center justify-center rounded border transition-colors",
                isFullscreen
                  ? "border-sky-500 bg-sky-950 text-sky-300"
                  : "border-[#1e293b] bg-[#111827] text-slate-300 hover:border-slate-500 hover:text-white"
              )}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </Tooltip>
        )}
      </div>
    </header>
  );
});
