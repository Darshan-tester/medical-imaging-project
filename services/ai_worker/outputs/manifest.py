"""
Manifest and Derived Storage Manager for Meridian AI Worker.
Ensures derived outputs (segmentations, meshes, metrics) are organized
in standard machine-readable directories without touching raw input datasets.
"""

from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional


def get_derived_root() -> Path:
    """Returns the base directory for derived outputs."""
    env_root = os.environ.get("SCANLAB_DERIVED_ROOT")
    if env_root and os.path.exists(env_root):
        return Path(env_root)

    # Default to .scanlab/derived inside project workspace
    workspace_root = Path(__file__).resolve().parents[3]
    derived_dir = workspace_root / ".scanlab" / "derived"
    derived_dir.mkdir(parents=True, exist_ok=True)
    return derived_dir


def get_study_derived_dir(study_id: str) -> Path:
    """Returns the path to the study-specific derived directory."""
    study_dir = get_derived_root() / study_id
    (study_dir / "segmentation").mkdir(parents=True, exist_ok=True)
    (study_dir / "meshes").mkdir(parents=True, exist_ok=True)
    (study_dir / "metrics").mkdir(parents=True, exist_ok=True)
    (study_dir / "registration").mkdir(parents=True, exist_ok=True)
    (study_dir / "motion").mkdir(parents=True, exist_ok=True)
    return study_dir


def write_study_manifest(
    study_id: str,
    pipeline: str,
    status: str,
    model: str = "MONAI-Physio-Anatomy-Engine",
    model_version: str = "2.0.0",
    modality: str = "CT",
    segments: Optional[List[Dict[str, Any]]] = None,
    meshes: Optional[List[Dict[str, Any]]] = None,
    metrics: Optional[Dict[str, Any]] = None,
    processing_time_ms: int = 0,
    gpu: bool = False,
    warnings: Optional[List[str]] = None,
    extra: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> Path:
    """
    Writes the standardized machine-readable manifest.json for this study.
    """
    version = kwargs.get("modelVersion", model_version)
    study_dir = get_study_derived_dir(study_id)
    manifest_path = study_dir / "manifest.json"

    manifest_data: Dict[str, Any] = {
        "studyId": study_id,
        "pipeline": pipeline,
        "status": status,
        "model": model,
        "modelVersion": version,
        "modality": modality,
        "segments": segments or [],
        "meshes": meshes or [],
        "metrics": metrics or {},
        "processingTimeMs": processing_time_ms,
        "gpu": gpu,
        "warnings": warnings or [],
        "generatedAt": os.environ.get("MOCK_TIMESTAMP", None) or "2026-10-02T18:30:00Z",
    }

    if extra:
        manifest_data.update(extra)

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    return manifest_path


def read_study_manifest(study_id: str) -> Optional[Dict[str, Any]]:
    """Reads manifest.json for a study if it exists."""
    study_dir = get_study_derived_dir(study_id)
    manifest_path = study_dir / "manifest.json"
    if not manifest_path.exists():
        return None
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None
