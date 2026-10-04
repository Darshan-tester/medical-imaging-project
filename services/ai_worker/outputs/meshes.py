"""
3D Organ Surface Mesh Generator and Exporter.
Extracts isosurfaces using Marching Cubes, calculates smooth normals,
decimates geometry for 60 FPS WebGL rendering, and exports binary GLB and VTK.
"""

from __future__ import annotations

import os
import struct
from pathlib import Path
from typing import Tuple, Dict, Any, Optional, List
import numpy as np
try:
    from skimage import measure
    HAS_SKIMAGE = True
except ImportError:
    measure = None
    HAS_SKIMAGE = False

try:
    import trimesh
    HAS_TRIMESH = True
except ImportError:
    HAS_TRIMESH = False


def extract_surface_mesh(
    mask: np.ndarray,
    spacing: Tuple[float, float, float] = (1.0, 1.0, 1.0),
    step_size: int = 1,
    target_faces: int = 25000,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Extracts smoothed, decimated surface mesh vertices, faces, and normals.
    Optimized for real-time 60 FPS WebGL rendering in Three.js and VTK.
    """
    if np.count_nonzero(mask) == 0:
        return (
            np.zeros((0, 3), dtype=np.float32),
            np.zeros((0, 3), dtype=np.int32),
            np.zeros((0, 3), dtype=np.float32),
        )

    # Adaptive downsampling for massive volumes to keep face counts < 25k
    z_stride = max(1, int(round(mask.shape[0] / 80.0)))
    y_stride = max(1, int(round(mask.shape[1] / 160.0)))
    x_stride = max(1, int(round(mask.shape[2] / 160.0)))

    if z_stride > 1 or y_stride > 1 or x_stride > 1:
        mask_sub = mask[::z_stride, ::y_stride, ::x_stride]
        spacing_sub = (spacing[0] * z_stride, spacing[1] * y_stride, spacing[2] * x_stride)
    else:
        mask_sub = mask
        spacing_sub = spacing

    # Marching cubes with calibrated spacing
    verts, faces, normals, _ = measure.marching_cubes(
        mask_sub,
        level=0.5,
        spacing=spacing_sub,
        step_size=max(1, step_size),
    )

    # Convert coordinates from (Z, Y, X) to standard 3D graphics (X, Y, Z)
    verts_xyz = np.zeros_like(verts)
    verts_xyz[:, 0] = verts[:, 2]  # X
    verts_xyz[:, 1] = verts[:, 1]  # Y
    verts_xyz[:, 2] = verts[:, 0]  # Z

    normals_xyz = np.zeros_like(normals)
    normals_xyz[:, 0] = normals[:, 2]
    normals_xyz[:, 1] = normals[:, 1]
    normals_xyz[:, 2] = normals[:, 0]

    # Decimate if trimesh is available and face count exceeds target
    if HAS_TRIMESH and len(faces) > target_faces:
        try:
            tm = trimesh.Trimesh(vertices=verts_xyz, faces=faces, process=False)
            percent = float(target_faces) / float(len(faces))
            if 0.0 < percent < 1.0:
                tm_simplified = tm.simplify_quadric_decimation(percent)
                verts_xyz = np.asarray(tm_simplified.vertices, dtype=np.float32)
                faces = np.asarray(tm_simplified.faces, dtype=np.int32)
                normals_xyz = np.asarray(tm_simplified.vertex_normals, dtype=np.float32)
        except Exception:
            pass

    return (
        verts_xyz.astype(np.float32),
        faces.astype(np.int32),
        normals_xyz.astype(np.float32),
    )


def export_glb_mesh(
    file_path: str,
    vertices: np.ndarray,
    faces: np.ndarray,
    color_rgb: List[float],
    opacity: float = 1.0,
    name: str = "organ_mesh",
) -> str:
    """
    Exports vertices and faces to a binary GLB (glTF 2.0 binary) file.
    Works with trimesh or direct binary fallback.
    """
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    if len(vertices) == 0 or len(faces) == 0:
        # Create minimal placeholder file
        with open(file_path, "wb") as f:
            f.write(b"")
        return file_path

    if HAS_TRIMESH:
        try:
            # Create trimesh scene
            tm = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
            rgba = [int(color_rgb[0] * 255), int(color_rgb[1] * 255), int(color_rgb[2] * 255), int(opacity * 255)]
            tm.visual.vertex_colors = np.tile(rgba, (len(vertices), 1))
            scene = trimesh.Scene(tm)
            glb_data = trimesh.exchange.gltf.export_glb(scene)
            with open(file_path, "wb") as f:
                f.write(glb_data)
            return file_path
        except Exception as e:
            # Fallback to direct GLB builder
            pass

    # Direct fallback: write standard binary GLB
    _write_fallback_glb(file_path, vertices, faces, color_rgb, opacity)
    return file_path


def _write_fallback_glb(
    file_path: str,
    vertices: np.ndarray,
    faces: np.ndarray,
    color_rgb: List[float],
    opacity: float,
):
    """Generates a minimal valid self-contained GLB file without external packages."""
    import json

    v_flat = vertices.flatten().astype(np.float32).tobytes()
    f_flat = faces.flatten().astype(np.uint32).tobytes()

    # Align to 4-byte boundaries
    pad_v = (4 - (len(v_flat) % 4)) % 4
    v_flat += b"\x00" * pad_v

    pad_f = (4 - (len(f_flat) % 4)) % 4
    f_flat += b"\x00" * pad_f

    bin_buffer = v_flat + f_flat
    v_offset = 0
    v_len = len(vertices.flatten().astype(np.float32).tobytes())
    f_offset = len(v_flat)
    f_len = len(faces.flatten().astype(np.uint32).tobytes())

    min_v = [float(np.min(vertices[:, 0])), float(np.min(vertices[:, 1])), float(np.min(vertices[:, 2]))]
    max_v = [float(np.max(vertices[:, 0])), float(np.max(vertices[:, 1])), float(np.max(vertices[:, 2]))]

    gltf_json = {
        "asset": {"version": "2.0", "generator": "Meridian-MONAI-Physio"},
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0},
                        "indices": 1,
                        "material": 0,
                    }
                ]
            }
        ],
        "materials": [
            {
                "pbrMetallicRoughness": {
                    "baseColorFactor": [color_rgb[0], color_rgb[1], color_rgb[2], opacity],
                    "metallicFactor": 0.1,
                    "roughnessFactor": 0.6,
                },
                "doubleSided": True,
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "byteOffset": 0,
                "componentType": 5126,  # FLOAT
                "count": len(vertices),
                "type": "VEC3",
                "max": max_v,
                "min": min_v,
            },
            {
                "bufferView": 1,
                "byteOffset": 0,
                "componentType": 5125,  # UNSIGNED_INT
                "count": len(faces) * 3,
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": v_offset, "byteLength": v_len, "target": 34962},
            {"buffer": 0, "byteOffset": f_offset, "byteLength": f_len, "target": 34963},
        ],
        "buffers": [{"byteLength": len(bin_buffer)}],
    }

    json_str = json.dumps(gltf_json)
    json_bytes = json_str.encode("utf-8")
    pad_json = (4 - (len(json_bytes) % 4)) % 4
    json_bytes += b" " * pad_json

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_buffer)

    with open(file_path, "wb") as f:
        # Header (12 bytes)
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        # Chunk 0 (JSON)
        f.write(struct.pack("<II4s", len(json_bytes), 0x4E4F534A, b""))
        f.write(json_bytes)
        # Chunk 1 (BIN)
        f.write(struct.pack("<II4s", len(bin_buffer), 0x004E4942, b""))
        f.write(bin_buffer)


def export_vtp_mesh(
    file_path: str,
    vertices: np.ndarray,
    faces: np.ndarray,
) -> str:
    """
    Exports surface mesh to VTK PolyData (.vtp or .vtk format) for the native desktop viewer.
    """
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("# vtk DataFile Version 3.0\n")
        f.write("Meridian Organ Mesh\n")
        f.write("ASCII\n")
        f.write("DATASET POLYDATA\n")
        f.write(f"POINTS {len(vertices)} float\n")
        for v in vertices:
            f.write(f"{v[0]:.3f} {v[1]:.3f} {v[2]:.3f}\n")
        f.write(f"POLYGONS {len(faces)} {len(faces) * 4}\n")
        for fc in faces:
            f.write(f"3 {fc[0]} {fc[1]} {fc[2]}\n")
    return file_path
