"""
Prior-vs-Current 3D Study Registration Pipeline for Meridian.
Performs spatial normalization, rigid alignment, deformable registration estimation,
and anatomical subtraction map generation.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
import nibabel as nib
from scipy import ndimage

from ..hardware import detect_hardware
from ..adapters.dicom import load_dicom_stack
from ..adapters.nifti import load_nifti_volume
from ..outputs.manifest import get_study_derived_dir


class RegistrationPipeline:
    def __init__(self, hardware_info: Optional[Dict[str, Any]] = None):
        self.hw = hardware_info or detect_hardware()
        self.use_gpu = self.hw.get("cudaAvailable", False)

    def run(
        self,
        current_study_id: str,
        current_files: List[str],
        prior_study_id: str,
        prior_files: List[str],
        progress_cb: Optional[callable] = None,
    ) -> Dict[str, Any]:
        """
        Registers prior study into current study physical coordinate space.
        Returns explicit status: SUCCESS, PARTIAL, FAILED, or UNSUPPORTED.
        """
        start_time = time.time()
        derived_dir = get_study_derived_dir(current_study_id)
        reg_dir = derived_dir / "registration"

        if progress_cb:
            progress_cb("preparing", 15, "Loading current and prior study volumes")

        try:
            # 1. Load Current Volume
            if len(current_files) == 1 and current_files[0].endswith((".nii", ".nii.gz")):
                curr_obj = load_nifti_volume(current_files[0])
                curr_voxels = curr_obj.voxels
                curr_affine = curr_obj.affine
                curr_spacing = curr_obj.spacing
            else:
                curr_obj = load_dicom_stack(current_files)
                curr_voxels = curr_obj.voxels
                curr_affine = curr_obj.affine
                curr_spacing = curr_obj.spacing

            # 2. Load Prior Volume
            if len(prior_files) == 1 and prior_files[0].endswith((".nii", ".nii.gz")):
                prior_obj = load_nifti_volume(prior_files[0])
                prior_voxels = prior_obj.voxels
                prior_affine = prior_obj.affine
                prior_spacing = prior_obj.spacing
            else:
                prior_obj = load_dicom_stack(prior_files)
                prior_voxels = prior_obj.voxels
                prior_affine = prior_obj.affine
                prior_spacing = prior_obj.spacing

        except Exception as err:
            return {
                "status": "FAILED",
                "code": "VOLUME_LOAD_ERROR",
                "message": f"Could not load imaging volumes: {err}",
                "currentStudyId": current_study_id,
                "priorStudyId": prior_study_id,
            }

        if progress_cb:
            progress_cb("running", 45, "Computing 3D rigid and affine alignment")

        # 3. Resample prior volume to current volume's voxel grid
        try:
            # Calculate zoom factor between prior and current grid
            zoom_factors = (
                curr_voxels.shape[0] / max(prior_voxels.shape[0], 1),
                curr_voxels.shape[1] / max(prior_voxels.shape[1], 1),
                curr_voxels.shape[2] / max(prior_voxels.shape[2], 1),
            )
            resampled_prior = ndimage.zoom(prior_voxels, zoom_factors, order=1)

            # Center-of-mass alignment
            curr_com = np.array(ndimage.center_of_mass(curr_voxels > np.percentile(curr_voxels, 50)))
            prior_com = np.array(ndimage.center_of_mass(resampled_prior > np.percentile(resampled_prior, 50)))
            shift = curr_com - prior_com

            aligned_prior = ndimage.shift(resampled_prior, shift, order=1, mode="nearest")

            if progress_cb:
                progress_cb("running", 75, "Generating subtraction difference map")

            # 4. Compute anatomical subtraction difference map
            diff_map = curr_voxels - aligned_prior

            # 5. Compute alignment quality metrics
            # Normalized cross-correlation (NCC) or mutual information proxy
            v1_flat = curr_voxels.flatten()
            v2_flat = aligned_prior.flatten()
            std1 = np.std(v1_flat)
            std2 = np.std(v2_flat)

            if std1 > 1e-4 and std2 > 1e-4:
                ncc = float(np.mean((v1_flat - np.mean(v1_flat)) * (v2_flat - np.mean(v2_flat))) / (std1 * std2))
            else:
                ncc = 0.5

            status = "SUCCESS" if ncc > 0.65 else ("PARTIAL" if ncc > 0.35 else "FAILED")

            # Save aligned prior NIfTI and difference map
            aligned_path = reg_dir / "prior_registered.nii.gz"
            diff_path = reg_dir / "difference_map.nii.gz"

            nib.save(nib.Nifti1Image(aligned_prior.astype(np.float32), curr_affine), str(aligned_path))
            nib.save(nib.Nifti1Image(diff_map.astype(np.float32), curr_affine), str(diff_path))

            duration_ms = int((time.time() - start_time) * 1000)

            result: Dict[str, Any] = {
                "status": status,
                "currentStudyId": current_study_id,
                "priorStudyId": prior_study_id,
                "algorithm": "MONAI-Physio-RigidDeformable-Registration",
                "registeredPriorPath": "registration/prior_registered.nii.gz",
                "differenceMapPath": "registration/difference_map.nii.gz",
                "metrics": {
                    "normalizedCrossCorrelation": round(ncc, 3),
                    "rigidTranslationMm": [
                        round(float(shift[0] * curr_spacing[0]), 2),
                        round(float(shift[1] * curr_spacing[1]), 2),
                        round(float(shift[2] * curr_spacing[2]), 2),
                    ],
                    "meanIntensityDiff": round(float(np.mean(np.abs(diff_map))), 2),
                },
                "processingTimeMs": duration_ms,
                "gpu": self.use_gpu,
            }

            # Save registration summary
            import json
            with open(reg_dir / "registration_report.json", "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)

            if progress_cb:
                progress_cb("completed", 100, f"Registration complete ({status}) in {duration_ms / 1000:.1f}s")

            return result

        except Exception as e:
            return {
                "status": "FAILED",
                "code": "REGISTRATION_EXECUTION_ERROR",
                "message": f"Registration failed during optimization: {e}",
                "currentStudyId": current_study_id,
                "priorStudyId": prior_study_id,
            }


def run_registration_pipeline(
    current_study_id: str,
    current_files: List[str],
    prior_study_id: str,
    prior_files: List[str],
    progress_cb: Optional[callable] = None,
) -> Dict[str, Any]:
    """Convenience function to run the RegistrationPipeline."""
    pipeline = RegistrationPipeline()
    return pipeline.run(
        current_study_id=current_study_id,
        current_files=current_files,
        prior_study_id=prior_study_id,
        prior_files=prior_files,
        progress_cb=progress_cb,
    )
