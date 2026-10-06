import { jsPDF } from "jspdf";
import { Study, Finding } from "./types";
import { PatientProfile, ProfileField } from "./patient-profile";
import { formatDateTime } from "./utils";

const INK_PRIMARY = "#0F172A"; // Slate 900
const INK_SECONDARY = "#334155"; // Slate 700
const INK_MUTED = "#64748B"; // Slate 500
const BORDER_COLOR = "#CBD5E1"; // Slate 300
const ACCENT_PRIMARY = "#0284C7"; // Hospital Blue / Sky 600
const BG_LIGHT = "#F8FAFC"; // Slate 50
const BG_WARNING = "#FEF3C7"; // Amber 100
const INK_WARNING = "#92400E"; // Amber 800
const INK_SUCCESS = "#15803D"; // Emerald 700

const SEX_LABEL: Record<"M" | "F" | "Other", string> = { M: "Male", F: "Female", Other: "Other" };

function pairText<A, B>(
  a: ProfileField<A> | undefined,
  fa: (v: A) => string,
  b: ProfileField<B> | undefined,
  fb: (v: B) => string
): string {
  const text = `${a ? fa(a.value) : "Not available"} / ${b ? fb(b.value) : "Not available"}`;
  return a?.source === "simulated" || b?.source === "simulated" ? `${text} (demo)` : text;
}

/**
 * Flow-based Clinical Report PDF Generator.
 * Replaces absolute Y coordinates with a robust dynamic flow layout system.
 * Handles auto-wrapping 2-column metadata, multi-line findings, structured tables,
 * multi-page page breaks, running headers, and electronic signatures with zero text overlap.
 */
class FlowReportBuilder {
  private doc: jsPDF;
  private pageWidth: number;
  private pageHeight: number;
  private margin: number;
  private contentWidth: number;
  private currentY: number;
  private bottomLimit: number;
  private study: Study;
  private currentPage: number;

  constructor(study: Study) {
    this.doc = new jsPDF({ unit: "pt", format: "letter" });
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.margin = 48;
    this.contentWidth = this.pageWidth - 2 * this.margin;
    this.currentY = 48;
    this.bottomLimit = this.pageHeight - 50;
    this.study = study;
    this.currentPage = 1;
  }

  private ensureSpace(neededHeight: number): void {
    if (this.currentY + neededHeight > this.bottomLimit) {
      this.addNewPage();
    }
  }

  private addNewPage(): void {
    this.doc.addPage();
    this.currentPage++;
    this.currentY = this.margin;
    this.renderRunningHeader();
  }

  private renderRunningHeader(): void {
    // Top banner accent on pages 2+
    this.doc.setFillColor(ACCENT_PRIMARY);
    this.doc.rect(0, 0, this.pageWidth, 3, "F");

    this.doc.setTextColor(INK_MUTED);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);
    this.doc.text("MERIDIAN / VEDH MEDICAL IMAGING", this.margin, this.currentY + 8);

    const rightText = `MRN: ${this.study.studyId} · ${this.study.patientAlias}`;
    this.doc.setFont("helvetica", "normal");
    this.doc.text(rightText, this.pageWidth - this.margin, this.currentY + 8, { align: "right" });

