"""Annotations in patient/world coordinates, shared by every view.

A point is stored as a **world** position (mm, patient frame) with the
study/series it belongs to, so the same marker lands on the right anatomy in an
axial pane, a sagittal pane, and the 3-D render, whatever each view is scrolled
to.  Slice-frame annotations the old UI made are converted on load through the
series' volume affine and are never re-persisted as pixels.

Persistence is a small JSON sidecar next to the delivered index
(``index/annotations.json``), keyed by study id.  The study index itself stays
read-only; annotations are reader work, not dataset facts.

Slice-specific measurements are kept with their plane and slice: in 3-D they
render as a short line **on their own slice plane**, never promoted into a
volumetric structure, because the reader drew them on one slice and converting
that into a 3-D solid would invent geometry the data does not support.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .imaging.navigation import volume_affine, voxel_to_world, world_to_voxel

POINT = "point"
LINE = "line"
PEN = "pen"

#: Annotation kinds that have a meaningful 3-D representation.  A pen stroke is
#: 2-D scribble on one plane; in 3-D it draws on that plane only, so it is
#: listed as renderable-on-plane rather than volumetric.
VOLUMETRIC_KINDS = (POINT, LINE)


@dataclass
class Annotation:
    id: str
    kind: str
    study_id: str
    series_id: str
    #: World mm position(s).  One for a point; two for a line; the polyline
    #: points of a pen stroke in order.
    points: list[tuple[float, float, float]]
    #: For line/pen: the plane the stroke was drawn on ("Axial", ...).  A point
    #: needs no plane - it is a location in the volume.
    plane: str | None = None
    #: Slice index (as the viewer numbers slices) the annotation was drawn on,
    #: for slice-scoped kinds.
    slice_index: int | None = None
    label: str = ""
    visible: bool = True

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind,
            "study": self.study_id, "series": self.series_id,
            "points": [[round(p[0], 4), round(p[1], 4), round(p[2], 4)]
                       for p in self.points],
            "plane": self.plane,
            "slice": self.slice_index,
            "label": self.label,
            "visible": self.visible,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Annotation | None":
        try:
            kind = str(raw.get("kind") or "")
            points = [(float(p[0]), float(p[1]), float(p[2]))
                      for p in (raw.get("points") or [])]
            if kind not in (POINT, LINE, PEN) or not points:
                return None
            if kind == LINE and len(points) != 2:
                return None
            return cls(
                id=str(raw.get("id") or ""), kind=kind,
                study_id=str(raw.get("study") or ""),
                series_id=str(raw.get("series") or ""),
                points=points, plane=raw.get("plane") or None,
                slice_index=None if raw.get("slice") is None else int(raw["slice"]),
                label=str(raw.get("label") or ""),
                visible=bool(raw.get("visible", True)),
            )
        except (TypeError, ValueError, IndexError):
            return None


def voxel_to_annotation(
    geom_matrix, origin, kind: str, study_id: str, series_id: str,
    voxel_points: list[tuple[int, int, int]], ann_id: str,
    plane: str | None = None, slice_index: int | None = None, label: str = "",
) -> Annotation:
    """Create an annotation from voxel positions, converting to world mm."""
    return Annotation(
        id=ann_id, kind=kind, study_id=study_id, series_id=series_id,
        points=[voxel_to_world(geom_matrix, origin, v) for v in voxel_points],
        plane=plane, slice_index=slice_index, label=label,
    )


def annotation_to_voxels(
    ann: Annotation, geom_matrix, origin,
) -> list[tuple[int, int, int]]:
    return [world_to_voxel(geom_matrix, origin, p) for p in ann.points]


class AnnotationStore:
    """All annotations, persisted as one JSON sidecar; thread-safe."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._items: dict[str, list[Annotation]] = {}
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            items = raw.get("annotations") or []
            for entry in items:
                ann = Annotation.from_dict(entry)
                if ann is None:
                    continue
                self._items.setdefault(ann.study_id, []).append(ann)
        except (OSError, ValueError):
            self._items = {}

    def for_study(self, study_id: str) -> list[Annotation]:
        with self._lock:
            return list(self._items.get(study_id, ()))

    def add(self, ann: Annotation) -> None:
        with self._lock:
            self._items.setdefault(ann.study_id, []).append(ann)
            self._save()

    def remove(self, study_id: str, ann_id: str) -> None:
        with self._lock:
            items = self._items.get(study_id, [])
            self._items[study_id] = [a for a in items if a.id != ann_id]
            self._save()

    def set_visible(self, study_id: str, ann_id: str, visible: bool) -> None:
        with self._lock:
            for a in self._items.get(study_id, ()):
                if a.id == ann_id:
                    a.visible = visible
            self._save()

    def clear_study(self, study_id: str) -> None:
        with self._lock:
            self._items.pop(study_id, None)
            self._save()

    def _save(self) -> None:
        payload = {"annotations": [
            a.to_dict() for items in self._items.values() for a in items]}
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=1), encoding="utf-8")
            tmp.replace(self._path)
        except OSError:
            pass  # read-only media: annotations stay for the session only


def matrix_for(geom) -> tuple:
    """The voxel->world matrix/origin pair for a VolumeGeometry-bearing object.

    ``geometry`` carries only the derived plane axes, not the raw affine, so
    reconstructing the true affine here is not possible in general; the
    axis-aligned reconstruction below is exact whenever the affine is
    diagonal (axis-aligned acquisitions) and uses the measured axis assignment
    otherwise.  NIfTI volumes hand their real affine through
    ``volume_affine`` at the caller, which is preferred.
    """
    spacing = geom.spacing
    return volume_affine(geom.dims, spacing, None)