"""
Anatomical Quality-Control (QC) and Report Validation Pipeline.
Verifies AI findings and report assertions against real 3D segmented organ masks
and physical world coordinates.
"""

from __future__ import annotations

import os
import json
from pathlib import Path
from typing import Dict, Any, List, Optional
import numpy as np
import nibabel as nib

from ..outputs.manifest import get_study_derived_dir


class AnatomicalQCPipeline:
    def run(
        self,
        study_id: str,
        findings: List[Dict[str, Any]],
        report_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Validates findings against segmented anatomical masks.
        """
        derived_dir = get_study_derived_dir(study_id)
        seg_dir = derived_dir / "segmentation"
        anatomy_path = derived_dir / "metrics" / "anatomy.json"

        anatomy_metrics = {}
        if anatomy_path.exists():
            try:
                with open(anatomy_path, "r", encoding="utf-8") as f:
                    anatomy_metrics = json.load(f)
            except Exception:
                anatomy_metrics = {}

        # Load available binary masks
        loaded_masks: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
        if seg_dir.exists():
            for f in os.listdir(seg_dir):
                if f.endswith(".nii.gz") or f.endswith(".nii"):
                    organ_name = f.replace(".nii.gz", "").replace(".nii", "")
                    try:
                        nii = nib.load(str(seg_dir / f))
                        loaded_masks[organ_name] = (nii.get_fdata() > 0, nii.affine)
                    except Exception:
                        pass

        finding_checks: List[Dict[str, Any]] = []
        overall_warnings: List[str] = []

        for f in findings:
            f_id = f.get("id", "finding-unknown")
            label = f.get("label", "Unknown finding")
            location = f.get("location", "")
            world_coord = f.get("worldCoordinate") or f.get("region")
            claimed_organ = f.get("organ", "")
            measurement = f.get("measurements") or {}

            anatomy_check = "PASS"
            laterality_check = "PASS"
            measurement_check = "PASS"
            checks_warnings: List[str] = []

            # 1. Coordinate vs Anatomical Mask Verification
            if world_coord and isinstance(world_coord, dict) and "x" in world_coord and "y" in world_coord and "z" in world_coord:
                x_w = float(world_coord["x"])
                y_w = float(world_coord["y"])
                z_w = float(world_coord["z"])

                # If organ claimed (e.g. lung_left, lung_right, liver)
                target_mask_key = claimed_organ.lower().replace(" ", "_")
                if target_mask_key in loaded_masks:
                    mask_arr, affine = loaded_masks[target_mask_key]
                    try:
                        inv_affine = np.linalg.inv(affine)
                        vox_coord = inv_affine @ np.array([x_w, y_w, z_w, 1.0])
                        vx = int(round(vox_coord[0]))
                        vy = int(round(vox_coord[1]))
                        vz = int(round(vox_coord[2]))

                        # Check bounds and mask containment
                        if 0 <= vz < mask_arr.shape[0] and 0 <= vy < mask_arr.shape[1] and 0 <= vx < mask_arr.shape[2]:
                            if not mask_arr[vz, vy, vx]:
                                anatomy_check = "FLAG_FOR_REVIEW"
                                checks_warnings.append(
                                    f"Coordinate ({x_w:.1f}, {y_w:.1f}, {z_w:.1f}) falls outside the 3D boundary of claimed {claimed_organ}."
                                )
                        else:
                            anatomy_check = "FLAG_FOR_REVIEW"
                            checks_warnings.append(f"Coordinate ({x_w:.1f}, {y_w:.1f}, {z_w:.1f}) is out of volumetric bounding extents.")
                    except Exception as coord_err:
                        checks_warnings.append(f"Coordinate transform check note: {coord_err}")

            # 2. Laterality Verification (Left vs Right)
            label_lower = (label + " " + location).lower()
            if "left" in label_lower and "right" in label_lower:
                laterality_check = "FLAG_FOR_REVIEW"
                checks_warnings.append("Ambiguous or contradictory laterality: mentions both 'left' and 'right'.")
            elif "right" in label_lower:
                if claimed_organ and "left" in claimed_organ.lower():
                    laterality_check = "FAIL"
                    checks_warnings.append(f"Laterality contradiction: label asserts 'Right' but organ is '{claimed_organ}'.")
            elif "left" in label_lower:
                if claimed_organ and "right" in claimed_organ.lower():
                    laterality_check = "FAIL"
                    checks_warnings.append(f"Laterality contradiction: label asserts 'Left' but organ is '{claimed_organ}'.")

            # 3. Measurement Validation
            if measurement:
                len_mm = measurement.get("lengthMm") or measurement.get("maxDiameterMm")
                if len_mm is not None and float(len_mm) > 150.0:
                    measurement_check = "FLAG_FOR_REVIEW"
                    checks_warnings.append(f"Unusually large anatomical lesion measurement ({len_mm} mm) requires radiologist verification.")

            status_verdict = "PASS" if not checks_warnings else ("FLAG_FOR_REVIEW" if "FAIL" not in [laterality_check, anatomy_check] else "FAIL")

            finding_checks.append({
                "findingId": f_id,
                "label": label,
                "claimedOrgan": claimed_organ,
                "status": status_verdict,
                "anatomyCheck": anatomy_check,
                "lateralityCheck": laterality_check,
                "measurementCheck": measurement_check,
                "warnings": checks_warnings,
            })

            overall_warnings.extend(checks_warnings)

        passed = not any(fc["status"] == "FAIL" for fc in finding_checks)

        result: Dict[str, Any] = {
            "studyId": study_id,
            "passed": passed,
            "overallStatus": "PASS" if passed and not overall_warnings else "FLAG_FOR_RADIOLOGIST_REVIEW",
            "findingsEvaluated": len(finding_checks),
            "findingsWithWarnings": sum(1 for fc in finding_checks if fc["warnings"]),
            "checks": finding_checks,
            "warnings": overall_warnings,
            "provenance": {
                "algorithm": "Meridian-Anatomical-Report-QC-Engine",
                "rulesVersion": "2.0.0",
                "groundedInSegmentations": bool(loaded_masks),
            },
        }

        # Save QC report to derived directory if possible
        try:
            (derived_dir / "metrics").mkdir(parents=True, exist_ok=True)
            with open(derived_dir / "metrics" / "anatomical_qc.json", "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception:
            pass

        return result


def verify_anatomical_findings(
    findings_or_study_id: Any,
    findings: Optional[List[Dict[str, Any]]] = None,
    masks: Optional[Dict[str, np.ndarray]] = None,
    spacing: Optional[Tuple[float, float, float]] = None,
    affine: Optional[np.ndarray] = None,
) -> Dict[str, Any]:
    """
    Validates finding world coordinates against organ segmentation masks.
    Can be called directly with findings and in-memory masks, or with a study_id.
    """
    if isinstance(findings_or_study_id, list):
        target_findings = findings_or_study_id
        study_id = "in-memory"
    else:
        study_id = str(findings_or_study_id)
        target_findings = findings or []

    if affine is None:
        affine = np.eye(4)

    inv_affine = np.linalg.inv(affine)

    finding_checks = []
    overall_warnings = []

    for f in target_findings:
        f_id = f.get("id", "finding-unknown")
        label = f.get("label", "")
        claimed_organ = (f.get("organ") or "").lower().replace(" ", "_")
        world_coord = f.get("worldCoordinate") or {}

        x_w = float(world_coord.get("x", 0.0))
        y_w = float(world_coord.get("y", 0.0))
        z_w = float(world_coord.get("z", 0.0))

        vox = inv_affine @ np.array([x_w, y_w, z_w, 1.0])
        vx = int(round(vox[0]))
        vy = int(round(vox[1]))
        vz = int(round(vox[2]))

        containing_organs = []
        if masks:
            for organ_name, mask_arr in masks.items():
                if 0 <= vz < mask_arr.shape[0] and 0 <= vy < mask_arr.shape[1] and 0 <= vx < mask_arr.shape[2]:
                    if mask_arr[vz, vy, vx] > 0:
                        containing_organs.append(organ_name.lower().replace(" ", "_"))

        anatomy_check = "PASS"
        laterality_check = "PASS"
        overall_check = "PASS"
        f_warnings = []

        if masks:
            if claimed_organ in containing_organs:
                anatomy_check = "PASS"
                laterality_check = "PASS"
                overall_check = "PASS"
            elif "right" in claimed_organ and any("left" in o for o in containing_organs):
                laterality_check = "FAIL"
                overall_check = "FAIL"
                msg = f"Laterality check failed: Finding claimed '{claimed_organ}' but coordinate falls in '{containing_organs}'"
                f_warnings.append(msg)
                overall_warnings.append(msg)
            elif "left" in claimed_organ and any("right" in o for o in containing_organs):
                laterality_check = "FAIL"
                overall_check = "FAIL"
                msg = f"Laterality check failed: Finding claimed '{claimed_organ}' but coordinate falls in '{containing_organs}'"
                f_warnings.append(msg)
                overall_warnings.append(msg)
            else:
                anatomy_check = "FAIL"
                overall_check = "FAIL"
                msg = f"Anatomy check failed: Finding coordinate ({x_w}, {y_w}, {z_w}) falls outside {claimed_organ} mask"
                f_warnings.append(msg)
                overall_warnings.append(msg)

        finding_checks.append({
            "findingId": f_id,
            "label": label,
            "claimedOrgan": claimed_organ,
            "containingOrgans": containing_organs,
            "overallCheck": overall_check,
            "anatomyCheck": anatomy_check,
            "lateralityCheck": laterality_check,
            "status": overall_check,
            "warnings": f_warnings,
        })

    return {
        "studyId": study_id,
        "passed": len(overall_warnings) == 0,
        "overallStatus": "PASS" if not overall_warnings else "FLAG_FOR_RADIOLOGIST_REVIEW",
        "checks": finding_checks,
        "warnings": overall_warnings,
        "provenance": {
            "algorithm": "Meridian-Anatomical-Report-QC-Engine",
            "rulesVersion": "2.0.0",
        },
    }
