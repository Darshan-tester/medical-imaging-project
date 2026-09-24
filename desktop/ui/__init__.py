"""Qt layer: everything in this package may import PySide6, nothing under
``core/`` may.

The split is deliberate and load bearing.  ``core`` is the ported web logic -
indexing, decoding, windowing, reslicing, report parsing, scheduling - and it is
verified by the harnesses under ``parity/`` running headless, with no display and
no Qt installed.  Keeping Qt out of it means those harnesses can keep proving the
port byte-for-byte against the web app's own mirror PNGs.  Everything Qt touches
lives here, and this layer holds no imaging logic of its own: it paints what
``core`` hands it and turns clicks into calls back into ``core``.
"""
