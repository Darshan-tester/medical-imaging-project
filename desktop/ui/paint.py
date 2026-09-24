"""Turning theme strings into Qt paint objects.

``theme`` deals in the web app's own colour spellings - ``"#2563EB"`` and
``"rgba(37, 99, 235, 0.120)"`` - because those are what can be traced back to a
CSS variable.  ``QColor`` parses the first and not the second, so the conversion
happens here rather than each caller keeping a private copy of the numbers.
"""

from __future__ import annotations

from PySide6.QtGui import QColor


def qcolor(spec: str, alpha: float | None = None) -> QColor:
    """A ``QColor`` from ``#RRGGBB``, ``rgb(...)`` or ``rgba(...)``.

    ``alpha`` overrides whatever the string carried, which is how a token gets
    reused at a different strength without a second constant.
    """
    text = spec.strip()
    color = QColor()
    if text.startswith("rgb"):
        inside = text[text.find("(") + 1: text.rfind(")")]
        parts = [p.strip() for p in inside.split(",") if p.strip()]
        if len(parts) >= 3:
            r, g, b = (int(round(float(p))) for p in parts[:3])
            a = float(parts[3]) if len(parts) > 3 else 1.0
            color = QColor(_clamp8(r), _clamp8(g), _clamp8(b),
                           _clamp8(int(round(a * 255))))
    else:
        color = QColor(text)
        if not color.isValid():
            color = QColor(0, 0, 0)
    if alpha is not None:
        color.setAlpha(_clamp8(int(round(alpha * 255))))
    return color


def _clamp8(value: int) -> int:
    return 0 if value < 0 else (255 if value > 255 else value)
