"""The clinical hospital theme, ported from ``globals.css`` and ``tailwind.config.ts``.

Both themes are carried across because the web app carries both and they mean
different things: light (``:root``) is the default hospital-dashboard look, and
dark (``html.dark``) is the night reading-room mode.  ``VIEWER_BG`` belongs to
neither - ``tailwind.config.ts`` calls it "intentionally theme-invariant - PACS
viewers stay dark always", and the image is meant to be the brightest thing on
screen.

The token names here are the web's own, so a colour can be traced from a widget
back to the CSS variable it came from.  Values are the exact ``rgb()`` triples
from ``globals.css``, written as hex.
"""

from __future__ import annotations

#: The near-black the diagnostic image sits on, in both themes.
VIEWER_BG = "#0A0E16"

#: ``:root`` in ``globals.css`` - the default.
LIGHT: dict[str, str] = {
    "canvas": "#F4F7FB",
    "base": "#FFFFFF",
    "elevated": "#FFFFFF",
    "panel": "#FFFFFF",
    "panel_alt": "#F1F5F9",
    "panel_hover": "#EAF1FB",
    "border": "#E2E8F0",
    "border_strong": "#CBD5E1",
    "ink_primary": "#0F172A",
    "ink_secondary": "#475569",
    "ink_muted": "#94A3B8",
    "ink_disabled": "#CBD5E1",
    "clinical": "#2563EB",
    "clinical_strong": "#1D4ED8",
    "secondary": "#0891B2",
    "secondary_strong": "#0E7490",
    "success": "#16A34A",
    "success_strong": "#15803D",
    "warning": "#D97706",
    "warning_strong": "#B45309",
    "critical": "#DC2626",
    "critical_strong": "#B91C1C",
    "overlay_hover": "#0F172A",
}

#: ``html.dark`` - the night reading-room mode, offered in Settings.
DARK: dict[str, str] = {
    "canvas": "#0A0F1C",
    "base": "#0F172A",
    "elevated": "#15213A",
    "panel": "#0F172A",
    "panel_alt": "#0C1526",
    "panel_hover": "#15213A",
    "border": "#1E2C46",
    "border_strong": "#2C3E5E",
    "ink_primary": "#F1F5F9",
    "ink_secondary": "#A7B4C9",
    "ink_muted": "#71809A",
    "ink_disabled": "#4E5C74",
    "clinical": "#3B82F6",
    "clinical_strong": "#60A5FA",
    "secondary": "#22D3EE",
    "secondary_strong": "#67E8F9",
    "success": "#22C55E",
    "success_strong": "#4ADE80",
    "warning": "#F59E0B",
    "warning_strong": "#FBBF24",
    "critical": "#EF4444",
    "critical_strong": "#F87171",
    "overlay_hover": "#FFFFFF",
}

THEMES: dict[str, dict[str, str]] = {"light": LIGHT, "dark": DARK}

#: Measurement lines and handles.  ``ImageViewer.tsx`` hard-codes this one
#: rather than reading a token, so it is hard-coded here too.
MEASURE_COLOR = "#60A5FA"

#: Font stacks.  The web app asks for ``font-sans`` and lets the browser pick;
#: on the delivery target that is Segoe UI, which is present on every supported
#: Windows build.  The fallbacks matter only when the EXE is run somewhere else.
FONT_SANS = "Segoe UI, Inter, system-ui, Helvetica Neue, Arial, sans-serif"
FONT_MONO = "Consolas, Cascadia Mono, Menlo, DejaVu Sans Mono, monospace"

#: Point sizes.  Qt sizes text in points where the web sizes it in pixels; these
#: are the equivalents at 96 dpi of the sizes the components actually use
#: (11px, 11.5px, 12.5px, 13px, 15px).
PT_TINY = 8
PT_SMALL = 9
PT_BODY = 10
PT_TITLE = 11
PT_HEAD = 13


def rgb_tuple(color: str) -> tuple[int, int, int]:
    """``"#2563EB"`` -> ``(37, 99, 235)``."""
    value = color.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def rgba(color: str, alpha: float) -> str:
    """A QSS ``rgba()`` literal.

    Qt style sheets have no equivalent of Tailwind's ``bg-clinical/15``, so the
    handful of translucent fills the components use - the 12 % ``*-dim`` tokens,
    the 7 % hover wells, the 15 % active-tool tint - are spelled out here.
    """
    r, g, b = rgb_tuple(color)
    return f"rgba({r}, {g}, {b}, {alpha:.3f})"


