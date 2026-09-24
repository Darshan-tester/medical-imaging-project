"""Report text handling for the desktop application.

A port of ``lib/report-utils.ts`` (``parseReportSections``,
``resolveReportPanelContent``) and the report half of
``lib/dataset/to-app-study.ts`` (``toWorkingReport``, ``splitTechniqueTail``),
kept deliberately line-for-line faithful: the same headings are recognised, the
same fallbacks apply, and the same characters come out.  A radiologist comparing
the desktop against the web app must not see the report split differently.

Nothing here writes report text.  Sections are *attributed*, never authored: if
the source did not say something, the result is empty and the UI says so.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: What the panel shows when a study has no source report.  Both strings are the
#: web app's own (``components/report/RadiologyReportPanel.tsx``), so the two
#: front ends say the same thing about the same study.
REPORT_UNAVAILABLE_TITLE = "Radiology report not available for this study."
REPORT_UNAVAILABLE_BODY = "No source report was matched to this study."

#: The compact form, for a table cell or a badge where the sentence above will
#: not fit.  Still never a fabricated report.
REPORT_UNAVAILABLE_SHORT = "Report unavailable"

#: Used wherever a value is genuinely absent (matches the web app's shared
#: ``NOT_AVAILABLE``), so an empty field reads as unknown rather than as zero.
NOT_AVAILABLE = "Not available"

REPORT_PANEL_TITLE = "Radiology Report"

#: Panel order, and the labels shown above each block.  Same list, same order as
#: ``SECTIONS`` in ``RadiologyReportPanel.tsx``.
SECTION_LABELS: tuple[tuple[str, str], ...] = (
    ("clinical_information", "Clinical Information"),
    ("indication", "Indication"),
    ("technique", "Technique"),
    ("findings", "Findings"),
    ("impression", "Impression"),
    ("comparison", "Comparison"),
)

#: JavaScript's ``\s`` and ``String.prototype.trim`` cover exactly this set.
#: Python's own ``\s`` and ``str.strip()`` cover a slightly different one (they
#: add U+001C..U+001F and U+0085, and drop U+FEFF), and report prose is shown
#: verbatim, so the set is spelled out rather than inherited.
JS_WS = (
    "\t\n\v\f\r           "
    "       　﻿"
)
_WS_BODY = "".join("\\" + c if c in "^]\\-" else c for c in JS_WS)
_WS_CLASS = "[" + _WS_BODY + "]"
_WS_RUN = re.compile(_WS_CLASS + "+")
_TRAILING_COLON = re.compile(r"[:：]" + _WS_CLASS + r"*$")
_NON_HEADING = re.compile(r"[^A-Z0-9 ]")
_BLANK_RUN = re.compile(r"\n{3,}")
_DECORATION_HEAD = re.compile("^[" + _WS_BODY + r"\-_=*#|]+")
_DECORATION_TAIL = re.compile("[" + _WS_BODY + r"\-_=*#|]+$")

#: Same alternatives, same order as the inline regex in ``report-utils.ts``.
_INLINE = re.compile(
    r"^(CLINICAL INFORMATION|CLINICAL HISTORY|INDICATION|CLINICAL INDICATION|HISTORY"
    r"|TECHNIQUE|TECHNICAL DETAILS|PROCEDURE|PROTOCOL|FINDINGS|FINDING|IMPRESSION"
    r"|CONCLUSION|CONCLUSIONS|COMPARISON|COMPARISONS)"
    + _WS_CLASS + r"*[:：\-]" + _WS_CLASS + r"*(.*)$",
    re.IGNORECASE,
)

CLINICAL_INFORMATION = "clinical_information"
TECHNIQUE = "technique"
FINDINGS = "findings"
IMPRESSION = "impression"
COMPARISON = "comparison"

_HEADINGS: dict[str, str] = {
    "CLINICAL INFORMATION": CLINICAL_INFORMATION,
    "CLINICAL HISTORY": CLINICAL_INFORMATION,
    "HISTORY": CLINICAL_INFORMATION,
    "INDICATION": CLINICAL_INFORMATION,
    "CLINICAL INDICATION": CLINICAL_INFORMATION,
    "TECHNIQUE": TECHNIQUE,
    "TECHNICAL DETAILS": TECHNIQUE,
    "PROCEDURE": TECHNIQUE,
    "PROTOCOL": TECHNIQUE,
    "FINDINGS": FINDINGS,
    "FINDING": FINDINGS,
    "IMPRESSION": IMPRESSION,
    "CONCLUSION": IMPRESSION,
    "CONCLUSIONS": IMPRESSION,
    "COMPARISON": COMPARISON,
    "COMPARISONS": COMPARISON,
}

SECTION_KEYS = (CLINICAL_INFORMATION, TECHNIQUE, FINDINGS, IMPRESSION, COMPARISON)


def js_trim(value: str) -> str:
    return value.strip(JS_WS)


def normalize_report_text(text: str) -> str:
    """Line endings and hard spaces only - not a word of the report changes."""
    return js_trim(text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " "))


def normalize_heading(value: str) -> str:
    """``"CLINICAL INFORMATION :"`` and ``"Clinical Information"`` alike."""
    return _WS_RUN.sub(" ", _TRAILING_COLON.sub("", js_trim(value))).upper()


def heading_type(line: str) -> str | None:
    """The section a line names, if it names one at all."""
    compact = js_trim(_NON_HEADING.sub("", normalize_heading(line)))
    return _HEADINGS.get(compact)


def clean_section_text(lines: list[str]) -> str:
    return js_trim(_BLANK_RUN.sub("\n\n", "\n".join(lines)))


def parse_report_sections(text: str | None) -> dict[str, str]:
    """Split a report into Meridian's sections.

    Never invents text, never moves Technique or Impression into Findings, and
    leaves a section absent rather than guessing at it.  A report with no
    recognised heading anywhere is preserved whole as Findings - that is the one
    fallback, and it duplicates nothing.
    """
    if not text or not js_trim(text):
        return {}

    normalized = normalize_report_text(text)
    sections: dict[str, list[str]] = {}
    current: str | None = None

    for original_line in normalized.split("\n"):
        line = js_trim(original_line)

        if not line:
            # A blank line inside a section is part of it; before the first
            # heading there is nothing to attribute it to.
            if current:
                sections.setdefault(current, []).append("")
            continue

        # FINDINGS / FINDINGS: / FINDINGS - / FINDINGS =
        detected = heading_type(line)
        if detected:
            current = detected
            sections.setdefault(current, [])
            continue

        # ----- FINDINGS ----- / === IMPRESSION ===
        undecorated = js_trim(_DECORATION_TAIL.sub("", _DECORATION_HEAD.sub("", line)))
        decorated = heading_type(undecorated)
        if decorated:
            current = decorated
            sections.setdefault(current, [])
            continue

        # TECHNIQUE: MRI brain without contrast
        inline = _INLINE.match(line)
        if inline:
            detected_inline = heading_type(inline.group(1))
            if detected_inline:
                current = detected_inline
                sections.setdefault(current, [])
                remainder = js_trim(inline.group(2))
                if remainder:
                    sections[current].append(remainder)
                continue

        # Report body. The untrimmed line, so indentation survives.
        if current:
            sections.setdefault(current, []).append(original_line)

    result = {key: clean_section_text(sections.get(key, [])) for key in SECTION_KEYS}
    result = {key: value for key, value in result.items() if value}
    if not result:
        result[FINDINGS] = normalized
    return result


def _is_digit_char(ch: str | None) -> bool:
    return ch is not None and "0" <= ch <= "9"


def split_technique_tail(technique: str) -> tuple[str, str] | None:
    """Split a technique block that has swallowed the report's own observations.

    Part of the MRI set is written as one paragraph that opens with a technique
    list - "Technique: Axial and sagittal T2, coronal T1, axial FLAIR. In the
    medial aspect of the frontal lobe ..." - and a section parser ends a section
    only at the next heading.  With no FINDINGS heading to stop at, the whole
    report lands under Technique and Findings comes out empty: an empty Findings
    panel, and nothing for the viewer to point at.

    The list ends at its first terminator - a full stop, a semicolon, or the
    colon that introduces the description - and what follows is what the
    radiologist observed.  Nothing is rewritten: the same characters are simply
    attributed to the section they were written for.

    Returns ``None`` when there is nothing substantial after the list, so a
    genuinely technique-only report is left alone.
    """
    text = js_trim(technique)

    for i, ch in enumerate(text):
        if ch not in ".;:":
            continue
        # "1.5 Tesla" and "7.5 x 4 x 6 cm" are not the end of anything.
        if ch == "." and _is_digit_char(text[i - 1] if i else None) and _is_digit_char(
            text[i + 1] if i + 1 < len(text) else None
        ):
            continue
        head = js_trim(text[: i + 1])
        tail = js_trim(text[i + 1 :])
        # Short tail: the report really is only a technique note. Leave it.
        return None if len(tail) < 80 else (head, tail)

    return None


@dataclass(frozen=True)
class SourceReport:
    """The dataset's own report, exactly as the source wrote it.

    Immutable by intent: this is the document the study arrived with, and the
    panel beside the viewer shows it verbatim.  Editing happens on the working
    report below, which is a separate object.
    """

    text: str = ""
    source: str | None = None
    clinical_information: str | None = None
    indication: str | None = None
    technique: str | None = None
    comparison: str | None = None
    findings: str | None = None
    impression: str | None = None

    @classmethod
    def from_row(cls, row) -> "SourceReport | None":
        """Build from a ``report`` table row, or ``None`` if there is no row.

        A row whose ``text`` is empty and whose every section is NULL is treated
        as no report at all, so the panel says so rather than showing a heading
        with nothing under it.
        """
        if row is None:
            return None
        report = cls(
            text=row["text"] or "",
            source=row["source"] or None,
            clinical_information=row["clinical_information"] or None,
            indication=row["indication"] or None,
            technique=row["technique"] or None,
            comparison=row["comparison"] or None,
            findings=row["findings"] or None,
            impression=row["impression"] or None,
        )
        return report if report.has_content else None

    @property
    def has_content(self) -> bool:
        return bool(js_trim(self.text) or self.present_sections())

    def present_sections(self) -> list[tuple[str, str]]:
        """``(label, text)`` for each section the source actually filled in.

        Panel order, from ``SECTION_LABELS``.
        """
        out = []
        for key, label in SECTION_LABELS:
            value = getattr(self, key, None)
            if value and js_trim(value):
                out.append((label, value))
        return out


@dataclass(frozen=True)
class WorkingReport:
    """Meridian's own editable report: the four sections the Report tab shows.

    ``status`` is ``"in-review"`` for a study that arrived with a report and
    ``"ai-draft"`` for one that did not - and in that second case every section
    is empty, because there is nothing to draft from.  ``ai_assisted`` is False
    throughout: no model has written any of this text.
    """

    status: str = "ai-draft"
    clinical_information: str = ""
    technique: str = ""
    findings: str = ""
    impression: str = ""
    ai_assisted: bool = False
    version: int = 1
    reviewer: str | None = None
    approved_at: str | None = None

    @property
    def has_content(self) -> bool:
        return bool(
            js_trim(self.clinical_information)
            or js_trim(self.technique)
            or js_trim(self.findings)
            or js_trim(self.impression)
        )

    def sections(self) -> list[tuple[str, str]]:
        return [
            ("Clinical Information", self.clinical_information),
            ("Technique", self.technique),
            ("Findings", self.findings),
            ("Impression", self.impression),
        ]


def to_working_report(source: SourceReport | None) -> WorkingReport:
    """Derive the editable report from the source one.

    The pipeline is the web app's, in the same order, for both MRI and CT:

        source report text -> parse_report_sections() -> the four sections shown

    Three cases, in the order they are tried.  The parser's own sections win.
    Failing that, sections the adapter had already structured are kept as they
    are - and Technique and Impression are never moved into Findings.  Failing
    both, a genuinely unstructured report is preserved whole under Findings,
    because there is no safe section to invent for it.
    """
    if source is None:
        return WorkingReport(status="ai-draft")

    parsed = parse_report_sections(source.text)

    # Mirrors the web app's `hasParsedSections`, which deliberately does not
    # count Comparison: a report whose only recognised heading is COMPARISON
    # falls through to the adapter's own structured fields below.
    has_parsed = bool(
        js_trim(parsed.get(CLINICAL_INFORMATION) or "")
        or js_trim(parsed.get(TECHNIQUE) or "")
        or js_trim(parsed.get(FINDINGS) or "")
        or js_trim(parsed.get(IMPRESSION) or "")
    )

    if has_parsed:
        technique = _first(parsed.get(TECHNIQUE), source.technique)
        findings = _first(parsed.get(FINDINGS), source.findings)
        impression = _first(parsed.get(IMPRESSION), source.impression)

        # Only when the parser produced neither Findings nor Impression: a report
        # with a real heading for either is used exactly as parsed.
        salvaged = (
            split_technique_tail(technique)
            if not js_trim(findings) and not js_trim(impression)
            else None
        )

        return WorkingReport(
            status="in-review",
            clinical_information=_first(
                parsed.get(CLINICAL_INFORMATION),
                source.clinical_information,
                source.indication,
            ),
            technique=salvaged[0] if salvaged else technique,
            findings=salvaged[1] if salvaged else findings,
            impression=impression,
        )

    # The adapter already supplied structured fields: keep them as they are.
    if any(
        js_trim(value or "")
        for value in (
            source.clinical_information,
            source.indication,
            source.technique,
            source.findings,
            source.impression,
        )
    ):
        return WorkingReport(
            status="in-review",
            clinical_information=_first(source.clinical_information, source.indication),
            technique=_first(source.technique),
            findings=_first(source.findings),
            impression=_first(source.impression),
        )

    # Completely unstructured free text. There is no safe section to invent, so
    # the original is preserved as Findings rather than being split up by guess.
    return WorkingReport(status="in-review", findings=source.text)


def _first(*values: str | None) -> str:
    """The first value that is not absent - JavaScript's ``??`` chain.

    Distinct from ``or``: an empty string is a value the source chose to give,
    and it stops the chain, exactly as it does in the web app.
    """
    for value in values:
        if value is not None:
            return value
    return ""


def resolve_report_panel_content(
    source: SourceReport | None,
    working: WorkingReport | None = None,
    dataset_source: str | None = None,
) -> SourceReport | None:
    """What the panel beside the viewer is allowed to display.

    For a dataset study - which every study in this application is - the source
    report is the only report there is.  When none was matched, the panel gets
    nothing and says so; it must never be handed the working report to show
    instead, because that would present Meridian's own text as the radiologist's.

    The working-report fallback below exists only for studies with no dataset
    behind them, and is kept so the two front ends stay one implementation.
    """
    if source is not None:
        return source
    if dataset_source:
        return None
    if working is None or not working.has_content:
        return None
    return SourceReport(
        source="Meridian",
        clinical_information=working.clinical_information or None,
        technique=working.technique or None,
        findings=working.findings or None,
        impression=working.impression or None,
        text="\n\n".join(
            part
            for part in (
                working.clinical_information,
                working.technique,
                working.findings,
                working.impression,
            )
            if part
        ),
    )
