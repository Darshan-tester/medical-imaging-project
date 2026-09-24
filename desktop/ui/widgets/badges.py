"""Badges: the pill labels the web app uses for modality, status and priority.

Two forms of the same thing.  ``Badge`` is a widget, for the study header and the
dashboard.  ``BadgeDelegate`` paints the same pill inside a table cell, because a
widget per cell would mean 31,447 widgets and Qt's whole reason for having
delegates is that it does not need them.
"""

from __future__ import annotations

from PySide6.QtCore import QRect, QSize, Qt
from PySide6.QtGui import QFont, QPainter, QPen
from PySide6.QtWidgets import QLabel, QStyle, QStyledItemDelegate

from .. import theme
from ..models import COL_MODALITY, COL_PATIENT, COL_STATUS, ROLE_BADGE, ROLE_SUBTEXT
from ..paint import qcolor

#: Pill geometry, from the web badge: 2 px vertical padding, 7 px horizontal,
#: fully rounded ends at this height.
PILL_H = 18
PILL_PAD_X = 7
PILL_RADIUS = 5


class Badge(QLabel):
    """A single pill.  Colour comes from a tone name, never from a raw hex."""

    def __init__(self, text: str, tone: str = "neutral", theme_name: str = "light",
                 parent=None) -> None:
        super().__init__(text, parent)
        self._tone = tone
        self.apply_theme(theme_name)

    def apply_theme(self, theme_name: str) -> None:
        fg, bg = theme.tone_colors(self._tone, theme_name)
        self.setStyleSheet(
            f"QLabel {{ background: {bg}; color: {fg}; border-radius: {PILL_RADIUS}px;"
            f" padding: 1px {PILL_PAD_X}px; font-size: {theme.PT_TINY}pt;"
            f" font-weight: 600; }}")
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)

    def set_tone(self, tone: str, theme_name: str = "light") -> None:
        self._tone = tone
        self.apply_theme(theme_name)


class BadgeDelegate(QStyledItemDelegate):
    """Draws the modality and status cells as pills, and the patient cell as two
    lines - the alias over the age/sex sub-line the web table shows beneath it.

    Everything else falls through to the default painter, so the delegate carries
    no risk for the columns it does not care about.
    """

    def __init__(self, theme_name: str = "light", parent=None) -> None:
        super().__init__(parent)
        self._theme = theme_name

    def apply_theme(self, theme_name: str) -> None:
        self._theme = theme_name

    def sizeHint(self, option, index) -> QSize:
        size = super().sizeHint(option, index)
        return QSize(size.width(), max(size.height(), 40))

    def paint(self, painter: QPainter, option, index) -> None:
        column = index.column()
        if column in (COL_MODALITY, COL_STATUS):
            badge = index.data(ROLE_BADGE)
            if badge:
                self._paint_pill(painter, option, index, badge[0], badge[1])
                return
        if column == COL_PATIENT:
            self._paint_patient(painter, option, index)
            return
        super().paint(painter, option, index)

    # ------------------------------------------------------------------ pieces

    def _paint_background(self, painter: QPainter, option, index) -> None:
        """The row's own background and selection tint, drawn by the style.

        Delegating this rather than filling a rectangle keeps hover, selection
        and the alternating-row colour coming from the style sheet, so a themed
        cell and an unthemed one cannot drift apart.
        """
        widget = option.widget
        style = widget.style() if widget is not None else None
        if style is not None:
            style.drawPrimitive(QStyle.PrimitiveElement.PE_PanelItemViewItem,
                                option, painter, widget)

    def _paint_pill(self, painter: QPainter, option, index,
                    text: str, tone: str) -> None:
        self._paint_background(painter, option, index)
        fg, bg = theme.tone_colors(tone, self._theme)
        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        font = QFont(option.font)
        font.setPointSize(theme.PT_TINY)
        font.setWeight(QFont.Weight.DemiBold)
        painter.setFont(font)
        metrics = painter.fontMetrics()
        width = metrics.horizontalAdvance(text) + PILL_PAD_X * 2
        rect = option.rect
        pill = QRect(rect.left() + 8, rect.center().y() - PILL_H // 2,
                     width, PILL_H)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(qcolor(bg))
        painter.drawRoundedRect(pill, PILL_RADIUS, PILL_RADIUS)
        painter.setPen(QPen(qcolor(fg)))
        painter.drawText(pill, int(Qt.AlignmentFlag.AlignCenter), text)
        painter.restore()

    def _paint_patient(self, painter: QPainter, option, index) -> None:
        """Alias over ``age · sex``, the two-line cell of the web table.

        The sub-line is the reason this is a delegate rather than a display
        string with a newline in it: the two lines want different sizes and
        different colours, and a table cell with a newline in it gets one of each.
        """
        self._paint_background(painter, option, index)
        colors = theme.palette(self._theme)
        title = index.data(Qt.ItemDataRole.DisplayRole) or ""
        subtext = index.data(ROLE_SUBTEXT) or ""
        rect = option.rect.adjusted(8, 4, -8, -4)
        painter.save()
        font = QFont(option.font)
        font.setPointSize(theme.PT_BODY)
        painter.setFont(font)
        painter.setPen(QPen(qcolor(colors["ink_primary"])))
        line_h = painter.fontMetrics().height()
        painter.drawText(QRect(rect.left(), rect.top(), rect.width(), line_h),
                         int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter),
                         str(title))
        font.setPointSize(theme.PT_TINY)
        painter.setFont(font)
        painter.setPen(QPen(qcolor(colors["ink_muted"])))
        painter.drawText(
            QRect(rect.left(), rect.top() + line_h, rect.width(), rect.height() - line_h),
            int(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop), str(subtext))
        painter.restore()

