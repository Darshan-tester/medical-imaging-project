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
    """Returns the path to the study-specific derived directory conforming to Section 20."""
    study_dir = get_derived_root() / study_id
    (study_dir / "heart").mkdir(parents=True, exist_ok=True)
    (study_dir / "lungs").mkdir(parents=True, exist_ok=True)
    (study_dir / "brain" / "meshes").mkdir(parents=True, exist_ok=True)
    (study_dir / "registration").mkdir(parents=True, exist_ok=True)
    (study_dir / "motion4d" / "frames").mkdir(parents=True, exist_ok=True)
    (study_dir / "findings").mkdir(parents=True, exist_ok=True)
    (study_dir / "report" / "versions").mkdir(parents=True, exist_ok=True)
    # Maintain backward compatibility aliases
    (study_dir / "segmentation").mkdir(parents=True, exist_ok=True)
    (study_dir / "meshes").mkdir(parents=True, exist_ok=True)
    (study_dir / "metrics").mkdir(parents=True, exist_ok=True)
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
    Writes the standardized machine-readable metadata.json and manifest.json for this study.
    Conforms strictly to Section 20 derived data structure.
    """
    version = kwargs.get("modelVersion", model_version)
    study_dir = get_study_derived_dir(study_id)
    manifest_path = study_dir / "manifest.json"
    metadata_path = study_dir / "metadata.json"

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
        "generatedAt": os.environ.get("MOCK_TIMESTAMP", None) or "2026-10-03T12:00:00Z",
        "derivedAssets": {
            "heart": (study_dir / "heart" / "mesh.glb").exists(),
            "lungs": (study_dir / "lungs" / "mesh.glb").exists(),
            "brain": (study_dir / "brain" / "parcellation.nii.gz").exists(),
            "registration": (study_dir / "registration" / "registered_prior.nii.gz").exists(),
            "motion4d": (study_dir / "motion4d" / "animation.glb").exists(),
            "findings": (study_dir / "findings" / "findings.json").exists(),
            "reportDraft": (study_dir / "report" / "draft.json").exists(),
            "finalReport": (study_dir / "report" / "final_report.json").exists(),
        }
    }

    if extra:
        manifest_data.update(extra)

    # Write both metadata.json (Section 20 standard) and manifest.json (legacy)
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    return metadata_path


def read_study_manifest(study_id: str) -> Optional[Dict[str, Any]]:
    """Reads metadata.json or manifest.json for a study if it exists."""
    study_dir = get_study_derived_dir(study_id)
    for target in ("metadata.json", "manifest.json"):
        p = study_dir / target
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    return None

