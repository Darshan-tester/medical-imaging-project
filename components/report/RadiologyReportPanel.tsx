"use client";

import { memo } from "react";
import { FileText, ExternalLink } from "lucide-react";
import { SourceReport } from "@/lib/types";
import { DatasetSourceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const SECTIONS: { key: keyof SourceReport; label: string }[] = [
  { key: "clinicalInformation", label: "Clinical Information" },
  { key: "indication", label: "Indication" },
  { key: "technique", label: "Technique" },
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
  { key: "comparison", label: "Comparison" },
];

/**
 * Quick-glance, read-only view of the study's ORIGINAL source report so the
 * radiologist never has to leave the image to check what it says. Editing
 * always happens on the full Report tab (the "working report") — this panel
 * never mutates anything, and always shows the immutable original verbatim.
 */
export const RadiologyReportPanel = memo(function RadiologyReportPanel({ sourceReport, onOpenFullReport }: { sourceReport?: SourceReport; onOpenFullReport?: () => void }) {
  if (!sourceReport) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader />
        <div className="flex-1 overflow-y-auto p-3">
          <EmptyState icon={FileText} title="Radiology report not available for this study." description="No source report was matched to this study." />
        </div>
      </div>
    );
  }

  const sectionsPresent = SECTIONS.filter(({ key }) => !!sourceReport[key]);
  const hasStructuredSections = sectionsPresent.length > 0;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader source={sourceReport.source} />
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {hasStructuredSections ? (
          sectionsPresent.map(({ key, label }) => (
            <div key={key}>
              <h4 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-secondary">{label}</h4>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-primary">{sourceReport[key]}</p>
            </div>
          ))
        ) : (
          <div>
            <h4 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-secondary">Report</h4>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-primary">{sourceReport.text}</p>
          </div>
        )}
      </div>
      {onOpenFullReport && (
        <div className="border-t border-border p-3">
          <button
            onClick={onOpenFullReport}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border-strong bg-panel-alt px-3 py-2 text-[12px] font-medium text-ink-primary transition-colors duration-150 hover:border-clinical/50 hover:text-clinical"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open full Report &amp; Approval
          </button>
        </div>
      )}
    </div>
  );
});

function PanelHeader({ source }: { source?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-clinical" />
        <h3 className="text-[13px] font-semibold text-ink-primary">Radiology Report</h3>
      </div>
      {source && source !== "Meridian" && <DatasetSourceBadge source={source} />}
    </div>
  );
}