def dim(color: str) -> str:
    """The ``*-dim`` tokens, which ``tailwind.config.ts`` defines as 12 %."""
    return rgba(color, 0.12)


def palette(name: str) -> dict[str, str]:
    """The named theme, falling back to light rather than raising.

    Settings writes this name into the config file, and a file that has been
    hand-edited to something meaningless should not stop the app from opening.
    """
    return THEMES.get(name, LIGHT)


def stylesheet(name: str = "light") -> str:
    """The whole application's Qt style sheet for one theme.

    One sheet set on the ``QApplication`` rather than per-widget styling, for the
    same reason the web app routes every colour through CSS variables: switching
    theme in Settings then repaints everything from here, and no widget carries a
    private copy of a colour that would be missed.

    Widgets opt into variants with Qt properties rather than class names, e.g.
    ``setProperty("variant", "primary")`` on a button, which is the closest thing
    QSS has to a utility class.  A property change needs an explicit
    ``unpolish``/``polish`` to take effect; ``restyle()`` below does that.
    """
    c = palette(name)
    hover = rgba(c["overlay_hover"], 0.07)
    hover_soft = rgba(c["overlay_hover"], 0.045)
    return f"""
/* ---------------------------------------------------------------- surfaces */
QWidget {{
    background: {c["canvas"]};
    color: {c["ink_primary"]};
    font-family: {FONT_SANS};
    font-size: {PT_BODY}pt;
}}
QToolTip {{
    background: {c["elevated"]};
    color: {c["ink_primary"]};
    border: 1px solid {c["border_strong"]};
    border-radius: 6px;
    padding: 4px 7px;
}}
QFrame[surface="panel"] {{
    background: {c["panel"]};
    border: 1px solid {c["border"]};
    border-radius: 10px;
}}
QFrame[surface="alt"] {{
    background: {c["panel_alt"]};
    border: 1px solid {c["border_strong"]};
    border-radius: 10px;
}}
QFrame[surface="plain"] {{
    background: {c["panel"]};
    border: none;
}}
QFrame[surface="viewer"] {{
    background: {VIEWER_BG};
    border: 1px solid {c["border"]};
    border-radius: 10px;
}}
QFrame[surface="rule"] {{
    background: {c["border"]};
    border: none;
}}
/* ------------------------------------------------------------------- labels */
QLabel {{ background: transparent; }}
QLabel[role="h1"] {{ font-size: {PT_HEAD}pt; font-weight: 600; }}
QLabel[role="h2"] {{ font-size: {PT_TITLE}pt; font-weight: 600; }}
QLabel[role="section"] {{
    font-size: {PT_SMALL}pt;
    font-weight: 600;
    color: {c["ink_secondary"]};
}}
QLabel[role="muted"] {{ font-size: {PT_SMALL}pt; color: {c["ink_muted"]}; }}
QLabel[role="secondary"] {{ color: {c["ink_secondary"]}; }}
QLabel[role="mono"] {{
    font-family: {FONT_MONO};
    font-size: {PT_SMALL}pt;
    color: {c["ink_secondary"]};
}}
QLabel[role="metric"] {{ font-size: 20pt; font-weight: 600; }}
QLabel[role="onviewer"] {{
    color: #E2E8F0;
    background: transparent;
    font-family: {FONT_MONO};
    font-size: {PT_SMALL}pt;
}}

/* ------------------------------------------------------------------ buttons */
QPushButton {{
    background: {c["panel"]};
    border: 1px solid {c["border_strong"]};
    border-radius: 7px;
    padding: 5px 11px;
    color: {c["ink_secondary"]};
}}
QPushButton:hover {{ background: {hover_soft}; color: {c["ink_primary"]}; }}
QPushButton:pressed {{ background: {hover}; }}
QPushButton:disabled {{ color: {c["ink_disabled"]}; border-color: {c["border"]}; }}
QPushButton:focus {{ border: 1px solid {c["clinical"]}; }}
QPushButton[variant="primary"] {{
    background: {c["clinical"]};
    border-color: {c["clinical"]};
    color: #FFFFFF;
    font-weight: 600;
}}
QPushButton[variant="primary"]:hover {{ background: {c["clinical_strong"]}; }}
QPushButton[variant="ghost"] {{ background: transparent; border: none; }}
QPushButton[variant="ghost"]:hover {{ background: {hover}; color: {c["ink_primary"]}; }}
QPushButton[variant="nav"] {{
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 7px 10px;
    text-align: left;
    color: {c["ink_secondary"]};
}}
QPushButton[variant="nav"]:hover {{ background: {hover}; color: {c["ink_primary"]}; }}
QPushButton[variant="nav"][active="true"] {{
    background: {dim(c["clinical"])};
    color: {c["clinical_strong"]};
    font-weight: 600;
}}
/* --------------------------------------------------------- viewer tool bar */
/* The 8x8 icon buttons of ``ViewerToolbar.tsx``: quiet by default, tinted with
   ``clinical-dim`` while their tool is the active one. */
QToolButton {{
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 4px;
    color: {c["ink_secondary"]};
}}
QToolButton:hover {{ background: {hover}; color: {c["ink_primary"]}; }}
QToolButton:checked, QToolButton[active="true"] {{
    background: {dim(c["clinical"])};
    color: {c["clinical_strong"]};
}}
QToolButton:disabled {{ color: {c["ink_disabled"]}; }}

/* ------------------------------------------------------------------- inputs */
QLineEdit, QComboBox, QDateEdit, QSpinBox, QPlainTextEdit {{
    background: {c["panel_alt"]};
    border: 1px solid {c["border_strong"]};
    border-radius: 7px;
    padding: 5px 8px;
    color: {c["ink_primary"]};
    selection-background-color: {rgba(c["clinical"], 0.22)};
}}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus, QSpinBox:focus {{
    border: 1px solid {c["clinical"]};
}}
QLineEdit::placeholder {{ color: {c["ink_muted"]}; }}
QComboBox::drop-down {{ border: none; width: 18px; }}
QComboBox QAbstractItemView {{
    background: {c["elevated"]};
    border: 1px solid {c["border_strong"]};
    selection-background-color: {dim(c["clinical"])};
    selection-color: {c["ink_primary"]};
    outline: none;
}}
QCheckBox {{ spacing: 7px; color: {c["ink_secondary"]}; }}
QCheckBox::indicator {{
    width: 14px; height: 14px;
    border: 1px solid {c["border_strong"]};
    border-radius: 4px;
    background: {c["panel"]};
}}
QCheckBox::indicator:checked {{
    background: {c["clinical"]};
    border-color: {c["clinical"]};
}}
/* -------------------------------------------------------------------- table */
QTableView {{
    background: {c["panel"]};
    alternate-background-color: {c["panel"]};
    border: none;
    gridline-color: transparent;
    selection-background-color: {dim(c["clinical"])};
    selection-color: {c["ink_primary"]};
    outline: none;
}}
QTableView::item {{
    border-bottom: 1px solid {c["border"]};
    padding: 6px 8px;
    color: {c["ink_secondary"]};
}}
QTableView::item:hover {{ background: {hover_soft}; }}
QTableView::item:selected {{ color: {c["ink_primary"]}; }}
QHeaderView {{ background: {c["panel"]}; }}
QHeaderView::section {{
    background: {c["panel"]};
    border: none;
    border-bottom: 1px solid {c["border_strong"]};
    padding: 7px 8px;
    color: {c["ink_muted"]};
    font-size: {PT_TINY}pt;
    font-weight: 600;
    text-transform: uppercase;
}}
QHeaderView::section:hover {{ color: {c["ink_secondary"]}; }}
QTableCornerButton::section {{ background: {c["panel"]}; border: none; }}

/* --------------------------------------------------------------------- list */
QListWidget, QListView, QTreeWidget {{
    background: {c["panel"]};
    border: 1px solid {c["border"]};
    border-radius: 10px;
    outline: none;
}}
QListWidget::item {{
    border-radius: 7px;
    padding: 5px 7px;
    margin: 1px 3px;
    color: {c["ink_secondary"]};
}}
QListWidget::item:hover {{ background: {hover_soft}; }}
QListWidget::item:selected {{
    background: {dim(c["clinical"])};
    color: {c["clinical_strong"]};
}}
/* ---------------------------------------------------------------- read view */
QTextBrowser, QTextEdit {{
    background: {c["panel"]};
    border: none;
    color: {c["ink_secondary"]};
    selection-background-color: {rgba(c["clinical"], 0.22)};
}}

/* ------------------------------------------------------------------ sliders */
/* The slice slider: a 6 px well with a round clinical-blue handle, matching the
   ``accent-clinical`` range input in ``SliceNavigator.tsx``. */
QSlider::groove:horizontal {{
    height: 6px;
    border-radius: 3px;
    background: {rgba(c["overlay_hover"], 0.10)};
}}
QSlider::sub-page:horizontal {{
    height: 6px;
    border-radius: 3px;
    background: {c["clinical"]};
}}
QSlider::handle:horizontal {{
    width: 13px;
    height: 13px;
    margin: -4px 0;
    border-radius: 7px;
    background: {c["clinical"]};
    border: 2px solid {c["panel"]};
}}
QSlider::handle:horizontal:hover {{ background: {c["clinical_strong"]}; }}
QSlider:disabled::sub-page:horizontal {{ background: {c["ink_disabled"]}; }}

/* ---------------------------------------------------------------- scrollbar */
QScrollBar:vertical {{ background: transparent; width: 10px; margin: 0; }}
QScrollBar:horizontal {{ background: transparent; height: 10px; margin: 0; }}
QScrollBar::handle {{
    background: {rgba(c["overlay_hover"], 0.14)};
    border-radius: 5px;
    min-height: 28px;
    min-width: 28px;
}}
QScrollBar::handle:hover {{ background: {rgba(c["overlay_hover"], 0.22)}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

/* ----------------------------------------------------------------- splitter */
QSplitter::handle {{ background: {c["border"]}; }}
QSplitter::handle:horizontal {{ width: 1px; }}
QSplitter::handle:vertical {{ height: 1px; }}
QSplitter::handle:hover {{ background: {c["clinical"]}; }}

/* ------------------------------------------------------------------ tab bar */
QTabWidget::pane {{ border: none; }}
QTabBar::tab {{
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 12px;
    color: {c["ink_muted"]};
}}
QTabBar::tab:hover {{ color: {c["ink_primary"]}; }}
QTabBar::tab:selected {{
    color: {c["clinical_strong"]};
    border-bottom: 2px solid {c["clinical"]};
    font-weight: 600;
}}
QProgressBar {{
    background: {c["panel_alt"]};
    border: none;
    border-radius: 4px;
    height: 6px;
    text-align: center;
    color: {c["ink_muted"]};
}}
QProgressBar::chunk {{ background: {c["clinical"]}; border-radius: 4px; }}
"""


