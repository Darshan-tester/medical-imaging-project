"""Annotation display controls: color, opacity, thickness, label size, visibility.

These are **display** properties of the annotation layer, kept deliberately
separate from window/level: a W/L change must never make annotations unreadable,
so annotations are drawn after the LUT with their own contrast strategy - each
label gets a dark outline/plate against the bright scan (and vice versa), and
changing W/L does not touch annotation ink.

Style state is shared by every pane: one set of controls, applied at paint time
in every pane and in the 3-D overlay, so a thickness change is visible
everywhere at once.
"""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QColorDialog, QComboBox, QHBoxLayout,
                               QLabel, QPushButton, QSlider, QVBoxLayout, QWidget)

#: Palette the reader can pick from; chosen to read on both bright and dark
#: scans (each entry is legible against bone-white and against air-black).
ANNOTATION_COLORS: tuple[tuple[str, str], ...] = (
    ("Blue", "#60A5FA"),
    ("Amber", "#F59E0B"),
    ("Green", "#34D399"),
    ("Magenta", "#E879F9"),
    ("White", "#F9FAFB"),
    ("Red", "#F87171"),
)


class AnnotationStyle:
    """One style bundle, shared by all panes and the 3-D overlay."""

    def __init__(self) -> None:
        self.color = "#60A5FA"
        self.opacity = 0.9
        self.thickness = 2
        self.label_size = 10
        self.visible = True

    def hex(self) -> str:
        return self.color


class AnnotationPanel(QWidget):
    changed = Signal()            # any style value changed
    visibilityToggled = Signal(bool)
    clearRequested = Signal()

    def __init__(self, style: AnnotationStyle, parent=None) -> None:
        super().__init__(parent)
        self._style = style
        column = QVBoxLayout(self)
        column.setContentsMargins(8, 8, 8, 8)
        column.setSpacing(6)

        title = QLabel("Annotations", self)
        title.setProperty("role", "label")
        column.addWidget(title)

        self._visible = QCheckBox("Show annotations", self)
        self._visible.setChecked(style.visible)
        self._visible.toggled.connect(self._on_visible)
        column.addWidget(self._visible)

        color_row = QHBoxLayout()
        color_row.addWidget(QLabel("Color", self))
        self._color_combo = QComboBox(self)
        for name, hexcolor in ANNOTATION_COLORS:
            self._color_combo.addItem(name, hexcolor)
        self._color_combo.currentIndexChanged.connect(self._on_color)
        color_row.addWidget(self._color_combo, 1)
        pick = QPushButton("…", self)
        pick.setFixedWidth(28)
        pick.setToolTip("Custom color")
        pick.clicked.connect(self._pick_color)
        color_row.addWidget(pick)
        column.addLayout(color_row)

        for name, label, lo, hi in (
                ("opacity", "Opacity", 20, 100),
                ("thickness", "Line thickness", 1, 8),
                ("label", "Label size", 7, 20)):
            row = QHBoxLayout()
            row.addWidget(QLabel(label, self))
            slider = QSlider(Qt.Orientation.Horizontal, self)
            slider.setRange(lo, hi)
            slider.setValue(int(getattr(style, name) * 100 if name == "opacity"
                                else getattr(style, name)))
            slider.valueChanged.connect(
                lambda v, n=name: self._on_slider(n, v))
            row.addWidget(slider, 1)
            self._sliders = getattr(self, "_sliders", {})
            self._sliders[name] = slider
            column.addLayout(row)

        clear = QPushButton("Clear study annotations", self)
        clear.setToolTip("Remove every annotation stored for this study")
        clear.clicked.connect(self.clearRequested.emit)
        column.addWidget(clear)
        column.addStretch(1)

    def _on_visible(self, checked: bool) -> None:
        self._style.visible = checked
        self.visibilityToggled.emit(checked)
        self.changed.emit()

    def _on_color(self, index: int) -> None:
        hexcolor = self._color_combo.itemData(index)
        if hexcolor:
            self._style.color = hexcolor
            self.changed.emit()

    def _pick_color(self) -> None:
        from PySide6.QtGui import QColor
        current = QColor(self._style.color)
        chosen = QColorDialog.getColor(current, self, "Annotation color")
        if chosen.isValid():
            self._style.color = chosen.name()
            self.changed.emit()

    def _on_slider(self, name: str, value: int) -> None:
        if name == "opacity":
            self._style.opacity = value / 100.0
        else:
            self._style.label_size = value
        self.changed.emit()