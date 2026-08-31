import { jsPDF } from "jspdf";
import { Study } from "./types";
import { formatDateTime } from "./utils";

const INK = "#0F172A";
const MUTED = "#55677A";
const RULE = "#D7DFE7";
const ACCENT = "#1D4ED8"; // hospital blue letterhead accent

/**
 * Generates a professional clinical report PDF for a study and triggers a
 * client-side download. This runs entirely in the browser — no server round
 * trip — using the study's current report state (sections + approval info).
 */
export function exportStudyReportPDF(study: Study) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 54;
  let y = 56;

  // --- Letterhead -----------------------------------------------------
  doc.setFillColor(ACCENT);
  doc.rect(0, 0, pageWidth, 6, "F");

  doc.setTextColor(INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MERIDIAN / SCANLAB AI", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("Diagnostic Imaging Report", pageWidth - margin, y, { align: "right" });

  y += 10;
  doc.setDrawColor(RULE);
  doc.line(margin, y, pageWidth - margin, y);
  y += 26;

  // --- Patient / study metadata ----------------------------------------
  const metaLeft: [string, string][] = [
    ["Patient", study.patientAlias],
    ["Age / Sex", study.age !== undefined || study.sex ? `${study.age !== undefined ? `${study.age}y` : "Not available"} / ${study.sex ?? "Not available"}` : "Not available"],
    ["Study ID", study.studyId],
  ];
  const metaRight: [string, string][] = [
    ["Modality", `${study.modality} — ${study.bodyRegion ?? "Not available"}`],
    ["Study Date", study.date ? formatDateTime(study.date) : "Not available"],
    ["Priority", study.priority.toUpperCase()],
  ];

  doc.setFontSize(10);
  const colGap = (pageWidth - margin * 2) / 2;
  metaLeft.forEach(([label, value], i) => {
    const rowY = y + i * 16;
    doc.setTextColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(label.toUpperCase(), margin, rowY);
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.text(value, margin + 110, rowY);
  });
  metaRight.forEach(([label, value], i) => {
    const rowY = y + i * 16;
    const x = margin + colGap;
    doc.setTextColor(MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(label.toUpperCase(), x, rowY);
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.text(value, x + 110, rowY);
  });

  y += metaLeft.length * 16 + 20;
  doc.setDrawColor(RULE);
  doc.line(margin, y, pageWidth - margin, y);
  y += 28;

  // --- AI disclaimer -----------------------------------------------------
  if (study.report.aiAssisted) {
    doc.setFillColor("#FBF5EB");
    doc.roundedRect(margin, y - 14, pageWidth - margin * 2, 34, 4, 4, "F");
    doc.setTextColor("#36260C");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      "AI-ASSISTED DRAFT — requires review and approval by a licensed radiologist before clinical use.",
      margin + 12,
      y + 6,
      { maxWidth: pageWidth - margin * 2 - 24 }
    );
    y += 40;
  }

  const section = (title: string, body: string) => {
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(title.toUpperCase(), margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor("#1B2836");
    const lines = doc.splitTextToSize(body || "—", pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 13.5 + 22;
  };

  section("Clinical Information", study.report.sections.clinicalInformation);
  section("Technique", study.report.sections.technique);
  section("Findings", study.report.sections.findings);
  section("Impression", study.report.sections.impression);

  // --- Signature / approval block ----------------------------------------
  doc.setDrawColor(RULE);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text("REPORT STATUS", margin, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(study.report.status === "approved" ? "#15803D" : MUTED);
  doc.text(
    study.report.status === "approved" ? "APPROVED — Electronically signed" : study.report.status.toUpperCase().replace("-", " "),
    margin,
    y
  );
  y += 18;

  doc.setTextColor("#1B2836");
  if (study.report.reviewer) {
    doc.text(`Reviewing Radiologist: ${study.report.reviewer.name} (${study.report.reviewer.role})`, margin, y);
    y += 16;
  }
  if (study.report.approvedAt) {
    doc.text(`Approved: ${formatDateTime(study.report.approvedAt)}`, margin, y);
    y += 16;
  }
  doc.text(`Report Version: v${study.report.version}`, margin, y);

  // --- Footer -----------------------------------------------------------
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(
    "Generated by Meridian / ScanLab AI — demo environment. Synthetic data. Not a real clinical document.",
    margin,
    pageHeight - 34
  );
  doc.text(`Exported ${new Date().toLocaleString()}`, pageWidth - margin, pageHeight - 34, { align: "right" });

  doc.save(`${study.studyId}-report.pdf`);
}
