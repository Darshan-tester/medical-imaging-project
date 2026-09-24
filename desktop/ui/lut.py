"""Display transfer function, matching the browser's ``filter`` chain exactly.

``ImageViewer.tsx`` adjusts brightness, contrast and inversion with a CSS filter
on the element that holds the image::

    filter: brightness(B%) contrast(C%) invert(1)

It is a *display* adjustment, not a re-decode, and that distinction is the whole
reason this module exists.  ``core.imaging`` bakes the modality's own window into
an 8-bit image - the DICOM ``WindowCenter``/``WindowWidth`` for CT, a percentile
window for the NIfTI volumes - and the cache is keyed on the result.  If the
reader's window/level control re-decoded instead, every drag would miss the frame
cache, evict the volume, and turn a 0.04 ms scroll step into a 24 s rebuild.  So
the decoded frame is the invariant, and this is a 256-entry lookup table applied
when it is painted.

The formulae are the ones CSS filters are defined by, in the order the filter
string applies them (left to right, on sRGB values in 0..1):

* ``brightness(b)`` is ``feComponentTransfer`` type ``linear`` with slope ``b``:
  ``v * b``.
* ``contrast(c)`` is the same with slope ``c`` and intercept ``0.5 - 0.5 * c``:
  ``v * c + 0.5 - 0.5 * c``, i.e. a stretch about mid-grey.
* ``invert(1)`` is ``1 - v``.

Nothing here imports Qt, so the table can be checked against those formulae
without a display.
"""

from __future__ import annotations

#: The neutral values.  ``DEFAULT_VIEWER_STATE`` in ``ViewerToolbar.tsx`` uses
#: 100 for both, meaning "unchanged", and the toolbar treats any other value as
#: an active state worth highlighting.
NEUTRAL = 100


def display_lut(brightness: int = NEUTRAL, contrast: int = NEUTRAL,
                inverted: bool = False) -> list[int]:
    """The 256 output levels for one combination of the three controls.

    Percentages, as the web keeps them: 100 is unchanged, 140 is the toolbar's
    top step.  Rounding is round-half-up on the 0..255 scale, which is what the
    browser's 8-bit compositing does.
    """
    b = max(0.0, brightness / 100.0)
    c = max(0.0, contrast / 100.0)
    intercept = 0.5 - 0.5 * c
    out: list[int] = []
    for i in range(256):
        v = (i / 255.0) * b
        v = v * c + intercept
        if inverted:
            v = 1.0 - v
        level = int(v * 255.0 + 0.5) if v > 0 else 0
        out.append(255 if level > 255 else level)
    return out


def is_neutral(brightness: int, contrast: int, inverted: bool) -> bool:
    """Whether the table would be the identity, so painting can skip it."""
    return brightness == NEUTRAL and contrast == NEUTRAL and not inverted
