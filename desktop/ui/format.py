"""Value formatting, matching ``lib/utils.ts`` and the study table's own cells.

Qt-free on purpose: these are the strings the CEO reads off the screen, and they
can be checked against the web app's output without a display.

``formatDate`` in the web app is ``toLocaleDateString("en-US", {month: "short",
day: "numeric", year: "numeric"})``.  The month names are spelled out here rather
than left to the C library, because a locale-dependent date is a delivery risk on
a machine whose regional settings nobody has seen.
"""

from __future__ import annotations

#: ``en-US`` short month names, in ``toLocaleDateString`` order.
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

#: What every screen says when a field the dataset never carried is asked for.
#: ``reports.NOT_AVAILABLE`` is the same string; both come from the web app's
#: cells, and neither invents a value.
NOT_AVAILABLE = "Not available"


def format_date(value: str | None) -> str:
    """``"2024-03-12"`` -> ``"Mar 12, 2024"``; anything unparseable is echoed.

    Echoing rather than blanking is deliberate: if a dataset ever carries a date
    in a shape this does not know, the reader should see what was recorded, not
    be told it is absent.
    """
    if not value:
        return NOT_AVAILABLE
    text = str(value).strip()
    head = text.split("T", 1)[0]
    parts = head.split("-")
    if len(parts) != 3:
        return text
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return text
    if not 1 <= month <= 12:
        return text
    return f"{MONTHS[month - 1]} {day}, {year}"


def format_bytes(value: int | float | None) -> str:
    """Binary units, one decimal from MiB up - the size a folder listing shows."""
    if value is None:
        return NOT_AVAILABLE
    size = float(value)
    if size < 1024:
        return f"{int(size)} B"
    for unit in ("KiB", "MiB", "GiB", "TiB"):
        size /= 1024.0
        if size < 1024.0 or unit == "TiB":
            if unit == "KiB":
                return f"{size:.0f} {unit}"
            return f"{size:.1f} {unit}"
    return f"{size:.1f} TiB"


def format_int(value: int | float | None) -> str:
    """Thousands separators, because 31,447 is read faster than 31447."""
    if value is None:
        return NOT_AVAILABLE
    return f"{int(value):,}"


def format_age_sex(age: int | None, sex: str | None) -> str:
    """The study table's patient sub-line: ``"54y · F"``, or one, or neither."""
    parts = [f"{age}y" if age is not None else None, sex or None]
    joined = " · ".join([p for p in parts if p])
    return joined or NOT_AVAILABLE


def format_ms(value: float | None) -> str:
    """A duration for the status bar: sub-millisecond work should read as fast."""
    if value is None:
        return "-"
    if value < 1.0:
        return f"{value:.2f} ms"
    if value < 1000.0:
        return f"{value:.0f} ms"
    return f"{value / 1000.0:.1f} s"


def elide(text: str, limit: int) -> str:
    """Middle-free truncation for ids that are long but whose head identifies."""
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)] + "…"
