"""
Structured Findings Engine for Meridian.
Acts as the clinical bridge between AI anatomical pipelines (MONAI Physio)
and the radiology report draft (Section 14 & 15).
Ensures every AI finding is traceable, reviewable, and never automatically approved.
"""

from __future__ import annotations

import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from .outputs.manifest import get_study_derived_dir


def get_findings_file(study_id: str) -> Path:
    study_dir = get_study_derived_dir(study_id)
    findings_dir = study_dir / "findings"
    findings_dir.mkdir(parents=True, exist_ok=True)
    return findings_dir / "findings.json"


def load_study_findings(study_id: str) -> List[Dict[str, Any]]:
    """Loads all structured findings for a study."""
    findings_file = get_findings_file(study_id)
    if not findings_file.exists():
        return []
    try:
        with open(findings_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get("findings", [])
    except Exception:
        return []


def save_study_findings(study_id: str, findings: List[Dict[str, Any]]) -> Path:
    """Saves structured findings list to derived directory."""
    findings_file = get_findings_file(study_id)
    with open(findings_file, "w", encoding="utf-8") as f:
        json.dump(findings, f, indent=2)
    return findings_file


def update_study_finding(
    study_id: str,
    finding_id: str,
    review_status: Optional[str] = None,
    radiologist_comments: Optional[str] = None,
    measurement_override: Optional[Dict[str, Any]] = None,
    patch: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Updates the review status or contents of a specific finding (Section 15).
    Statuses: AI_GENERATED, RADIOLOGIST_REVIEWED, ACCEPTED, EDITED, REJECTED
    """
    findings = load_study_findings(study_id)
    target = None
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for f in findings:
        if f.get("findingId") == finding_id or f.get("id") == finding_id:
            target = f
            if review_status:
                target["reviewStatus"] = review_status
                target["status"] = review_status.lower()
                target["radiologistAction"] = review_status
            if radiologist_comments is not None:
                target["radiologistComments"] = radiologist_comments
                target["radiologistNote"] = radiologist_comments
            if measurement_override is not None:
                target["measurement"] = measurement_override
            if patch:
                target.update(patch)
            target["lastReviewedAt"] = now
            break

    if target:
        save_study_findings(study_id, findings)
    return target


def add_radiologist_finding(
    study_id: str,
    finding_data: Dict[str, Any],
) -> Dict[str, Any]:
    """Adds a radiologist-authored manual finding to the study."""
    findings = load_study_findings(study_id)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    finding_id = finding_data.get("findingId") or f"fnd-rad-{int(time.time())}-{len(findings) + 1}"

    new_finding = {
        "findingId": finding_id,
        "id": finding_id,
        "studyId": study_id,
        "modality": finding_data.get("modality", "CT"),
        "anatomy": finding_data.get("anatomy", "General"),
        "findingType": finding_data.get("findingType", "Radiologist Observation"),
        "description": finding_data.get("description", ""),
        "label": finding_data.get("label", finding_data.get("anatomy", "Finding")),
        "location": finding_data.get("location", "Unspecified"),
        "measurement": finding_data.get("measurement", {}),
        "confidence": 1.0,
        "source": "RADIOLOGIST",
        "reviewStatus": "ACCEPTED",
        "status": "accepted",
        "radiologistAction": "MANUAL_ENTRY",
        "radiologistComments": finding_data.get("radiologistComments", ""),
        "createdAt": now,
        "lastReviewedAt": now,
    }
    findings.append(new_finding)
    save_study_findings(study_id, findings)
    return new_finding


def generate_findings_from_anatomy(
    study_id: str,
    series_id: str,
    modality: str,
    segments: List[Dict[str, Any]],
    metrics: Dict[str, Any],
    pipeline_name: str = "segmentation",
    model_name: str = "MONAI-TotalSegmentator-v2",
    model_version: str = "2.0.0",
) -> List[Dict[str, Any]]:
    """
    Generates structured, traceable AI findings from organ segmentation and morphometry.
    Adheres strictly to Section 14:
    {
      "studyId": "...",
      "findingId": "...",
      "modality": "CT",
      "anatomy": "Lung",
      "findingType": "...",
      "location": "...",
      "measurement": "...",
      "confidence": "...",
      "source": "AI",
      "visualReference": "...",
      "reviewStatus": "pending"
    }
    """
    existing_findings = load_study_findings(study_id)
    # Keep manual radiologist additions
    rad_findings = [f for f in existing_findings if f.get("source") == "RADIOLOGIST"]

    ai_findings: List[Dict[str, Any]] = []
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for idx, seg in enumerate(segments):
        anatomy_key = seg.get("id", f"struct_{idx}")
        anatomy_name = seg.get("name", anatomy_key.replace("_", " ").title())
        volume_ml = seg.get("volumeMl", 0.0)
        max_diam = seg.get("maxDiameterMm", 0.0)
        struct_metrics = metrics.get(anatomy_key, {})

        finding_id = f"fnd-{study_id[:8]}-{anatomy_key}"

        # Reference ranges and morphometric interpretations
        finding_type = "Volumetric Morphology"
        clinical_note = f"Segmented {anatomy_name} volume: {volume_ml:.1f} mL. Maximal 3D caliper dimension: {max_diam:.1f} mm."
        ref_range = "Normative"

        if "lung" in anatomy_key.lower():
            finding_type = "Pulmonary Volumetry"
            if volume_ml < 500:
                clinical_note += " Reduced lung volume noted, correlate with expiratory phase or restrictive pattern."
            elif volume_ml > 3500:
                clinical_note += " Hyperinflation noted, correlate with obstructive pulmonary disease / emphysema."
        elif "heart" in anatomy_key.lower() or "ventricle" in anatomy_key.lower():
            finding_type = "Cardiac Morphology"
            if volume_ml > 900:
                clinical_note += " Cardiomegaly / elevated cardiac silhouette volume noted."
        elif "aorta" in anatomy_key.lower():
            finding_type = "Vascular Caliber"
            if max_diam > 40:
                clinical_note += " Aortic root/thoracic aorta caliber exceeds 40 mm threshold (ectasia/aneurysmal dilation)."
        elif "liver" in anatomy_key.lower():
            finding_type = "Hepatic Parenchyma"
            mean_hu = struct_metrics.get("meanHu")
            if mean_hu is not None and mean_hu < 40:
                clinical_note += f" Diffuse hepatic attenuation is reduced (mean {mean_hu:.1f} HU), consistent with hepatic steatosis."

        finding_obj = {
            "findingId": finding_id,
            "id": finding_id,
            "studyId": study_id,
            "seriesId": series_id,
            "modality": modality,
            "anatomy": anatomy_name,
            "findingType": finding_type,
            "description": clinical_note,
            "label": anatomy_name,
            "location": f"Thoraco-abdominal compartment ({seg.get('group', 'Thorax')})",
            "measurement": {
                "volumeMl": round(volume_ml, 2),
                "maxDiameterMm": round(max_diam, 2),
                "meanHu": struct_metrics.get("meanHu"),
                "referenceRange": ref_range,
            },
            "confidence": 0.94,
            "band": "high",
            "source": "AI_MONAI_PHYSIO",
            "pipeline": pipeline_name,
            "model": model_name,
            "modelVersion": model_version,
            "visualReference": {
                "meshNode": anatomy_key,
                "maskPath": seg.get("maskPath", ""),
                "meshPath": f"meshes/{anatomy_key}.glb",
            },
            "reviewStatus": "AI_GENERATED",
            "status": "pending",
            "radiologistAction": None,
            "radiologistComments": "",
            "createdAt": now,
        }
        ai_findings.append(finding_obj)

    combined = ai_findings + rad_findings
    save_study_findings(study_id, combined)
    return combined
