# Meridian AI Pipeline Architecture & Execution Specification

This document provides technical documentation for the AI pipelines implemented in `services/ai_worker/pipelines/`.

---

## Pipeline 1: Volumetric Ingestion & Validation

**Location**: `services/ai_worker/adapters/dicom.py` & `adapters/nifti.py`

### Workflow
1. **Input Detection**: Accepts either a collection of DICOM slice files or a 3D/4D NIfTI file (`.nii` / `.nii.gz`).
2. **DICOM Header Parsing**:
   - Extracts Patient ID, Study Instance UID, Series Instance UID, Modality (`CT` / `MR`).
   - Reads Image Position (Patient) `(0020,0032)` and Image Orientation (Patient) `(0020,0037)`.
   - Computes slice thickness and physical spacing: $(s_z, s_y, s_x)$ in millimeters.
   - Sorts slices along the normal vector perpendicular to the imaging plane to guarantee correct anatomical ordering.
3. **Intensity Calibration**:
   - For CT: Applies Rescale Slope `(0028,1053)` and Rescale Intercept `(0028,1052)` to convert raw pixel data into calibrated Hounsfield Units (HU).
   - For MRI: Preserves native signal intensity and calculates percentile-based dynamic range normalizations $[P_1, P_{99}]$.
4. **Coordinate Affine Matrix**:
   - Constructs a rigorous $4 \times 4$ direction matrix mapping voxel indices $(i, j, k)$ directly to patient physical world coordinates $(X_{mm}, Y_{mm}, Z_{mm})$.

---

## Pipeline 2: CT & MRI Anatomical Segmentation

**Location**: `services/ai_worker/pipelines/segmentation.py`

### Supported Anatomical Structures (CT)
The pipeline segments 11 core anatomical structures with defined Hounsfield Unit attenuation windows and spatial anatomical constraints:

| Structure Key | Anatomical Target | Standard HU Window | Spatial Boundary |
|---|---|---|---|
| `lung_left` | Left Lung Parenchyma | -950 to -400 HU | Thoracic left hemithorax |
| `lung_right` | Right Lung Parenchyma | -950 to -400 HU | Thoracic right hemithorax |
| `lung_upper_lobe_right` | Right Upper Lobe | -950 to -400 HU | Cranial 40% of right lung |
| `lung_lower_lobe_right` | Right Lower Lobe | -950 to -400 HU | Caudal 45% of right lung |
| `lung_upper_lobe_left` | Left Upper Lobe | -950 to -400 HU | Cranial 45% of left lung |
| `lung_lower_lobe_left` | Left Lower Lobe | -950 to -400 HU | Caudal 45% of left lung |
| `heart` | Cardiac silhouette / Myocardium | 25 to 110 HU | Anterior/middle mediastinum |
| `liver` | Hepatic Parenchyma | 45 to 85 HU | Right upper quadrant subdiaphragmatic |
| `spleen` | Splenic Parenchyma | 35 to 65 HU | Left upper quadrant posterolateral |
| `kidney_left` | Left Kidney | 30 to 75 HU | Left retroperitoneum |
| `kidney_right` | Right Kidney | 30 to 75 HU | Right retroperitoneum |
| `aorta` | Thoracic / Abdominal Aorta | 100 to 300 HU | Prevertebral mediastinum/retroperitoneum |
| `spine` | Vertebral Column & Skeletal Elements | > 220 HU | Posterior axial skeleton |

### MRI Sequence Compatibility Check
MRI sequences vary widely (T1, T2, FLAIR, DWI, ADC). If a CT-specific model is requested for an MRI study, the pipeline returns a structured status:
```json
{
  "status": "UNSUPPORTED_MODEL",
  "code": "MRI_SEQUENCE_INCOMPATIBLE",
  "message": "CT segmentation model cannot be applied to MRI series without sequence validation."
}
```
No fake or hallucinated segmentations are ever generated.

---

## Pipeline 3: 3D Surface Reconstruction & Decimation

**Location**: `services/ai_worker/outputs/meshes.py`

