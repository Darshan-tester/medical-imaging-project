import { jsPDF } from "jspdf";
import { Study } from "./types";
import { PatientProfile, ProfileField } from "./patient-profile";
import { formatDateTime } from "./utils";

const INK = "#0F172A";
const MUTED = "#55677A";
const RULE = "#D7DFE7";
const ACCENT = "#1D4ED8"; // hospital blue letterhead accent

const SEX_LABEL: Record<"M" | "F" | "Other", string> = { M: "Male", F: "Female", Other: "Other" };

/**
 * Renders two related profile fields as one "a / b" line, with a single
 * "(demo)" marker if either side was generated.
 *
 * The badge the UI shows next to a generated value does not survive an export,
 * and an unmarked height in a document headed "Diagnostic Imaging Report" is
 * exactly the kind of number that gets believed. So the marker travels with it.
 */
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
  doc.text("MERIDIAN / VEDH MEDICAL IMAGING", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("Diagnostic Imaging Report", pageWidth - margin, y, { align: "right" });

  y += 10;
  doc.setDrawColor(RULE);
  doc.line(margin, y, pageWidth - margin, y);
  y += 26;

  // --- Patient / study metadata ----------------------------------------
  /*
   * Read from the profile first, for the same reason the summary card does: the
   * profile is the only thing that records where a value came from. `study.age`
   * / `study.sex` are the fallback for a study built without one.
   */
  const p: PatientProfile | undefined = study.patientProfile;
  const ageField: ProfileField<number> | undefined =
    p?.age ?? (study.age !== undefined ? { value: study.age, source: "source" } : undefined);
  const sexField: ProfileField<"M" | "F" | "Other"> | undefined =
    p?.sex ?? (study.sex !== undefined ? { value: study.sex, source: "source" } : undefined);

  const metaLeft: [string, string][] = [
    ["Patient", study.patientAlias],
    ["Age / Sex", pairText(ageField, (v) => `${v}y`, sexField, (v) => SEX_LABEL[v])],
    ["Height / Weight", pairText(p?.heightCm, (v) => `${v} cm`, p?.weightKg, (v) => `${v} kg`)],
    ["BMI / BSA", pairText(p?.bmi, (v) => `${v.toFixed(1)} kg/m²`, p?.bsaM2, (v) => `${v.toFixed(2)} m²`)],
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

  /*
   * Lines are written one at a time against a bottom margin so a long section
   * continues onto a second page instead of running off the first. The report
   * body is editable and now carries history and notes as well, so overflow is
   * ordinary rather than exceptional.
   */
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottom = pageHeight - 56;

  const section = (title: string, body: string) => {
    if (y + 16 > bottom) {
      doc.addPage();
      y = 56;
    }
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(title.toUpperCase(), margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor("#1B2836");
    const lines: string[] = doc.splitTextToSize(body || "—", pageWidth - margin * 2);
    for (const line of lines) {
      if (y > bottom) {
        doc.addPage();
        y = 56;
      }
      doc.text(line, margin, y);
      y += 13.5;
    }
    y += 22;
  };

  section("Clinical Information", study.report.sections.clinicalInformation);
  if (p?.history && p.history.value.length > 0) {
    section(
      p.history.source === "simulated" ? "Relevant History (demo values)" : "Relevant History",
      p.history.value.map((h) => `• ${h}`).join("\n")
    );
  }
  section("Technique", study.report.sections.technique);
  if (study.report.sections.comparison && study.report.sections.comparison.trim().length > 0) {
    section("Comparison", study.report.sections.comparison);
  }
  if (p?.notes) {
    section(p.notes.source === "simulated" ? "Special Notes (demo value)" : "Special Notes", p.notes.value);
  }
  section("Findings", study.report.sections.findings);
  section("Impression", study.report.sections.impression);

  // --- Signature / approval block ----------------------------------------
  // Kept whole: a signature block split across a page break reads as if the
  // report were approved by nobody.
  if (y + 90 > bottom) {
    doc.addPage();
    y = 56;
  }
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
  // Stamped on every page, not just the last one — a page that escapes carrying
  // no demo-environment notice is the one that causes trouble.
  const exported = new Date().toLocaleString();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(
      "Generated by Meridian / Vedh Medical Imaging — demo environment. Synthetic data. Not a real clinical document.",
      margin,
      pageHeight - 34
    );
    doc.text(`Exported ${exported} · Page ${i} of ${pages}`, pageWidth - margin, pageHeight - 34, { align: "right" });
  }

  doc.save(`${study.studyId}-report.pdf`);
}
