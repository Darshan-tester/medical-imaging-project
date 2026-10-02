# Meridian / ScanLab AI Pro — Troubleshooting & Diagnostics Guide

This guide details common error codes, diagnostic checks, and recovery procedures across the AI workstation pipeline.

---

## 1. Structured Error Codes & Resolutions

Every pipeline in Meridian fails gracefully and returns machine-readable JSON status codes instead of unhandled exceptions:

### `GPU_UNAVAILABLE` / CPU Fallback Notice
- **Condition**: CUDA is not present, no NVIDIA GPU is detected, or PyTorch is running in CPU mode.
- **System Behavior**: The system logs `[HARDWARE] GPU unavailable. Using CPU processing with multiprocessing. Some 3D AI operations may take longer.`
- **Resolution**: No action required for basic operation; pipeline automatically utilizes optimized SciPy/NumPy vectorization on CPU. To enable CUDA, ensure NVIDIA drivers and CUDA Toolkit $\ge 11.8$ are installed, and reinstall PyTorch with CUDA support.

### `UNSUPPORTED_MODEL` (MRI Incompatibility)
- **Condition**: An anatomical segmentation model trained on CT Hounsfield Units is invoked on an MRI series (e.g., T1, T2, FLAIR).
- **Returned Code**: `MRI_SEQUENCE_INCOMPATIBLE`
- **Resolution**: Meridian avoids generating hallucinatory soft-tissue segmentations. The UI displays an informative badge: `"Unsupported Sequence: CT segmentation models cannot be applied to MRI without sequence-specific validation."`

### `STATIC_3D_STUDY` (4D Motion Pipeline)
- **Condition**: User runs the 4D Cine Motion Analysis on an ordinary static 3D CT or MRI study.
- **Returned Code**: `STATIC_3D_STUDY`
- **Resolution**: 4D dynamic cine analysis requires multi-phase or ECG-gated temporal datasets. The panel gracefully informs the user that only static volumetric data is available.

### `REGISTRATION_LOW_CONFIDENCE`
- **Condition**: Prior and current scans have completely different fields of view (e.g., prior Thorax vs current Abdomen) or severe patient motion artifacts.
- **Returned Code**: `REGISTRATION_LOW_CONFIDENCE`
- **Resolution**: The system marks the registration status as `PARTIAL` or `FAILED` and warns the radiologist before rendering the spatial subtraction map.

---

## 2. Anatomical QC Flag Explanations

When findings are flagged with `FLAG_FOR_RADIOLOGIST_REVIEW`:

| QC Flag | Reason | Recommended Clinician Action |
|---|---|---|
| `lateralityCheck: FAIL` | Text asserts "Right" while world coordinate $(x,y,z)$ falls in left lung/hemithorax. | Verify lesion position and correct laterality typo in report draft. |
| `anatomyCheck: FAIL` | Coordinate falls outside the 3D boundary of the claimed organ mask. | Check if finding is pleural/extra-organ or re-anchor annotation marker. |
| `measurementCheck: FLAG` | Caliper diameter exceeds 150 mm. | Review measurement calipers to verify whether structure is a mass or anatomical landmark. |

---

## 3. System Verification Commands

Run these commands to verify system health:

```bash
# 1. Run full MONAI Physio Workstation test suite
services\ai_worker\.venv\Scripts\python.exe -m unittest tests.test_monai_physio_workstation -v

# 2. Check hardware detection status
services\ai_worker\.venv\Scripts\python.exe -c "from services.ai_worker.hardware import detect_hardware; import json; print(json.dumps(detect_hardware(), indent=2))"

# 3. Verify TypeScript compilation
npx tsc --noEmit
```
