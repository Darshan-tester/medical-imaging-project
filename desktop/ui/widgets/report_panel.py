"""The report panel that sits beside the viewer (§23).

Port of ``components/report/RadiologyReportPanel.tsx``, and it inherits that
component's one hard rule: the panel shows the **source** report or it shows
nothing.  ``core.reports.resolve_report_panel_content`` is what enforces it - for
a dataset study, and every study in this application is one, a missing report
resolves to ``None`` and the panel says
"Radiology report not available for this study." rather than falling back to
Meridian's own editable draft.  Presenting the application's text as the
radiologist's would be the fabrication §10 forbids.

The section list, its order and its labels all come from ``core.reports``, so the
desktop panel cannot drift from the web one by editing a string here.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QScrollArea,
                               QSizePolicy, QVBoxLayout, QWidget)

from ...core import reports as reports_mod
from .. import theme
from .badges import Badge


class ReportPanel(QWidget):
    """Title, source badge, and the sections the source report actually filled.

    Rebuilds its body on every study rather than keeping one label per section
    and blanking the unused ones, because an empty "Comparison" heading reads as
    "no comparison was made" when the truth is that the report did not have that
    section at all.
    """

    def __init__(self, theme_name: str = "light", parent=None) -> None:
        super().__init__(parent)
        self._theme = theme_name
        self._report: reports_mod.SourceReport | None = None

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(8)

        header = QHBoxLayout()
        header.setContentsMargins(0, 0, 0, 0)
        header.setSpacing(8)
        self._title = QLabel(reports_mod.REPORT_PANEL_TITLE, self)
        self._title.setProperty("role", "h2")
        header.addWidget(self._title)
        header.addStretch(1)
        self._source = Badge("", "neutral", theme_name, self)
        self._source.setVisible(False)
        header.addWidget(self._source)
        outer.addLayout(header)

        self._scroll = QScrollArea(self)
        self._scroll.setWidgetResizable(True)
        self._scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._body = QWidget(self._scroll)
        self._layout = QVBoxLayout(self._body)
        self._layout.setContentsMargins(0, 0, 6, 0)
        self._layout.setSpacing(10)
        self._layout.addStretch(1)
        self._scroll.setWidget(self._body)
        outer.addWidget(self._scroll, 1)
        self.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Expanding)
        self.set_report(None)