    this.currentY += 15;
    this.doc.setDrawColor(BORDER_COLOR);
    this.doc.setLineWidth(0.5);
    this.doc.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 16;
  }

  private renderLetterhead(): void {
    // Page 1 Letterhead Accent Bar
    this.doc.setFillColor(ACCENT_PRIMARY);
    this.doc.rect(0, 0, this.pageWidth, 5, "F");

    this.doc.setTextColor(INK_PRIMARY);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(15);
    this.doc.text("MERIDIAN / VEDH MEDICAL IMAGING", this.margin, this.currentY + 12);

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    this.doc.setTextColor(INK_MUTED);
    this.doc.text("Diagnostic Radiology Report", this.pageWidth - this.margin, this.currentY + 12, {
      align: "right",
    });

    this.currentY += 22;
    this.doc.setDrawColor(BORDER_COLOR);
    this.doc.setLineWidth(0.75);
    this.doc.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 18;
  }

  private renderMetadataGrid(): void {
    const p: PatientProfile | undefined = this.study.patientProfile;
    const ageField: ProfileField<number> | undefined =
      p?.age ?? (this.study.age !== undefined ? { value: this.study.age, source: "source" } : undefined);
    const sexField: ProfileField<"M" | "F" | "Other"> | undefined =
      p?.sex ?? (this.study.sex !== undefined ? { value: this.study.sex, source: "source" } : undefined);

    const metaLeft: [string, string][] = [
      ["Patient", this.study.patientAlias || "Anonymous"],
      ["Age / Sex", pairText(ageField, (v) => `${v}y`, sexField, (v) => SEX_LABEL[v])],
      ["Height / Weight", pairText(p?.heightCm, (v) => `${v} cm`, p?.weightKg, (v) => `${v} kg`)],
      ["BMI / BSA", pairText(p?.bmi, (v) => `${v.toFixed(1)} kg/m²`, p?.bsaM2, (v) => `${v.toFixed(2)} m²`)],
      ["MRN / Study ID", this.study.studyId],
    ];

    const bodyPartStr = this.study.bodyRegion ?? "Examination";
    const dateStr = this.study.date ? formatDateTime(this.study.date) : "Not available";
    const priorityStr = (this.study.priority ?? "routine").toUpperCase();
    const statusStr = (this.study.report?.status ?? this.study.status ?? "in-review").toUpperCase().replace("-", " ");
    const seriesList = this.study.series ?? [];
    const totalSlices = seriesList.reduce((acc, s) => acc + (s.sliceCount || 1), 0);

    const metaRight: [string, string][] = [
      ["Modality", `${this.study.modality ?? "CT"} — ${bodyPartStr}`],
      ["Study Date", dateStr],
      ["Priority", priorityStr],
      ["Status", statusStr],
      ["Series Count", `${seriesList.length} Series (${totalSlices} total slices)`],
    ];

    const colGap = 16;
    const colWidth = (this.contentWidth - colGap) / 2;
    const labelWidth = 76;
    const valueWidth = colWidth - labelWidth;

    const maxRows = Math.max(metaLeft.length, metaRight.length);
    for (let i = 0; i < maxRows; i++) {
      const left = metaLeft[i];
      const right = metaRight[i];

      const leftLines = left ? this.doc.splitTextToSize(left[1] || "—", valueWidth) : [];
      const rightLines = right ? this.doc.splitTextToSize(right[1] || "—", valueWidth) : [];
      const rowLines = Math.max(leftLines.length, rightLines.length, 1);
      const rowHeight = rowLines * 12 + 4;

      this.ensureSpace(rowHeight);

      // Left Column
      if (left) {
        const x = this.margin;
        this.doc.setTextColor(INK_MUTED);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(8);
        this.doc.text(left[0].toUpperCase(), x, this.currentY + 9);

        this.doc.setTextColor(INK_PRIMARY);
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(8.5);
        leftLines.forEach((line: string, idx: number) => {
          this.doc.text(line, x + labelWidth, this.currentY + 9 + idx * 12);
        });
      }

      // Right Column
      if (right) {
        const x = this.margin + colWidth + colGap;
        this.doc.setTextColor(INK_MUTED);
        this.doc.setFont("helvetica", "bold");
        this.doc.setFontSize(8);
        this.doc.text(right[0].toUpperCase(), x, this.currentY + 9);

        this.doc.setTextColor(INK_PRIMARY);
        this.doc.setFont("helvetica", "normal");
        this.doc.setFontSize(8.5);
        rightLines.forEach((line: string, idx: number) => {
          this.doc.text(line, x + labelWidth, this.currentY + 9 + idx * 12);
        });
      }

      this.currentY += rowHeight;
    }

    this.currentY += 10;
    this.doc.setDrawColor(BORDER_COLOR);
    this.doc.setLineWidth(0.5);
    this.doc.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 16;
  }

  private renderAiBanner(): void {
    if (!this.study.report.aiAssisted) return;

    const disclaimer =
      "AI-ASSISTED CLINICAL DRAFT — Contains automated organ volumetrics and lesion detections. Must be formally reviewed, verified, and signed by a licensed radiologist before clinical intervention.";
    const textWidth = this.contentWidth - 24;
    const lines: string[] = this.doc.splitTextToSize(disclaimer, textWidth);
    const boxHeight = lines.length * 11 + 16;

    this.ensureSpace(boxHeight + 8);

    this.doc.setFillColor(BG_WARNING);
    this.doc.roundedRect(this.margin, this.currentY, this.contentWidth, boxHeight, 3, 3, "F");

    this.doc.setTextColor(INK_WARNING);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(8);

    lines.forEach((line, idx) => {
      this.doc.text(line, this.margin + 12, this.currentY + 12 + idx * 11);
    });

    this.currentY += boxHeight + 14;
  }

  private renderSection(title: string, content: string | undefined): void {
    const text = (content || "—").trim();
    if (!text && text !== "—") return;

    this.ensureSpace(36); // Title + bar + at least 2 lines of text

    // Section Title Bar
    this.doc.setFillColor(ACCENT_PRIMARY);
    this.doc.rect(this.margin, this.currentY + 1, 3, 11, "F");

    this.doc.setTextColor(INK_PRIMARY);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.text(title.toUpperCase(), this.margin + 8, this.currentY + 10);
    this.currentY += 16;

    this.doc.setTextColor(INK_SECONDARY);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);

    const lines: string[] = this.doc.splitTextToSize(text, this.contentWidth);
    for (const line of lines) {
      this.ensureSpace(13);
      this.doc.text(line, this.margin, this.currentY);
      this.currentY += 13;
    }

    this.currentY += 12;
  }

  private renderFindingsTable(): void {
    const findings: Finding[] = this.study.findings || [];
    if (findings.length === 0) return;

    this.ensureSpace(42);
    this.doc.setFillColor(ACCENT_PRIMARY);
    this.doc.rect(this.margin, this.currentY + 1, 3, 11, "F");

    this.doc.setTextColor(INK_PRIMARY);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10);
    this.doc.text("STRUCTURED CLINICAL FINDINGS & OBSERVATIONS", this.margin + 8, this.currentY + 10);
    this.currentY += 16;

    const colWidths = {
      label: 140,
      location: 110,
      slice: 80,
      status: 86,
      confidence: 100,
    };

    const printHeader = () => {
      this.doc.setFillColor(BG_LIGHT);
      this.doc.rect(this.margin, this.currentY, this.contentWidth, 18, "F");
      this.doc.setDrawColor(BORDER_COLOR);
      this.doc.setLineWidth(0.5);
      this.doc.line(this.margin, this.currentY + 18, this.margin + this.contentWidth, this.currentY + 18);

      this.doc.setTextColor(INK_MUTED);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(8);

      let x = this.margin + 6;
      this.doc.text("FINDING / LESION", x, this.currentY + 12);
      x += colWidths.label;
      this.doc.text("LOCATION", x, this.currentY + 12);
      x += colWidths.location;
      this.doc.text("SLICE", x, this.currentY + 12);
      x += colWidths.slice;
      this.doc.text("STATUS", x, this.currentY + 12);
      x += colWidths.status;
      this.doc.text("CONFIDENCE", x, this.currentY + 12);

      this.currentY += 19;
    };

    printHeader();

    findings.forEach((f, idx) => {
      const labelLines = this.doc.splitTextToSize(f.label || "Diagnostic Finding", colWidths.label - 12);
      const locLines = this.doc.splitTextToSize(f.location || "Parenchymal", colWidths.location - 12);
      const sliceText = `Slice ${f.sliceIndex + 1}`;
      const statusText = (f.status || "unreviewed").toUpperCase();
      const confText = f.confidence > 0 ? `${f.confidence}% (${f.band || "AI"})` : "Radiologist";

      const maxLines = Math.max(labelLines.length, locLines.length, 1);
      const rowHeight = maxLines * 12 + 8;

      if (this.currentY + rowHeight > this.bottomLimit) {
        this.addNewPage();
        printHeader();
      }

      if (idx % 2 === 1) {
        this.doc.setFillColor("#F8FAFC");
        this.doc.rect(this.margin, this.currentY, this.contentWidth, rowHeight, "F");
      }

      this.doc.setDrawColor("#E2E8F0");
      this.doc.setLineWidth(0.5);
      this.doc.line(this.margin, this.currentY + rowHeight, this.margin + this.contentWidth, this.currentY + rowHeight);

      let x = this.margin + 6;
      this.doc.setTextColor(INK_PRIMARY);
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(8.5);
      labelLines.forEach((line: string, i: number) => {
        this.doc.text(line, x, this.currentY + 10 + i * 12);
      });

      x += colWidths.label;
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(INK_SECONDARY);
      locLines.forEach((line: string, i: number) => {
        this.doc.text(line, x, this.currentY + 10 + i * 12);
      });

      x += colWidths.location;
      this.doc.text(sliceText, x, this.currentY + 10);

      x += colWidths.slice;
      this.doc.setFont("helvetica", "bold");
      this.doc.setTextColor(f.status === "accepted" ? INK_SUCCESS : INK_MUTED);
      this.doc.text(statusText, x, this.currentY + 10);

      x += colWidths.status;
      this.doc.setFont("helvetica", "normal");
      this.doc.setTextColor(INK_SECONDARY);
      this.doc.text(confText, x, this.currentY + 10);

      this.currentY += rowHeight;
    });

    this.currentY += 14;
  }

  private renderSignatureBlock(): void {
    // Keep entire signature block atomic (never split)
    this.ensureSpace(90);

    this.doc.setDrawColor(BORDER_COLOR);
    this.doc.setLineWidth(0.5);
    this.doc.line(this.margin, this.currentY, this.pageWidth - this.margin, this.currentY);
    this.currentY += 16;

    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(INK_PRIMARY);
    this.doc.text("REPORT SIGN-OFF & ATTESTATION", this.margin, this.currentY);
    this.currentY += 14;

    const isApproved = this.study.report.status === "approved";
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.setTextColor(isApproved ? INK_SUCCESS : INK_MUTED);
    this.doc.text(
      isApproved
        ? "APPROVED — Signed Electronically via Authenticated Session"
        : `STATUS: ${this.study.report.status.toUpperCase().replace("-", " ")} — Pending Formal Attestation`,
      this.margin,
      this.currentY
    );
    this.currentY += 15;

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(INK_SECONDARY);

    if (this.study.report.reviewer) {
      this.doc.text(
        `Attending Radiologist: ${this.study.report.reviewer.name} (${this.study.report.reviewer.role})`,
        this.margin,
        this.currentY
      );
      this.currentY += 13;
    }

    if (this.study.report.approvedAt) {
      this.doc.text(
        `Attested Date/Time: ${formatDateTime(this.study.report.approvedAt)}`,
        this.margin,
        this.currentY
      );
      this.currentY += 13;
    }

    this.doc.text(`Report Version: v${this.study.report.version || 1} · Meridian PACS Compliant`, this.margin, this.currentY);
  }

  private renderFooters(): void {
    const totalPages = this.doc.getNumberOfPages();
    const exportedAt = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    for (let p = 1; p <= totalPages; p++) {
      this.doc.setPage(p);

      this.doc.setDrawColor(BORDER_COLOR);
      this.doc.setLineWidth(0.5);
      this.doc.line(this.margin, this.pageHeight - 38, this.pageWidth - this.margin, this.pageHeight - 38);

      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(INK_MUTED);

      this.doc.text(
        "Confidential Medical Record · Generated by Meridian / Vedh Medical Imaging Diagnostic Workstation",
        this.margin,
        this.pageHeight - 26
      );

      this.doc.text(
        `Exported: ${exportedAt} · Page ${p} of ${totalPages}`,
        this.pageWidth - this.margin,
        this.pageHeight - 26,
        { align: "right" }
      );
    }
  }

  public buildDoc(): jsPDF {
    const p: PatientProfile | undefined = this.study.patientProfile;

    // 1. Page 1 Header
    this.renderLetterhead();

    // 2. Patient & Study Metadata Grid
    this.renderMetadataGrid();

    // 3. AI Assisted Banner
    this.renderAiBanner();

    // 4. Clinical Information
    const sections = this.study.report?.sections;
    if (sections?.clinicalInformation?.trim()) {
      this.renderSection("Clinical Information", sections.clinicalInformation);
    }

    // 5. Relevant History
    if (p?.history && p.history.value.length > 0) {
      this.renderSection(
        p.history.source === "simulated" ? "Relevant History (Simulated Values)" : "Relevant History",
        p.history.value.map((h) => `• ${h}`).join("\n")
      );
    }

    // 6. Technique
    if (sections?.technique?.trim()) {
      this.renderSection("Technique", sections.technique);
    }

    // 7. Comparison
    if (sections?.comparison?.trim()) {
      this.renderSection("Comparison", sections.comparison);
    }

    // 8. Special Notes
    if (p?.notes?.value?.trim()) {
      this.renderSection(
        p.notes.source === "simulated" ? "Special Notes (Simulated Value)" : "Special Notes",
        p.notes.value
      );
    }

    // 9. Structured Findings Table (if findings exist)
    this.renderFindingsTable();

    // 10. Narrative Findings
    if (sections?.findings?.trim()) {
      this.renderSection("Findings (Narrative)", sections.findings);
    }

    // 11. Impression
    if (sections?.impression?.trim()) {
      this.renderSection("Impression", sections.impression);
    }

    // 12. Signature Block
    this.renderSignatureBlock();

    // 13. Running Footers
    this.renderFooters();

    return this.doc;
  }

  public buildAndSave(): void {
    const doc = this.buildDoc();
    doc.save(`${this.study.studyId}-report.pdf`);
  }
}

/**
 * Builds a professional clinical report PDF jsPDF document for a study.
 * Can be saved, exported to buffer/blob, or tested programmatically.
 */
export function buildStudyReportPDFDoc(study: Study): jsPDF {
  const builder = new FlowReportBuilder(study);
  return builder.buildDoc();
}

/**
 * Generates a professional clinical report PDF for a study and triggers a
 * client-side download.
 */
export function exportStudyReportPDF(study: Study): void {
  const builder = new FlowReportBuilder(study);
  builder.buildAndSave();
}
