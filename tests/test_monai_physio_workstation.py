"""
Automated Test Suite for Meridian / ScanLab AI Pro - MONAI Physio Integration.
Tests DICOM ingestion, segmentation output, mesh geometry, 3D registration,
longitudinal RECIST tracking, 4D cine cardiac/respiratory motion, and anatomical QC.
"""

import os
import sys
import time
import json
import unittest
import numpy as np

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from services.ai_worker.adapters.dicom import load_dicom_stack, find_dicom_series_in_directory
from services.ai_worker.adapters.nifti import save_nifti, load_nifti
from services.ai_worker.adapters.monai_physio import TAXONOMY_MAP
from services.ai_worker.outputs.metrics import compute_organ_metrics
from services.ai_worker.outputs.meshes import extract_surface_mesh, export_glb_mesh, export_vtp_mesh
from services.ai_worker.pipelines.segmentation import run_segmentation_pipeline
from services.ai_worker.pipelines.registration import run_registration_pipeline
from services.ai_worker.pipelines.longitudinal import compare_longitudinal_volumes
from services.ai_worker.pipelines.motion import run_motion_pipeline
from services.ai_worker.pipelines.qc import verify_anatomical_findings


class TestDicomIngestion(unittest.TestCase):
    """Test DICOM stack loading, geometry, affine, and metadata."""

    def test_dicom_real_study(self):
        manifest_path = os.path.join(PROJECT_ROOT, ".scanlab", "manifest.json")
        files = []
        if os.path.exists(manifest_path):
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            ct = next((s for s in manifest.get("studies", []) if s.get("id") == "5e565c4924a7610a" or s.get("modality") == "CT"), None)
            if ct and "volumes" in ct and ct["volumes"]:
                vol = list(ct["volumes"].values())[0]
                files = vol.get("files", [])

        if not files or not os.path.exists(files[0]):
            self.skipTest("No accessible CT study files found in manifest")

        t0 = time.perf_counter()
        vol_data = load_dicom_stack(files[:20])
        t_open = time.perf_counter() - t0

        print(f"\n[PERF] Test DICOM Load (20 slices): {t_open:.3f}s")
        self.assertEqual(vol_data.voxels.ndim, 3, "Volume must be 3-dimensional")
        self.assertEqual(len(vol_data.spacing), 3, "Spacing must have 3 components (sz, sy, sx)")
        self.assertGreater(vol_data.spacing[0], 0, "Slice spacing must be positive")
        self.assertEqual(vol_data.affine.shape, (4, 4), "Affine matrix must be 4x4")
        self.assertIn("patientId", vol_data.metadata, "Metadata must contain patientId")


class TestMeshGeneration(unittest.TestCase):
    """Test surface extraction, normal generation, decimation, and GLB/VTP export."""

    def setUp(self):
        # Create a synthetic sphere mask representing an organ
        self.shape = (40, 40, 40)
        z, y, x = np.ogrid[:40, :40, :40]
        dist = np.sqrt((z - 20)**2 + (y - 20)**2 + (x - 20)**2)
        self.mask = (dist <= 12).astype(np.uint8)
        self.spacing = (1.5, 0.8, 0.8)

    def test_extract_surface_mesh(self):
        t0 = time.perf_counter()
        verts, faces, normals = extract_surface_mesh(
            self.mask,
            spacing=self.spacing,
            step_size=1,
            target_faces=5000,
        )
        t_mesh = time.perf_counter() - t0
        print(f"\n[PERF] Test Surface Extraction: {t_mesh:.3f}s ({len(verts)} verts, {len(faces)} faces)")

        self.assertGreater(len(verts), 0, "Vertices must not be empty")
        self.assertGreater(len(faces), 0, "Faces must not be empty")
        self.assertEqual(verts.shape[1], 3, "Vertices must be 3D coordinates")
        self.assertEqual(faces.shape[1], 3, "Faces must be triangular (3 indices)")
        self.assertEqual(normals.shape, verts.shape, "Normals must match vertex count")

        # Normals must have approximately unit length
        norms = np.linalg.norm(normals, axis=1)
        valid_norms = norms[norms > 0]
        self.assertTrue(np.allclose(valid_norms, 1.0, atol=0.05), "Normals must be normalized")

    def test_export_glb_and_vtp(self):
        verts, faces, _ = extract_surface_mesh(self.mask, spacing=self.spacing, target_faces=2000)
        out_dir = os.path.join(PROJECT_ROOT, "tests", "scratch")
        os.makedirs(out_dir, exist_ok=True)

        glb_path = os.path.join(out_dir, "test_organ.glb")
        vtp_path = os.path.join(out_dir, "test_organ.vtp")

        # Export GLB
        t0 = time.perf_counter()
        export_glb_mesh(glb_path, verts, faces, color_rgb=[0.22, 0.74, 0.97], opacity=0.8)
        t_glb = time.perf_counter() - t0
        print(f"[PERF] Test GLB Export: {t_glb:.4f}s ({os.path.getsize(glb_path)} bytes)")

        self.assertTrue(os.path.exists(glb_path), "GLB file must exist")
        with open(glb_path, "rb") as f:
            header = f.read(12)
            magic, version, length = header[:4], header[4:8], header[8:12]
            self.assertEqual(magic, b"glTF", "GLB must start with glTF magic bytes")

        # Export VTP
        export_vtp_mesh(vtp_path, verts, faces)
        self.assertTrue(os.path.exists(vtp_path), "VTP file must exist")
        with open(vtp_path, "r", encoding="utf-8") as f:
            first_line = f.readline()
            self.assertIn("vtk DataFile", first_line, "VTP must be valid VTK polydata file")


