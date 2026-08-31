"use client";

import { Sparkles, TriangleAlert } from "lucide-react";
import { Report, ReportSection } from "@/lib/types";
import { Textarea } from "@/components/ui/Input";

const SECTION_LABELS: { key: keyof ReportSection; label: string; rows: number }[] = [
  { key: "clinicalInformation", label: "Clinical Information", rows: 2 },
  { key: "technique", label: "Technique", rows: 2 },
  { key: "findings", label: "Findings", rows: 6 },
  { key: "impression", label: "Impression", rows: 3 },
];

export function ReportEditor({ report, onChange }: { report: Report; onChange: (sections: ReportSection) => void }) {
  const locked = report.status === "approved";

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-dim px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-[12.5px] leading-relaxed text-ink-primary">
          <span className="font-semibold">AI-assisted draft</span> — requires review and approval by a licensed radiologist before clinical use.
        </p>
      </div>

      {SECTION_LABELS.map(({ key, label, rows }) => (
        <div key={key}>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">{label}</label>
            {report.aiAssisted && (
              <span className="flex items-center gap-1 text-[10.5px] font-medium text-ai">
                <Sparkles className="h-3 w-3" /> AI-drafted
              </span>
            )}
          </div>
          <Textarea
            value={report.sections[key]}
            onChange={(e) => onChange({ ...report.sections, [key]: e.target.value })}
            rows={rows}
            disabled={locked}
            className="text-[13px] leading-relaxed disabled:opacity-70"
          />
        </div>
      ))}
    </div>
  );
}
