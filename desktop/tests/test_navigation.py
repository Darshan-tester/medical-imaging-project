"""Headless tests for the navigation core: linked navigation, world coordinates,
transfer functions and volume preparation.  No Qt, no display.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.imaging.geometry import planes_from_affine  # noqa: E402
from core.imaging import navigation as nav  # noqa: E402
from core.imaging.volume3d import (color_for, opacity_for, build_lut,  # noqa: E402
                                   prepare_volume, preset_by_id, DEFAULT_PRESET)
from core.annotations import Annotation, AnnotationStore, LINE, POINT  # noqa: E402

DIMS = (40, 50, 60)
SPACING = (1.0, 1.5, 2.0)
AFFINE = [[1.0, 0, 0, 0], [0, 1.5, 0, 0], [0, 0, 2.0, 0], [0, 0, 0, 1.0]]


def geom():
    return planes_from_affine(DIMS, SPACING, AFFINE, True)


@pytest.mark.parametrize("plane", ["Axial", "Coronal", "Sagittal"])
@pytest.mark.parametrize("nx,ny", [(0.0, 0.0), (1.0, 1.0), (0.25, 0.75), (0.5, 0.5)])
def test_plane_pick_round_trip(plane, nx, ny):
    g = geom()
    picked = nav.voxel_from_plane(g, plane, 10, nx, ny)
    slice_index, hx, hy = nav.plane_position(g, plane, picked)
    assert nav.voxel_from_plane(g, plane, slice_index, hx, hy) == picked


@pytest.mark.parametrize("plane", ["Axial", "Coronal", "Sagittal"])
def test_cross_plane_consistency(plane):
    """A voxel picked in one plane reads back at the same voxel in every other."""
    g = geom()
    for other in ("Axial", "Coronal", "Sagittal"):
        picked = nav.voxel_from_plane(g, plane, 10, 0.3, 0.8)
        s, nx, ny = nav.plane_position(g, other, picked)
        assert nav.voxel_from_plane(g, other, s, nx, ny) == picked


def test_clamped_at_edges():
    g = geom()
    assert nav.voxel_from_plane(g, "Axial", 10, -1.0, -1.0)[0] == 0
    assert nav.voxel_from_plane(g, "Axial", 10, 2.0, 2.0)[0] == DIMS[0] - 1


def test_world_coordinates_exact():
    g = geom()
    m, o = nav.volume_affine(DIMS, SPACING, AFFINE)
    ijk = (19, 24, 10)
    world = nav.voxel_to_world(m, o, ijk)
    assert world == pytest.approx((19.0, 36.0, 20.0))
    assert nav.world_to_voxel(m, o, world) == ijk


def test_world_fallback_affine_when_none():
    m, o = nav.volume_affine(DIMS, SPACING, None)
    world = nav.voxel_to_world(m, o, (1, 2, 3))
    assert world == pytest.approx((1.0, 3.0, 6.0))


def test_degenerate_affine_does_not_raise():
    m, o = nav.volume_affine(DIMS, SPACING, [[0, 0, 0, 0]] * 4)
    assert nav.world_to_voxel(m, o, (1.0, 1.0, 1.0)) == (0, 0, 0)


def test_grayscale_transfer_is_identity():
    assert color_for(DEFAULT_PRESET, 0.0) == (0.0, 0.0, 0.0)
    assert color_for(DEFAULT_PRESET, 0.5) == (0.5, 0.5, 0.5)
    assert color_for(DEFAULT_PRESET, 1.0) == (1.0, 1.0, 1.0)


def test_pseudocolor_presets_colorize():
    for preset in ("bone", "soft", "mri-rainbow", "mri-warm"):
        assert color_for(preset, 0.9) != color_for(preset, 0.1)
    entry = preset_by_id("mri-rainbow")
    assert entry is not None and "pseudocolor" in entry[2]


def test_opacity_below_threshold_is_zero():
    assert opacity_for(0.1, 0.25, 0.45) == 0.0
    assert opacity_for(1.0, 0.25, 0.45) == 1.0


def test_lut_shape():
    lut = build_lut("bone")
    assert lut.shape == (256, 4)


def test_prepare_volume_downsamples_and_maps():
    vol = np.random.rand(100, 90, 80).astype(np.float32) * 100
    u16, dims, step, vmin, vmax = prepare_volume(vol, max_voxels=200_000)
    assert step > 1
    assert int(np.prod(dims)) <= 200_000 + 1
    assert u16.dtype == np.uint16
    assert vmin >= 0.0 and vmax <= 101.0


def test_prepare_volume_rejects_empty():
    with pytest.raises(ValueError):
        prepare_volume(np.full((2, 2, 2), np.nan))


def test_annotation_round_trip(tmp_path):
    store = AnnotationStore(tmp_path / "annotations.json")
    g = geom()
    m, o = nav.volume_affine(DIMS, SPACING, AFFINE)
    ijk_points = [(1, 2, 3), (10, 20, 30)]
    ann = nav.__dict__  # placeholder to keep flake quiet
    from core.annotations import voxel_to_annotation
    a = voxel_to_annotation(m, o, LINE, "study-1", "series-1", ijk_points,
                            "a1", plane="Axial", slice_index=3)
    assert a.points[1] == pytest.approx((10.0, 30.0, 60.0))
    store.add(a)
    again = AnnotationStore(tmp_path / "annotations.json")
    loaded = again.for_study("study-1")
    assert len(loaded) == 1 and loaded[0].kind == LINE
    # world -> voxel -> world round trip
    vox = [nav.world_to_voxel(m, o, p) for p in loaded[0].points]
    assert vox == [(1, 2, 3), (10, 20, 30)]
    again.remove("study-1", "a1")
    assert again.for_study("study-1") == []


def test_annotation_from_dict_rejects_bad():
    assert Annotation.from_dict({"kind": "line", "points": [[0, 0, 0]]}) is None
    assert Annotation.from_dict({"kind": "point", "points": [[0, 0, 0]]}) is not None