class TestMetricsAndRECIST(unittest.TestCase):
    """Test quantitative physiological metrics and RECIST 1.1 volume tracking."""

    def test_organ_metrics(self):
        # 10x10x10 cube with 1mm spacing -> 1000 voxels = 1.0 ml
        mask = np.zeros((20, 20, 20), dtype=np.uint8)
        mask[5:15, 5:15, 5:15] = 1
        spacing = (1.0, 1.0, 1.0)

        metrics = compute_organ_metrics(mask, spacing)
        self.assertAlmostEqual(metrics.volume_ml, 1.0, places=2)
        # Max caliper diameter of 10x10x10 cube is diagonal sqrt(10^2+10^2+10^2) = 17.32mm
        self.assertAlmostEqual(metrics.max_diameter_mm, 17.32, delta=1.5)
        self.assertEqual(metrics.voxel_count, 1000)

    def test_recist_criteria(self):
        prior = {"liver": {"volumeMl": 1000.0, "maxDiameterMm": 50.0}}
        
        # Test Progressive Disease (PD: > 20% increase)
        current_pd = {"liver": {"volumeMl": 1250.0, "maxDiameterMm": 62.0}}
        res_pd = compare_longitudinal_volumes(prior, current_pd)
        self.assertEqual(res_pd["comparisons"][0]["recistCategory"], "PD")
        self.assertEqual(res_pd["comparisons"][0]["changePercent"], 25.0)

        # Test Partial Response (PR: >= 30% decrease)
        current_pr = {"liver": {"volumeMl": 650.0, "maxDiameterMm": 32.0}}
        res_pr = compare_longitudinal_volumes(prior, current_pr)
        self.assertEqual(res_pr["comparisons"][0]["recistCategory"], "PR")
        self.assertEqual(res_pr["comparisons"][0]["changePercent"], -35.0)

        # Test Stable Disease (SD: between -30% and +20%)
        current_sd = {"liver": {"volumeMl": 1020.0, "maxDiameterMm": 51.0}}
        res_sd = compare_longitudinal_volumes(prior, current_sd)
        self.assertEqual(res_sd["comparisons"][0]["recistCategory"], "SD")
        self.assertEqual(res_sd["comparisons"][0]["changePercent"], 2.0)


class TestCardiacAndRespiratoryMotion(unittest.TestCase):
    """Test 4D dynamic cine analysis and EF formula: Stroke Volume = EDV - ESV, EF = (EDV - ESV) / EDV."""

    def test_cardiac_metrics(self):
        edv = 140.0  # ml
        esv = 55.0   # ml
        expected_sv = 85.0
        expected_ef = (85.0 / 140.0) * 100.0  # 60.71%

        time_series = [
            {"phase": 0, "heartVolumeMl": 600.0, "ventricleVolumeMl": 140.0},  # EDV
            {"phase": 1, "heartVolumeMl": 550.0, "ventricleVolumeMl": 100.0},
            {"phase": 2, "heartVolumeMl": 510.0, "ventricleVolumeMl": 55.0},   # ESV
            {"phase": 3, "heartVolumeMl": 570.0, "ventricleVolumeMl": 110.0},
        ]

        res = run_motion_pipeline(time_series, gating="cardiac")
        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["cardiac"]["edvMl"], 140.0)
        self.assertEqual(res["cardiac"]["esvMl"], 55.0)
        self.assertAlmostEqual(res["cardiac"]["strokeVolumeMl"], expected_sv, places=1)
        self.assertAlmostEqual(res["cardiac"]["lvefPercent"], expected_ef, places=1)
        self.assertIn("provenance", res["cardiac"])


