"use client";

import { memo } from "react";
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
  hasGenuine4D?: boolean;
  onOpenPatientInfo?: () => void;
  onOpenStudyInfo?: () => void;
  onExport?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  aiStatus?: string;
  hasUnsavedReport?: boolean;
}

export const ClinicalTopBar = memo(function ClinicalTopBar({
  study,
  activeMode,
  onSelectMode,
  hasGenuine4D = false,
  onOpenPatientInfo,
  onOpenStudyInfo,
  onExport,
  isFullscreen = false,
  onToggleFullscreen,
  aiStatus = "complete",
  hasUnsavedReport = false,
}: ClinicalTopBarProps) {
  const router = useRouter();

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
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-[#1e293b] bg-[#0b0f19] px-3.5 select-none z-30 shadow-md">
      {/* Left: Worklist Navigation & Patient Identity */}
      <div className="flex items-center gap-3 min-w-0">
        <Tooltip label="Return to Worklist (Esc)">
          <button
            onClick={() => router.push("/studies")}
            className="flex items-center gap-1.5 rounded border border-[#1e293b] bg-[#111827] px-2.5 py-1 text-[11.5px] font-medium text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden sm:inline font-mono">WORKLIST</span>
          </button>
        </Tooltip>

        <div className="h-4 w-[1px] bg-[#1e293b] shrink-0" aria-hidden />

        {/* Patient Block */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-bold text-white tracking-tight">
              {study.patientAlias}
            </span>
            <span className="hidden font-mono text-[11px] text-slate-400 md:inline">
              MRN: {study.studyId}
            </span>
            {study.priority === "stat" && (
              <span className="flex items-center gap-1 rounded bg-rose-950/80 border border-rose-500/60 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-rose-400 animate-pulse">
                STAT
              </span>
            )}
            {study.priority === "urgent" && (
              <span className="rounded bg-amber-950/80 border border-amber-500/60 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-amber-400">
                URGENT
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="truncate">{demographics || "Diagnostic Study"}</span>
            <span>·</span>
            <span className="font-mono text-slate-400">{formattedDate}</span>
          </div>
        </div>
      </div>

      {/* Center: Clinical Workflow Segmented Mode Switcher */}
      <nav aria-label="Clinical workflow modes" className="flex items-center">
        <div className="flex items-center gap-1 rounded-lg border border-[#1e293b] bg-[#111827] p-1 shadow-inner">
          {/* 1. 2D / MPR (Primary Diagnostic Workspace) */}
          <button
            onClick={() => onSelectMode("images")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all",
              activeMode === "images"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Multi-Planar Diagnostic Viewer (Axial, Coronal, Sagittal)"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>2D / MPR</span>
          </button>

          {/* 2. 3D Anatomy */}
          <button
            onClick={() => onSelectMode("3d")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all",
              activeMode === "3d"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Patient-specific 3D anatomy reconstruction & segmented structures"
          >
            <Box className="h-3.5 w-3.5" />
            <span>3D Anatomy</span>
          </button>

          {/* 3. 4D Cine (Only when genuine temporal cine data exists) */}
          {hasGenuine4D && (
            <button
              onClick={() => onSelectMode("4d")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all",
                activeMode === "4d"
                  ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                  : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
              )}
              title="Dynamic 4D cine acquisition sequence (temporal phases)"
            >
              <Play className="h-3.5 w-3.5" />
              <span>4D Cine</span>
            </button>
          )}

          {/* 4. AI / Analysis (MONAI clinical tasks) */}
          <button
            onClick={() => onSelectMode("ai")}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all",
              activeMode === "ai"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Clinical AI: organ segmentation, volumetrics, and lesion detection"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Clinical AI</span>
            {aiStatus === "running" && (
              <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          {/* 5. Report */}
          <button
            onClick={() => onSelectMode("report")}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all",
              activeMode === "report"
                ? "bg-sky-600 text-white shadow-sm font-semibold shadow-sky-600/30 ring-1 ring-sky-400/40"
                : "text-slate-400 hover:bg-[#1a2333] hover:text-slate-200"
            )}
            title="Diagnostic radiology report and formal sign-off"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Report</span>
            {study.report.status === "approved" ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-400 ml-0.5" />
            ) : hasUnsavedReport ? (
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            ) : null}
          </button>
        </div>
      </nav>

      {/* Right: Modality, Status, and Workstation Actions */}
      <div className="flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-2 mr-1">
          <ModalityBadge modality={study.modality} />
          <span className="rounded bg-[#1e293b]/80 border border-[#334155]/60 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-slate-300">
            {study.status.replace("-", " ")}
          </span>
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