```
Binary Segmentation Mask
         |
         v
Marching Cubes Isosurface Extraction (skimage.measure.marching_cubes)
         |
         v
Laplacian Surface Smoothing & Deduplication
         |
         v
Quadric Edge Collapse Mesh Decimation (Trimesh / PyACVD)
[ Target: <= 25,000 triangular faces for real-time 60 FPS WebGL rendering ]
         |
         v
Analytical Vertex Normal Recomputation
         |
         +----------------------------------+
         |                                  |
         v                                  v
WebGL Binary GLB (Draco/glTF 2.0)    VTK PolyData (.vtp XML)
for Three.js Web Viewer               for PySide6 Desktop Viewer
```

---

## Pipeline 4: Prior-vs-Current 3D Study Registration

**Location**: `services/ai_worker/pipelines/registration.py`

### Objective
Enables direct spatial comparison of a patient's historical prior scan with a current follow-up exam.

### Steps
1. **Spatial Resampling**: Resamples prior volume onto current volume's spatial coordinate grid.
2. **Coarse Rigid Alignment**: Computes 3D cross-correlation over $(z, y, x)$ translation shifts to correct for patient positioning changes on the scanner table.
3. **Intensity Difference Map**: Generates `difference_map.nii.gz` quantifying localized tissue density alterations:
   $$\Delta I(x,y,z) = I_{\text{current}}(x,y,z) - I_{\text{prior}}^{\text{registered}}(x,y,z)$$
4. **Metrics Output**:
   - Mean absolute displacement shift $(dz, dy, dx)$ in millimeters.
   - Normalized Cross-Correlation (NCC) alignment score $[0.0, 1.0]$.
   - Mean intensity difference.

---

## Pipeline 5: Longitudinal RECIST 1.1 Volume Tracking

**Location**: `services/ai_worker/pipelines/longitudinal.py`

Tracks segmented lesions and organ volumes over time, applying the **RECIST 1.1** (Response Evaluation Criteria in Solid Tumors) clinical standard:

- **Progressive Disease (PD)**: $\ge 20\%$ increase in volume or maximum caliper diameter.
- **Partial Response (PR)**: $\ge 30\%$ decrease in volume or maximum caliper diameter.
- **Stable Disease (SD)**: Neither sufficient shrinkage to qualify for PR nor sufficient increase to qualify for PD.
- **Complete Response (CR)**: Disappearance / total resolution of the target lesion.

### Output Contract:
```json
{
  "structure": "liver",
  "priorVolumeMl": 1450.0,
  "currentVolumeMl": 1510.0,
  "changeMl": 60.0,
  "changePercent": 4.14,
  "recistCategory": "SD",
  "recistCriteria": "SD (Stable)"
}
```

---

## Pipeline 6: 4D Dynamic Motion & Cine Pipeline

**Location**: `services/ai_worker/pipelines/motion.py`

Processes multi-phase temporal acquisitions (cardiac CT/MRI, respiratory gating):
- Identifies phase index $t \in [0, T-1]$.
- Calculates per-phase chamber and lung volumes.
- Computes physiological cardiac functional parameters:
  - **End-Diastolic Volume (EDV)**: Maximum cavity volume across the cardiac cycle.
  - **End-Systolic Volume (ESV)**: Minimum cavity volume across the cardiac cycle.
  - **Stroke Volume (SV)**:
    $$SV = EDV - ESV \quad (\text{ml})$$
  - **Left Ventricular Ejection Fraction (LVEF)**:
    $$LVEF = \frac{EDV - ESV}{EDV} \times 100 \quad (\%)$$
  - Normal adult reference range: $50\% - 70\%$.

---

## Pipeline 7: Anatomical Report Quality-Control (QC) Engine

**Location**: `services/ai_worker/pipelines/qc.py`

Prevents AI hallucinations in drafted radiology reports by checking every finding against the true segmented 3D anatomy:

1. **Physical World Coordinate Inversion**:
   $$(i, j, k)^T = A^{-1} \begin{pmatrix} X \\ Y \\ Z \\ 1 \end{pmatrix}$$
2. **Organ Mask Containment**:
   Verifies whether the voxel $(i, j, k)$ falls inside the binary mask of the claimed organ (e.g., nodule claimed in Right Lung must be inside `lung_right`).
3. **Laterality Verification**:
   Flags contradictions where the text description states "Left" or "Right" but the finding coordinate resides in the contralateral anatomical structure.
4. **Radiologist Safety**:
   Reports with failing checks are never silently modified; instead, they are flagged with `FLAG_FOR_RADIOLOGIST_REVIEW` and provide explicit warning notes.