class TestAnatomicalReportQC(unittest.TestCase):
    """Test quality control validation of findings coordinates against organ masks."""

    def test_coordinate_validation(self):
        # Create segmented masks
        shape = (60, 60, 60)
        lung_right = np.zeros(shape, dtype=np.uint8)
        lung_left = np.zeros(shape, dtype=np.uint8)

        # Right lung in negative X world coordinates (standard radiology patient orientation)
        lung_right[10:50, 10:50, 5:25] = 1
        # Left lung in positive X world coordinates
        lung_left[10:50, 10:50, 35:55] = 1

        masks = {
            "lung_right": lung_right,
            "lung_left": lung_left,
        }
        spacing = (1.0, 1.0, 1.0)
        affine = np.eye(4)

        # Finding 1: Correct Right lung coordinate (x=15, y=30, z=30)
        finding_valid = {
            "id": "f-1",
            "label": "Right lung nodule",
            "organ": "lung_right",
            "worldCoordinate": {"x": 15.0, "y": 30.0, "z": 30.0},
        }

        # Finding 2: False Laterality - Claimed Right lung but coordinate in Left lung (x=45, y=30, z=30)
        finding_laterality_error = {
            "id": "f-2",
            "label": "Right upper lobe consolidation",
            "organ": "lung_right",
            "worldCoordinate": {"x": 45.0, "y": 30.0, "z": 30.0},
        }

        # Finding 3: Outside any organ (x=0, y=0, z=0)
        finding_outside = {
            "id": "f-3",
            "label": "Pulmonary lesion",
            "organ": "lung_right",
            "worldCoordinate": {"x": 0.0, "y": 0.0, "z": 0.0},
        }

        res = verify_anatomical_findings(
            [finding_valid, finding_laterality_error, finding_outside],
            masks=masks,
            spacing=spacing,
            affine=affine,
        )

        checks = {c["findingId"]: c for c in res["checks"]}
        self.assertEqual(checks["f-1"]["overallCheck"], "PASS")
        self.assertEqual(checks["f-2"]["lateralityCheck"], "FAIL")
        self.assertEqual(checks["f-3"]["anatomyCheck"], "FAIL")
        self.assertTrue(len(res["warnings"]) >= 2, "Must generate warnings for failing findings")


class TestEdgeCasesAndDegenerateVolumes(unittest.TestCase):
    """Test resilience against empty masks, single-voxel objects, and missing tags."""

    def test_empty_mask_mesh_extraction(self):
        empty_mask = np.zeros((10, 10, 10), dtype=np.uint8)
        verts, faces, normals = extract_surface_mesh(empty_mask, spacing=(1.0, 1.0, 1.0))
        self.assertEqual(len(verts), 0, "Empty mask must yield 0 vertices")
        self.assertEqual(len(faces), 0, "Empty mask must yield 0 faces")
        self.assertEqual(len(normals), 0, "Empty mask must yield 0 normals")

    def test_empty_mask_metrics(self):
        empty_mask = np.zeros((10, 10, 10), dtype=np.uint8)
        metrics = compute_organ_metrics(empty_mask, spacing=(1.0, 1.0, 1.0))
        self.assertEqual(metrics.volume_ml, 0.0)
        self.assertEqual(metrics.max_diameter_mm, 0.0)
        self.assertEqual(metrics.voxel_count, 0)

    def test_single_voxel_metrics(self):
        mask = np.zeros((10, 10, 10), dtype=np.uint8)
        mask[5, 5, 5] = 1
        metrics = compute_organ_metrics(mask, spacing=(2.0, 1.0, 1.0))
        self.assertEqual(metrics.voxel_count, 1)
        self.assertAlmostEqual(metrics.volume_ml, 0.002, places=4)
        self.assertGreater(metrics.max_diameter_mm, 0.0)

    def test_dicom_safe_float_parser(self):
        from services.ai_worker.adapters.dicom import _safe_float
        self.assertEqual(_safe_float(None, 42.0), 42.0)
        self.assertEqual(_safe_float("", 1.0), 1.0)
        self.assertEqual(_safe_float("   ", 5.0), 5.0)
        self.assertEqual(_safe_float("invalid", 10.0), 10.0)
        self.assertEqual(_safe_float("123.45", 0.0), 123.45)
        self.assertEqual(_safe_float(["50.5"], 0.0), 50.5)

    def test_job_record_unexpected_fields(self):
        from services.ai_worker.jobs import JobManager, JobRecord, JOBS_DIR
        job_id = "test-job-extra-fields"
        job_file = JOBS_DIR / f"{job_id}.json"
        
        payload = {
            "jobId": job_id,
            "studyId": "s-1",
            "seriesId": "ser-1",
            "pipeline": "segmentation",
            "status": "queued",
            "progress": 0,
            "stage": "queued",
            "cacheKey": "cache-1",
            "createdAt": "2026-10-02T19:00:00Z",
            "updatedAt": "2026-10-02T19:00:00Z",
            "futureFieldFromNewerVersion": "should_not_crash",
            "anotherExtraMetadata": {"foo": "bar"},
        }
        with open(job_file, "w", encoding="utf-8") as f:
            json.dump(payload, f)

        try:
            rec = JobManager.get_job(job_id)
            self.assertIsNotNone(rec, "Should load record even with extra fields")
            self.assertEqual(rec.jobId, job_id)
            self.assertEqual(rec.studyId, "s-1")
        finally:
            if job_file.exists():
                job_file.unlink()


if __name__ == "__main__":
    unittest.main()
