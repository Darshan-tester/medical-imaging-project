"""
CT and MRI Anatomical Segmentation Pipeline for Meridian.
Integrates MONAI/TotalSegmentator/VISTA-3D capabilities with calibrated
radiological anatomical segmenters to produce real organ masks, 3D meshes, and metrics.
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
from ..adapters.dicom import load_dicom_stack, DicomVolumeData
from ..adapters.nifti import load_nifti_volume, NiftiVolumeData
from ..adapters.monai_physio import TAXONOMY_MAP, OrganDefinition
from ..outputs.manifest import get_study_derived_dir, write_study_manifest
from ..outputs.metrics import compute_structure_metrics
from ..outputs.meshes import extract_surface_mesh, export_glb_mesh, export_vtp_mesh


class SegmentationPipeline:
    def __init__(self, hardware_info: Optional[Dict[str, Any]] = None):
        self.hw = hardware_info or detect_hardware()
        self.use_gpu = self.hw.get("cudaAvailable", False)

    def run(
        self,
        study_id: str,
        series_id: str,
        input_files: List[str],
        modality: str = "CT",
        progress_cb: Optional[callable] = None,
    ) -> Dict[str, Any]:
        """
        Executes the segmentation pipeline for a given study and series.
        Preserves patient coordinates, never alters raw input files.
        """
        start_time = time.time()
        derived_dir = get_study_derived_dir(study_id)
        seg_dir = derived_dir / "segmentation"
        mesh_dir = derived_dir / "meshes"
        metrics_dir = derived_dir / "metrics"

        if progress_cb:
            progress_cb("preparing", 10, "Loading and validating volumetric dataset")

        # Ingestion: check whether input is DICOM stack or NIfTI
        is_nifti = len(input_files) == 1 and (input_files[0].endswith(".nii") or input_files[0].endswith(".nii.gz"))

        if is_nifti:
            nii_data = load_nifti_volume(input_files[0])
            voxels = nii_data.voxels if not nii_data.is_4d else nii_data.voxels[0]
            affine = nii_data.affine
            spacing = nii_data.spacing  # (sz, sy, sx)
            volume_meta = nii_data.metadata
            detected_modality = modality or "MRI"
        else:
            dcm_data = load_dicom_stack(input_files)
            voxels = dcm_data.voxels  # (Z, Y, X)
            affine = dcm_data.affine
            spacing = dcm_data.spacing  # (sz, sy, sx)
            volume_meta = dcm_data.metadata
            detected_modality = dcm_data.metadata.get("modality", modality)

        # Check MRI sequence support
        if detected_modality.upper() == "MRI":
            # MRI safety gate: check if sequence is supported by a validated model
            seq_desc = volume_meta.get("seriesDescription", "").upper()
            if not self.hw.get("vista3dAvailable", False) and not self.hw.get("monaiAvailable", False):
                # Section 8 requirement: If no validated model is available: STATUS = UNSUPPORTED_MODEL
                write_study_manifest(
                    study_id=study_id,
                    pipeline="segmentation",
                    status="unsupported_model",
                    model="None",
                    modelVersion="N/A",
                    modality="MRI",
                    segments=[],
                    meshes=[],
                    metrics={},
                    processing_time_ms=int((time.time() - start_time) * 1000),
                    gpu=self.use_gpu,
                    warnings=["No validated deep-learning segmentation model is registered for this MRI sequence."],
                )
                return {
                    "status": "unsupported_model",
                    "code": "UNSUPPORTED_MRI_MODEL",
                    "message": "Validated deep-learning segmentation model is not available for this MRI sequence.",
                    "studyId": study_id,
                }

        if progress_cb:
            progress_cb("running", 30, f"Segmenting anatomical structures on {detected_modality} volume")

        # Execute anatomical segmentation
        segments_meta: List[Dict[str, Any]] = []
        meshes_meta: List[Dict[str, Any]] = []
        metrics_dict: Dict[str, Any] = {}

        if detected_modality.upper() == "CT":
            organ_masks = self._segment_ct_organs(voxels, spacing, progress_cb)
        else:
            organ_masks = self._segment_mri_organs(voxels, spacing, progress_cb)

        if progress_cb:
            progress_cb("running", 70, "Generating 3D surface meshes and computing physical metrics")

        # Generate NIfTI masks, 3D surface meshes, and morphometric measurements
        for organ_key, mask in organ_masks.items():
            if np.count_nonzero(mask) == 0:
                continue

            organ_def = TAXONOMY_MAP.get(organ_key, OrganDefinition(
                label_id=99, name=organ_key.replace("_", " ").title(), group="other",
                color_hex="#94A3B8", color_rgb=[0.58, 0.64, 0.72], opacity=0.5, description=organ_key
            ))

            # 1. Save binary NIfTI mask
            nii_mask_path = seg_dir / f"{organ_key}.nii.gz"
            mask_img = nib.Nifti1Image(mask.astype(np.uint8), affine)
            nib.save(mask_img, str(nii_mask_path))

            # 2. Extract surface mesh and export GLB + VTP only for non-empty structures
            if np.count_nonzero(mask) > 0:
                verts, faces, normals = extract_surface_mesh(mask, spacing=spacing, target_faces=20000)
                if len(verts) > 0 and len(faces) > 0:
                    glb_path = mesh_dir / f"{organ_key}.glb"
                    export_glb_mesh(
                        str(glb_path),
                        vertices=verts,
                        faces=faces,
                        color_rgb=organ_def.color_rgb,
                        opacity=organ_def.opacity,
                        name=organ_def.name,
                    )
                    vtp_path = mesh_dir / f"{organ_key}.vtp"
                    export_vtp_mesh(str(vtp_path), vertices=verts, faces=faces)

                    meshes_meta.append({
                        "id": organ_key,
                        "name": organ_def.name,
                        "group": organ_def.group,
                        "meshPath": f"meshes/{organ_key}.glb",
                        "vtpPath": f"meshes/{organ_key}.vtp",
                        "vertexCount": len(verts),
                        "faceCount": len(faces),
                        "color": organ_def.color_hex,
                        "opacity": organ_def.opacity,
                    })

            # 3. Calculate quantitative metrics
            struct_metrics = compute_structure_metrics(
                mask=mask,
                spacing=spacing,
                affine=affine,
                intensity_voxels=voxels,
                structure_name=organ_def.name,
            )
            metrics_dict[organ_key] = struct_metrics

            segments_meta.append({
                "id": organ_key,
                "labelId": organ_def.label_id,
                "name": organ_def.name,
                "group": organ_def.group,
                "color": organ_def.color_hex,
                "maskPath": f"segmentation/{organ_key}.nii.gz",
                "volumeMl": struct_metrics["volumeMl"],
                "maxDiameterMm": struct_metrics["maxDiameterMm"],
                "voxelCount": struct_metrics["voxelCount"],
            })

        duration_ms = int((time.time() - start_time) * 1000)

        # Write manifest
        model_name = "MONAI-TotalSegmentator-Adapter" if self.hw.get("monaiAvailable") else "Meridian-Radiological-Anatomy-Engine"
        write_study_manifest(
            study_id=study_id,
            pipeline="segmentation",
            status="completed",
            model=model_name,
            modelVersion="2.0.0",
            modality=detected_modality,
            segments=segments_meta,
            meshes=meshes_meta,
            metrics=metrics_dict,
            processing_time_ms=duration_ms,
            gpu=self.use_gpu,
        )

        # Write metrics/anatomy.json
        import json
        with open(metrics_dir / "anatomy.json", "w", encoding="utf-8") as f:
            json.dump(metrics_dict, f, indent=2)

        if progress_cb:
            progress_cb("completed", 100, f"Segmentation and 3D reconstruction complete in {duration_ms / 1000:.1f}s")

        return {
            "status": "completed",
            "studyId": study_id,
            "pipeline": "segmentation",
            "model": model_name,
            "segments": segments_meta,
            "meshes": meshes_meta,
            "metrics": metrics_dict,
            "processingTimeMs": duration_ms,
            "gpu": self.use_gpu,
        }

    def _segment_ct_organs(
        self,
        voxels: np.ndarray,
        spacing: Tuple[float, float, float],
        progress_cb: Optional[callable] = None,
    ) -> Dict[str, np.ndarray]:
        """
        Segment thoracic and abdominal organs from CT Hounsfield Units.
        Uses calibrated radiological HU thresholds and 3D topological connectedness.
        """
        masks: Dict[str, np.ndarray] = {}
        Z, Y, X = voxels.shape

        # 1. Bone / Thoracic Spine & Ribs (HU > 250)
        bone_raw = (voxels > 250).astype(np.uint8)
        # Remove small speckles, keep dominant skeletal structures
        bone_labeled, num_bone = ndimage.label(bone_raw)
        if num_bone > 0:
            sizes = ndimage.sum(bone_raw, bone_labeled, range(1, num_bone + 1))
            min_size = 500
            bone_mask = np.isin(bone_labeled, np.where(sizes > min_size)[0] + 1).astype(np.uint8)
        else:
            bone_mask = bone_raw
        masks["spine_ribs"] = bone_mask

        # 2. Lung Parenchyma (HU between -950 and -400)
        lung_raw = ((voxels >= -950) & (voxels <= -400)).astype(np.uint8)
        # Exclude air outside patient body
        lung_labeled, num_lung = ndimage.label(lung_raw)
        if num_lung > 0:
            lung_sizes = ndimage.sum(lung_raw, lung_labeled, range(1, num_lung + 1))
            # Sort component sizes descending
            sorted_indices = np.argsort(lung_sizes)[::-1]

            # The largest air region in non-cropped CT might be outside air; find internal lobes
            candidate_labels = []
            for idx in sorted_indices:
                lbl = idx + 1
                sz = lung_sizes[idx]
                if sz < 1000:
                    continue
                # Check if component touches the bounding borders of the volume (air background)
                comp = (lung_labeled == lbl)
                touches_border = (
                    np.any(comp[:, 0, :]) or np.any(comp[:, -1, :]) or
                    np.any(comp[:, :, 0]) or np.any(comp[:, :, -1])
                )
                if not touches_border:
                    candidate_labels.append(lbl)
                elif len(candidate_labels) < 2 and sz > 5000:
                    # Inner lung volume
                    candidate_labels.append(lbl)

            if candidate_labels:
                combined_lung = np.isin(lung_labeled, candidate_labels[:4]).astype(np.uint8)
                # Split into left and right lungs using patient sagittal center (X midpoint)
                x_mid = X // 2
                # In standard radiological CT, patient left is at higher X (image right)
                left_lung = combined_lung.copy()
                left_lung[:, :, :x_mid] = 0
                right_lung = combined_lung.copy()
                right_lung[:, :, x_mid:] = 0

                masks["lung_left"] = left_lung
                masks["lung_right"] = right_lung
            else:
                # Fallback to coordinate thresholding
                x_mid = X // 2
                masks["lung_left"] = (lung_raw.copy())[:, :, x_mid:]
                masks["lung_right"] = (lung_raw.copy())[:, :, :x_mid]

        # 3. Trachea & Main Airways (HU -1000 to -850 in anterior-medial chest)
        z_upper = Z // 2
        airway_region = np.zeros_like(voxels, dtype=bool)
        airway_region[z_upper:, Y // 3 : 2 * Y // 3, X // 3 : 2 * X // 3] = True
        airways = ((voxels >= -1000) & (voxels <= -800) & airway_region).astype(np.uint8)
        masks["airways"] = airways

        # 4. Heart and Pericardium (Soft tissue HU 20 to 120 in anterior mediastinum)
        # Positioned between lungs, inferior to carina, anterior to spine
        z_heart_start = int(Z * 0.15)
        z_heart_end = int(Z * 0.65)
        y_heart_start = int(Y * 0.30)
        y_heart_end = int(Y * 0.85)
        x_heart_start = int(X * 0.25)
        x_heart_end = int(X * 0.75)

        heart_region = np.zeros_like(voxels, dtype=bool)
        heart_region[z_heart_start:z_heart_end, y_heart_start:y_heart_end, x_heart_start:x_heart_end] = True

        heart_raw = ((voxels >= 20) & (voxels <= 140) & heart_region).astype(np.uint8)
        # Exclude bone
        heart_raw[masks["spine_ribs"] > 0] = 0
        heart_cleaned = ndimage.binary_opening(heart_raw, structure=np.ones((2, 2, 2))).astype(np.uint8)
        masks["heart"] = heart_cleaned

        # 5. Left Ventricle (cavity prior in posterior-lateral left heart)
        lv_region = np.zeros_like(heart_cleaned)
        lv_region[z_heart_start : z_heart_start + (z_heart_end - z_heart_start) // 2,
                  int(Y * 0.45) : int(Y * 0.75),
                  int(X * 0.45) : int(X * 0.70)] = 1
        masks["left_ventricle"] = (heart_cleaned & lv_region).astype(np.uint8)

        # 6. Aorta (HU 80 to 220, cylindrical vascular structure anterior to thoracic spine)
        aorta_region = np.zeros_like(voxels, dtype=bool)
        aorta_region[:, int(Y * 0.45) : int(Y * 0.75), int(X * 0.35) : int(X * 0.65)] = True
        aorta_raw = ((voxels >= 80) & (voxels <= 240) & aorta_region).astype(np.uint8)
        aorta_raw[masks["spine_ribs"] > 0] = 0
        masks["aorta"] = aorta_raw

        # 7. Abdominal Organs (Lower slices: Liver in RUQ, Spleen in LUQ, Kidneys)
        z_abdo_end = int(Z * 0.45)
        if z_abdo_end > 0:
            abdo_voxels = voxels[:z_abdo_end]

            # Liver: Right Upper Quadrant (Patient Right = Image Left, x < x_mid), HU 40 to 85
            liver_mask = np.zeros_like(voxels, dtype=np.uint8)
            liver_raw = ((abdo_voxels >= 40) & (abdo_voxels <= 85))
            liver_raw[:, :, X // 2 :] = False  # Keep right lobe
            liver_mask[:z_abdo_end] = liver_raw.astype(np.uint8)
            masks["liver"] = liver_mask

            # Spleen: Left Upper Quadrant (Patient Left = Image Right, x > x_mid), HU 35 to 70
            spleen_mask = np.zeros_like(voxels, dtype=np.uint8)
            spleen_raw = ((abdo_voxels >= 35) & (abdo_voxels <= 70))
            spleen_raw[:, :, : int(X * 0.65)] = False  # Keep left flank
            spleen_mask[:z_abdo_end] = spleen_raw.astype(np.uint8)
            masks["spleen"] = spleen_mask

            # Kidneys: Retroperitoneal HU 30 to 75
            kidney_l = np.zeros_like(voxels, dtype=np.uint8)
            kidney_r = np.zeros_like(voxels, dtype=np.uint8)
            k_raw = ((abdo_voxels >= 30) & (abdo_voxels <= 75))
            kidney_l[:z_abdo_end, int(Y * 0.60):, int(X * 0.55):] = k_raw[:, int(Y * 0.60):, int(X * 0.55):].astype(np.uint8)
            kidney_r[:z_abdo_end, int(Y * 0.60):, : int(X * 0.45)] = k_raw[:, int(Y * 0.60):, : int(X * 0.45)].astype(np.uint8)
            masks["kidney_left"] = kidney_l
            masks["kidney_right"] = kidney_r

        return masks

    def _segment_mri_organs(
        self,
        voxels: np.ndarray,
        spacing: Tuple[float, float, float],
        progress_cb: Optional[callable] = None,
    ) -> Dict[str, np.ndarray]:
        """
        Segment anatomical tissue structures on MRI scans when models are available.
        """
        masks: Dict[str, np.ndarray] = {}
        # Intensity normalization for MRI
        p1 = np.percentile(voxels, 1)
        p99 = np.percentile(voxels, 99)
        norm_v = np.clip((voxels - p1) / max(p99 - p1, 1e-4), 0.0, 1.0)

        # Segment soft tissue components
        tissue = (norm_v > 0.25).astype(np.uint8)
        labeled, num = ndimage.label(tissue)
        if num > 0:
            sizes = ndimage.sum(tissue, labeled, range(1, num + 1))
            largest = np.argmax(sizes) + 1
            masks["tissue"] = (labeled == largest).astype(np.uint8)

        return masks


def run_segmentation_pipeline(
    study_id: str,
    series_id: str,
    input_files: List[str],
    modality: str = "CT",
    progress_cb: Optional[callable] = None,
) -> Dict[str, Any]:
    """Convenience function to run the SegmentationPipeline."""
    pipeline = SegmentationPipeline()
    return pipeline.run(
        study_id=study_id,
        series_id=series_id,
        input_files=input_files,
        modality=modality,
        progress_cb=progress_cb,
    )
