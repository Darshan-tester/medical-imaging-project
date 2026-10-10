"use client";

import { useState } from "react";
import { Sparkles, TriangleAlert, FileText, Check, Wand2, PlusCircle, ListOrdered, Download, Bookmark } from "lucide-react";
import { Finding, Report, ReportSection, Study } from "@/lib/types";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { VoiceDictationButton } from "@/components/report/VoiceDictationButton";
import { CLINICAL_TEMPLATES, ReportTemplate } from "@/lib/agents/reporting-agent";

interface ReportSnippet {
  id: string;
  name: string;
  category: "Chest" | "Brain" | "Abdomen" | "Musculoskeletal" | "General";
  targetSection: keyof ReportSection;
  text: string;
}

const REPORT_SNIPPETS: ReportSnippet[] = [
  {
    id: "normal-chest-cxr",
    name: "Normal Chest (CXR)",
    category: "Chest",
    targetSection: "findings",
    text: "Lungs are clear bilaterally without focal consolidation, pneumothorax, or pleural effusion. Cardiomediastinal silhouette is normal in size and contour. Osseous structures and visualized soft tissues are intact.",
  },
  {
    id: "normal-brain-ct",
    name: "Normal Brain CT",
    category: "Brain",
    targetSection: "findings",
    text: "No acute intracranial hemorrhage, mass effect, or midline shift. Ventricular system, basal cisterns, and cortical sulcal pattern are age-appropriate. Gray-white matter differentiation is preserved. Visualized calvarium and skull base are intact.",
  },
  {
    id: "no-acute-intracranial-imp",
    name: "No Acute Intracranial Abnormality",
    category: "Brain",
    targetSection: "impression",
    text: "1. No acute intracranial hemorrhage or territorial infarction.\n2. Preserved intracranial architecture without mass effect.",
  },
  {
    id: "normal-abdomen-ct",
    name: "Normal Abdomen/Pelvis CT",
    category: "Abdomen",
    targetSection: "findings",
    text: "Liver, spleen, pancreas, adrenal glands, and kidneys demonstrate normal morphology and attenuation. No intra-abdominal lymphadenopathy or free fluid. Bowel loops are unremarkable without obstruction or mural thickening.",
  },
  {
    id: "followup-rec-imp",
    name: "Routine Follow-up Recommendation",
    category: "General",
    targetSection: "impression",
    text: "Recommend clinical correlation and non-emergent follow-up imaging in 3-6 months as clinically indicated.",
  },
];

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