#: ``STATUS_CONFIG`` and ``PRIORITY_CONFIG`` in ``components/ui/Badge.tsx``.
#: Only the two statuses this index can actually produce are reachable -
#: ``StudyRow.status`` is derived from report presence and nothing else - but the
#: whole map is carried so the badge is right if that ever widens.
STATUS_LABELS: dict[str, tuple[str, str]] = {
    "queued": ("Queued", "neutral"),
    "processing": ("Processing", "clinical"),
    "ai-complete": ("AI Complete", "clinical"),
    "in-review": ("In Review", "warning"),
    "approved": ("Approved", "success"),
}

PRIORITY_LABELS: dict[str, tuple[str, str]] = {
    "routine": ("Routine", "neutral"),
    "urgent": ("Urgent", "warning"),
    "stat": ("STAT", "critical"),
}

#: ``MODALITY_LABEL`` in ``Badge.tsx`` - Ultrasound is abbreviated, the rest are
#: shown as they are stored.
MODALITY_LABELS: dict[str, str] = {
    "CT": "CT",
    "MRI": "MRI",
    "X-Ray": "X-Ray",
    "Ultrasound": "US",
    "PET": "PET",
}

#: Which token a modality badge borrows.  The web app gives every modality the
#: same neutral treatment; here they are separated because the study list is the
#: one screen where five modalities sit next to each other and colour is the
#: fastest way to read the mix.
MODALITY_TONES: dict[str, str] = {
    "CT": "clinical",
    "MRI": "secondary",
    "PET": "warning",
    "X-Ray": "success",
    "Ultrasound": "critical",
}


def tone_colors(name: str, theme: str = "light") -> tuple[str, str]:
    """``(foreground, background)`` for a badge tone."""
    c = palette(theme)
    if name == "neutral":
        return (c["ink_secondary"], c["panel_alt"])
    key = name if name in c else "clinical"
    return (c[f"{key}_strong"], dim(c[key]))


def restyle(widget) -> None:
    """Re-evaluate property selectors after a ``setProperty`` call.

    Qt resolves ``QPushButton[active="true"]`` when a widget is polished, not
    when the property changes, so a nav button that has just become the active
    one keeps its old paint until it is unpolished and polished again.  Every
    place that flips a styling property calls this.
    """
    style = widget.style()
    style.unpolish(widget)
    style.polish(widget)
    widget.update()
