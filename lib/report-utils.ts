import { SourceReport, Study } from "./types";

export interface ParsedReportSections {
  clinicalInformation?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  comparison?: string;
}

/**
 * Normalize report text without changing its actual content.
 */
function normalizeReportText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

/**
 * Normalize a section heading for comparison.
 *
 * Examples:
 *   "CLINICAL INFORMATION:"
 *   "Clinical Information"
 *   "CLINICAL INFORMATION :"
 *
 * all become:
 *   "CLINICAL INFORMATION"
 */
function normalizeHeading(value: string): string {
  return value
    .trim()
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Detect one of the known radiology report headings.
 *
 * The parser deliberately supports common variations:
 *
 * CLINICAL INFORMATION
 * CLINICAL HISTORY
 * INDICATION
 * TECHNIQUE
 * FINDINGS
 * IMPRESSION
 * CONCLUSION
 * COMPARISON
 *
 * A heading may have:
 *   :
 *   -
 *   =
 *   whitespace
 */
function headingType(
  line: string
):
  | "clinicalInformation"
  | "technique"
  | "findings"
  | "impression"
  | "comparison"
  | undefined {
  const cleaned = normalizeHeading(line);

  const compact = cleaned
    .replace(/[^A-Z0-9 ]/g, "")
    .trim();

  if (
    compact === "CLINICAL INFORMATION" ||
    compact === "CLINICAL HISTORY" ||
    compact === "HISTORY" ||
    compact === "INDICATION" ||
    compact === "CLINICAL INDICATION"
  ) {
    return "clinicalInformation";
  }

  if (
    compact === "TECHNIQUE" ||
    compact === "TECHNICAL DETAILS" ||
    compact === "PROCEDURE" ||
    compact === "PROTOCOL"
  ) {
    return "technique";
  }

  if (
    compact === "FINDINGS" ||
    compact === "FINDING"
  ) {
    return "findings";
  }

  if (
    compact === "IMPRESSION" ||
    compact === "CONCLUSION" ||
    compact === "CONCLUSIONS"
  ) {
    return "impression";
  }

  if (
    compact === "COMPARISON" ||
    compact === "COMPARISONS"
  ) {
    return "comparison";
  }

  return undefined;
}

/**
 * Remove heading decoration such as:
 *
 * TECHNIQUE:
 * TECHNIQUE -
 * TECHNIQUE =
 *
 * while preserving the actual report body.
 */
function cleanSectionText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse a radiology report into Meridian's common report sections.
 *
 * Important:
 * - Never invents text.
 * - Never moves Technique or Impression into Findings.
 * - Missing sections remain undefined.
 * - The original report text remains untouched elsewhere.
 */
export function parseReportSections(
  text?: string | null
): ParsedReportSections {
  if (!text?.trim()) {
    return {};
  }

  const normalized = normalizeReportText(text);

  const lines = normalized.split("\n");

  const sections: Record<
    string,
    string[]
  > = {};

  let current:
    | "clinicalInformation"
    | "technique"
    | "findings"
    | "impression"
    | "comparison"
    | undefined;

  for (const originalLine of lines) {
    const line = originalLine.trim();

    if (!line) {
      if (current) {
        sections[current] ??= [];
        sections[current].push("");
      }

      continue;
    }

    /*
     * Standard heading:
     *
     * FINDINGS
     * FINDINGS:
     * FINDINGS -
     * FINDINGS =
     */
    const detected = headingType(line);

    if (detected) {
      current = detected;
      sections[current] ??= [];
      continue;
    }

    /*
     * Some datasets use headings with surrounding decoration:
     *
     * ----- FINDINGS -----
     * === IMPRESSION ===
     *
     * Strip decoration and test again.
     */
    const undecorated = line
      .replace(/^[\s\-_=*#|]+/, "")
      .replace(/[\s\-_=*#|]+$/, "")
      .trim();

    const decoratedDetected =
      headingType(undecorated);

    if (decoratedDetected) {
      current = decoratedDetected;
      sections[current] ??= [];
      continue;
    }

    /*
     * Some reports put the heading and first content
     * on the same line:
     *
     * TECHNIQUE: MRI brain without contrast
     *
     * FINDINGS: No acute abnormality.
     */
    const inlineMatch =
      line.match(
        /^(CLINICAL INFORMATION|CLINICAL HISTORY|INDICATION|CLINICAL INDICATION|HISTORY|TECHNIQUE|TECHNICAL DETAILS|PROCEDURE|PROTOCOL|FINDINGS|FINDING|IMPRESSION|CONCLUSION|CONCLUSIONS|COMPARISON|COMPARISONS)\s*[:：\-]\s*(.*)$/i
      );

    if (inlineMatch) {
      const detectedInline =
        headingType(inlineMatch[1]);

      if (detectedInline) {
        current = detectedInline;
        sections[current] ??= [];

        const remainder =
          inlineMatch[2].trim();

        if (remainder) {
          sections[current].push(remainder);
        }

        continue;
      }
    }

    /*
     * Normal report body.
     */
    if (current) {
      sections[current] ??= [];
      sections[current].push(originalLine);
    }
  }

  const result: ParsedReportSections = {};

  const clinicalInformation =
    cleanSectionText(
      sections.clinicalInformation ?? []
    );

  const technique =
    cleanSectionText(
      sections.technique ?? []
    );

  const findings =
    cleanSectionText(
      sections.findings ?? []
    );

  const impression =
    cleanSectionText(
      sections.impression ?? []
    );

  const comparison =
    cleanSectionText(
      sections.comparison ?? []
    );

  if (clinicalInformation) {
    result.clinicalInformation =
      clinicalInformation;
  }

  if (technique) {
    result.technique =
      technique;
  }

  if (findings) {
    result.findings =
      findings;
  }

  if (impression) {
    result.impression =
      impression;
  }

  if (comparison) {
    result.comparison =
      comparison;
  }

  /*
   * Important fallback:
   *
   * If the source report contains no recognized section
   * headings at all, preserve it as Findings.
   *
   * This is only for genuinely unstructured reports.
   *
   * If headings ARE recognized, we never duplicate the
   * full report into Findings.
   */
  const hasStructuredSection =
    Boolean(
      result.clinicalInformation ||
      result.technique ||
      result.findings ||
      result.impression ||
      result.comparison
    );

  if (!hasStructuredSection) {
    result.findings = normalized;
  }

  return result;
}

/**
 * For a real dataset study, `study.sourceReport` is the only report
 * this panel is allowed to display.
 *
 * When no source report was matched, a real dataset study must NOT
 * receive a fabricated report.
 *
 * For mock/uploaded studies, the working report is the only report
 * available, so a read-only mirror is acceptable.
 */
export function resolveReportPanelContent(
  study: Study
): SourceReport | undefined {
  if (study.sourceReport) {
    return study.sourceReport;
  }

  if (study.datasetSource) {
    return undefined;
  }

  const sections =
    study.report.sections;

  if (
    !sections.clinicalInformation &&
    !sections.technique &&
    !sections.findings &&
    !sections.impression
  ) {
    return undefined;
  }

  return {
    source: "Meridian",

    clinicalInformation:
      sections.clinicalInformation ||
      undefined,

    technique:
      sections.technique ||
      undefined,

    findings:
      sections.findings ||
      undefined,

    impression:
      sections.impression ||
      undefined,

    text: [
      sections.clinicalInformation,
      sections.technique,
      sections.findings,
      sections.impression,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}