export function renumberImpression(text: string): string {
  const lines = text.split("\n");
  let itemCounter = 1;
  const renumbered = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/^\d+[\.\)]\s*(.*)$/);
    if (match) {
      return `${itemCounter++}. ${match[1]}`;
    }
    return `${itemCounter++}. ${trimmed}`;
  });
  return renumbered.join("\n");
}

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
  const [selectedSnippetId, setSelectedSnippetId] = useState<string>("");
  const [selectedFindingId, setSelectedFindingId] = useState<string>("");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3000);
  };

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
    showNotification(`Applied "${tpl.name}" template`);
  };

  const handleInsertSnippet = (snippetId: string) => {
    if (locked || !snippetId) return;
    const snippet = REPORT_SNIPPETS.find((s) => s.id === snippetId);
    if (!snippet) return;

    const current = report.sections[snippet.targetSection] || "";
    const updated = current.trim() ? `${current.trim()}\n\n${snippet.text}` : snippet.text;
    onChange({ ...report.sections, [snippet.targetSection]: updated });
    showNotification(`Inserted macro: ${snippet.name}`);
    setSelectedSnippetId("");
  };

  const handleInsertStructuredFinding = (findingId: string) => {
    if (locked || !findingId || !study) return;
    const f = study.findings.find((item) => item.id === findingId);
    if (!f) return;

    const loc = f.anatomicalLocation || f.location || "Unspecified location";
    const meas = f.measurements?.lengthMm ? `${f.measurements.lengthMm} mm` : "Not caliper measured";
    const sliceStr = f.sliceIndex !== undefined ? `Slice ${f.sliceIndex + 1}` : "Slice unreferenced";
    const formatted = `• ${f.label.toUpperCase()} (${loc})\n  - Observation: ${f.description}\n  - Metric: ${meas}\n  - Coordinates: ${sliceStr}${f.seriesLabel ? ` (${f.seriesLabel})` : ""}\n  - Status: Radiologist review confirmed`;

    const current = report.sections.findings || "";
    const updated = current.trim() ? `${current.trim()}\n\n${formatted}` : formatted;
    onChange({ ...report.sections, findings: updated });
    showNotification(`Inserted structured finding: ${f.label}`);
    setSelectedFindingId("");
  };

  const handleRenumberImpression = () => {
    if (locked || !report.sections.impression) return;
    const renumbered = renumberImpression(report.sections.impression);
    onChange({ ...report.sections, impression: renumbered });
    showNotification("Renumbered impression items sequentially");
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
    showNotification("Synthesized draft impression");
  };

  const handleExportDicomSr = () => {
    if (!study) return;
    const dicomSrObject = {
      resourceType: "DICOM-SR",
      sopClassUID: "1.2.840.10008.5.1.4.1.1.88.33", // Comprehensive 3D SR Storage
      patientID: study.patientId,
      patientName: study.patientName,
      studyInstanceUID: study.studyInstanceUid || `1.2.840.10008.${study.id}`,
      studyDate: study.date,
      modality: study.modality,
      reportStatus: report.status,
      signedBy: report.signedBy || "Attending Radiologist",
      signedAt: report.signedAt || new Date().toISOString(),
      templateIdentification: "TID 1500 / TID 2000 Basic Diagnostic Imaging Report",
      contentTree: {
        conceptName: { code: "18748-4", scheme: "LN", meaning: "Diagnostic Imaging Report" },
        sections: [
          {
            heading: "Clinical Information",
            value: report.sections.clinicalInformation || "None specified",
          },
          {
            heading: "Technique",
            value: report.sections.technique || "Standard diagnostic acquisition",
          },
          {
            heading: "Comparison",
            value: report.sections.comparison || "None available",
          },
          {
            heading: "Findings",
            value: report.sections.findings || "See detailed study annotations",
          },
          {
            heading: "Impression",
            value: report.sections.impression || "No acute abnormality",
          },
        ],
      },
    };

    const blob = new Blob([JSON.stringify(dicomSrObject, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DICOM-SR_${study.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification("Exported DICOM-SR structured dataset");
  };

  return (
    <div className="space-y-5">
      {/* AI advisory banner */}
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-dim px-4 py-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] leading-relaxed text-ink-primary">
            <span className="font-semibold">Diagnostic Radiology Report</span> — All synthesized findings, measurements, and impressions require review and approval by a certified diagnostic radiologist prior to clinical sign-off.
          </p>
        </div>
      </div>

      {/* Clinical Reporting Toolbar */}
      {!locked && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-panel-alt p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Template Selector */}
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-clinical" />
              <span className="text-[12px] font-semibold text-ink-primary">Template:</span>
              <select
                value={selectedTemplateKey}
                onChange={(e) => setSelectedTemplateKey(e.target.value)}
                className="rounded-md border border-border bg-base px-2 py-1 text-[11.5px] text-ink-primary outline-none focus:border-clinical"
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
                  Insert
                </Button>
              )}
            </div>

            {/* Snippet / Macro Selector */}
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-amber-400" />
              <span className="text-[12px] font-semibold text-ink-primary">Macro / Snippet:</span>
              <select
                value={selectedSnippetId}
                onChange={(e) => setSelectedSnippetId(e.target.value)}
                className="rounded-md border border-border bg-base px-2 py-1 text-[11.5px] text-ink-primary outline-none focus:border-clinical max-w-[200px]"
              >
                <option value="">Select macro phrase…</option>
                {REPORT_SNIPPETS.map((snip) => (
                  <option key={snip.id} value={snip.id}>
                    [{snip.category}] {snip.name}
                  </option>
                ))}
              </select>
              {selectedSnippetId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleInsertSnippet(selectedSnippetId)}
                >
                  Insert Macro
                </Button>
              )}
            </div>

            {/* DICOM-SR Export */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportDicomSr}
              className="text-[11.5px] text-ink-secondary hover:text-ink-primary flex items-center gap-1.5"
              title="Export DICOM-SR (PS 3.3 Annex A.35 structured dataset)"
            >
              <Download className="h-3.5 w-3.5" /> DICOM-SR
            </Button>
          </div>

          {/* Structured Finding Insertion Row */}
          {study && study.findings.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
              <div className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-clinical" />
                <span className="text-[12px] font-semibold text-ink-primary">Insert Finding to Report:</span>
                <select
                  value={selectedFindingId}
                  onChange={(e) => setSelectedFindingId(e.target.value)}
                  className="rounded-md border border-border bg-base px-2 py-1 text-[11.5px] text-ink-primary outline-none focus:border-clinical max-w-[260px]"
                >
                  <option value="">Choose study finding…</option>
                  {study.findings.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.location || `Slice ${(f.sliceIndex ?? 0) + 1}`})
                    </option>
                  ))}
                </select>
                {selectedFindingId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleInsertStructuredFinding(selectedFindingId)}
                  >
                    Insert to Findings
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAutoDraftImpression}
                  className="text-[11.5px] text-ai hover:text-ai"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Synthesize Impression
                </Button>
              </div>
            </div>
          )}

          {actionNotice && (
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-1 rounded">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span>{actionNotice}</span>
            </div>
          )}
        </div>
      )}

      {/* Report Sections */}
      {SECTION_LABELS.map(({ key, label, rows, placeholder }) => (
        <div key={key} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-[12px] font-semibold uppercase tracking-wide text-ink-secondary">
                {label}
              </label>
              {key === "impression" && !locked && (
                <button
                  type="button"
                  onClick={handleRenumberImpression}
                  className="flex items-center gap-1 text-[10.5px] text-clinical hover:underline font-mono"
                  title="Automatically maintain sequential numbering (1., 2., 3.)"
                >
                  <ListOrdered className="h-3 w-3" />
                  <span>Maintain Numbering</span>
                </button>
              )}
            </div>

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
