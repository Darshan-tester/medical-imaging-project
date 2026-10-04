"use client";

import { memo } from "react";
import { FileText, Lock, Copy, Check } from "lucide-react";
import { SourceReport } from "@/lib/types";
import { DatasetSourceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const SECTIONS: { key: keyof SourceReport; label: string }[] = [
  { key: "clinicalInformation", label: "Clinical Information" },
  { key: "indication", label: "Indication" },
  { key: "technique", label: "Technique" },
  { key: "comparison", label: "Comparison" },
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
];

/**
 * Immutable, read-only view of the study's ORIGINAL source report from the PACS archive.
 * Clearly marked as READ ONLY so the radiologist knows this is the historical baseline.
 */
export const RadiologyReportPanel = memo(function RadiologyReportPanel({
  sourceReport,
  onCopyAll,
  onOpenFullReport,
}: {
  sourceReport?: SourceReport;
  onCopyAll?: () => void;
  onOpenFullReport?: () => void;
}) {
  if (!sourceReport) {
    return (
      <div className="flex h-full flex-col bg-[#0b0f19] text-slate-100">
        <PanelHeader />
        <div className="flex-1 overflow-y-auto p-4">
          <EmptyState
            icon={FileText}
            title="Source PACS report not available"
            description="No pre-existing diagnostic radiology report was matched to this study in the archive."
          />
        </div>
      </div>
    );
  }

  const sectionsPresent = SECTIONS.filter(({ key }) => !!sourceReport[key]);
  const hasStructuredSections = sectionsPresent.length > 0;

  return (
    <div className="flex h-full flex-col bg-[#0b0f19] text-slate-100">
      <PanelHeader source={sourceReport.source} onCopyAll={onCopyAll} />
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {hasStructuredSections ? (
          sectionsPresent.map(({ key, label }) => (
            <div
              key={key}
              className="rounded-lg border border-[#1e293b] bg-[#080c14]/70 p-3.5"
            >
              <div className="flex items-center justify-between mb-1.5 border-b border-[#1e293b]/60 pb-1">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 font-mono">
                  {label}
                </h4>
                <span className="text-[10px] text-slate-400 font-mono">Archive Baseline</span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200 font-sans">
                {sourceReport[key]}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-[#1e293b] bg-[#080c14]/70 p-3.5">
            <div className="flex items-center justify-between mb-1.5 border-b border-[#1e293b]/60 pb-1">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 font-mono">
                Full Narrative Report
              </h4>
              <span className="text-[10px] text-slate-400 font-mono">Archive Baseline</span>
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-200 font-sans">
              {sourceReport.text}
            </p>
          </div>
        )}
      </div>
      {onOpenFullReport && (
        <div className="border-t border-[#1e293b] p-3 bg-[#080c14]/50">
          <button
            onClick={onOpenFullReport}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#334155] bg-[#0f172a] px-3 py-2 text-[12px] font-medium text-slate-200 transition-colors hover:border-sky-500/50 hover:text-sky-400"
          >
            <span>Open full Report &amp; Approval</span>
          </button>
        </div>
      )}
    </div>
  );
});

function PanelHeader({
  source,
  onCopyAll,
}: {
  source?: string;
  onCopyAll?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#1e293b] bg-[#080c14] px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-800 text-slate-300">
          <FileText className="h-3.5 w-3.5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-slate-100">
              Source Report (PACS Archive)
            </h3>
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border border-slate-700">
              <Lock className="h-2.5 w-2.5" /> Read Only
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Immutable prior acquisition report for reference and longitudinal comparison
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {source && source !== "Meridian" && <DatasetSourceBadge source={source} />}
      </div>
    </div>
  );
}
