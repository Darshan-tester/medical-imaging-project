"use client";

import { useState } from "react";
import { Sparkles, TriangleAlert, FileText, Check, Wand2 } from "lucide-react";
import { Report, ReportSection, Study } from "@/lib/types";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { VoiceDictationButton } from "@/components/report/VoiceDictationButton";
import { CLINICAL_TEMPLATES, ReportTemplate } from "@/lib/agents/reporting-agent";

const SECTION_LABELS: { key: keyof ReportSection; label: string; rows: number; placeholder: string }[] = [
  {
    key: "clinicalInformation",
    label: "Clinical Information / Indication",
    rows: 2,
    placeholder: "Reason for study, symptoms, relevant surgical/oncologic history…",
  },
  {
    key: "technique",
    label: "Technique & Protocol",
    rows: 2,
    placeholder: "Imaging parameters, contrast administration, volumetric reconstruction planes…",
  },
  {
    key: "comparison",
    label: "Comparison / Prior Studies",
    rows: 2,
    placeholder: "Comparison with prior exams (date, modality, accession) or note none available…",
  },
  {
    key: "findings",
    label: "Findings",
    rows: 7,
    placeholder: "Organ-by-organ or regional detailed diagnostic observations…",
  },
  {
    key: "impression",
    label: "Impression",
    rows: 4,
    placeholder: "Numbered, actionable synthesis and recommendations in order of clinical importance…",
  },
];

export function ReportEditor({
  report,
  study,
  onChange,
}: {
  report: Report;
  study?: Study;
  onChange: (sections: ReportSection) => void;
}) {
  const locked = report.status === "approved";
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("");
  const [templateAppliedNotice, setTemplateAppliedNotice] = useState<string | null>(null);

  const handleAppendDictation = (key: keyof ReportSection, transcript: string) => {
    if (locked) return;
    const current = report.sections[key] || "";
    const updated = current.trim() ? `${current.trim()} ${transcript}` : transcript;
    onChange({ ...report.sections, [key]: updated });
  };

  const handleApplyTemplate = (templateKey: string) => {
    if (locked || !templateKey) return;
    const tpl: ReportTemplate | undefined = CLINICAL_TEMPLATES[templateKey];
    if (!tpl) return;

    const updated: ReportSection = {
      ...report.sections,
      technique: tpl.techniqueTemplate,
      findings: tpl.findingsTemplate,
      impression: tpl.impressionTemplate,
    };
    onChange(updated);
    setTemplateAppliedNotice(`Applied "${tpl.name}" template`);
    setTimeout(() => setTemplateAppliedNotice(null), 3000);
  };

  const handleAutoDraftImpression = () => {
    if (locked || !study || study.findings.length === 0) return;
    const positive = study.findings.filter(
      (f) => !f.label.toLowerCase().startsWith("no ") && f.status !== "rejected"
    );
    if (positive.length === 0) {
      onChange({
        ...report.sections,
        impression: "1. No acute or critical imaging abnormality identified.\n2. Preserved anatomical morphology within visualized structures.",
      });
      return;
    }

    const lines = positive.map((f, i) => {
      const loc = f.location ? ` in ${f.location}` : "";
      const meas = f.measurements?.lengthMm ? ` (${f.measurements.lengthMm} mm)` : "";
      return `${i + 1}. ${f.label}${loc}${meas}.`;
    });
    onChange({
      ...report.sections,
      impression: lines.join("\n"),
    });
  };

  return (
    <div className="space-y-5">
      {/* AI advisory banner */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-dim px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-relaxed text-ink-primary">
            <span className="font-semibold">AI-Assisted Diagnostic Report</span> — All synthesized findings, measurements, and impressions require review and approval by a certified radiologist prior to clinical sign-off.
          </p>
        </div>
      </div>

      {/* Clinical Template Selector Bar */}
      {!locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-panel-alt p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-clinical" />
            <span className="text-[12px] font-semibold text-ink-primary">Structured Template:</span>
            <select
              value={selectedTemplateKey}
              onChange={(e) => setSelectedTemplateKey(e.target.value)}
              className="rounded-md border border-border bg-base px-2.5 py-1 text-[12px] text-ink-primary outline-none focus:border-clinical"
            >
              <option value="">Select standard template…</option>
              {Object.entries(CLINICAL_TEMPLATES).map(([key, tpl]) => (
                <option key={key} value={key}>
                  {tpl.name} ({tpl.modality})
                </option>
              ))}
            </select>
            {selectedTemplateKey && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleApplyTemplate(selectedTemplateKey)}
              >
                Insert Template
              </Button>
            )}
          </div>

          {study && study.findings.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAutoDraftImpression}
              className="text-[11.5px] text-ai hover:text-ai"
            >
              <Wand2 className="h-3.5 w-3.5" /> Synthesize Impression
            </Button>
          )}

          {templateAppliedNotice && (
            <span className="flex items-center gap-1 text-[11.5px] font-medium text-success">
              <Check className="h-3.5 w-3.5" /> {templateAppliedNotice}
            </span>
          )}
        </div>
      )}

      {/* Report Sections */}
      {SECTION_LABELS.map(({ key, label, rows, placeholder }) => (
        <div key={key} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">
              {label}
            </label>
            <div className="flex items-center gap-3">
              {report.aiAssisted && (
                <span className="flex items-center gap-1 text-[10.5px] font-medium text-ai">
                  <Sparkles className="h-3 w-3" /> AI-assisted
                </span>
              )}
              {!locked && (
                <VoiceDictationButton
                  onTranscript={(transcript) => handleAppendDictation(key, transcript)}
                />
              )}
            </div>
          </div>
          <Textarea
            value={report.sections[key] || ""}
            onChange={(e) => onChange({ ...report.sections, [key]: e.target.value })}
            rows={rows}
            disabled={locked}
            placeholder={placeholder}
            className="text-[13px] leading-relaxed disabled:opacity-75 font-sans"
          />
        </div>
      ))}
    </div>
  );
}
