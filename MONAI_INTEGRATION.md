# Meridian / ScanLab AI Pro — MONAI-Physio Integration

This document describes the architectural integration of the [Project-MONAI/monai-physio](https://github.com/Project-MONAI/monai-physio) ecosystem into Meridian / ScanLab AI Pro.

---

## 1. Architectural Overview

Meridian has been upgraded from a 2D image viewer and report generator into a full **3D/4D Medical Imaging AI Workstation**. 

To preserve stability, maintain data integrity on `D:\ScanLab_Datasets`, and prevent Python version conflicts, the system uses a decoupled multi-tier architecture:

```
+----------------------------------------------------------------------------------+
|                            MERIDIAN / SCANLAB WORKSTATION                        |
|                                                                                  |
|   +------------------------------------+   +----------------------------------+  |
|   |         WEB CLIENT (NEXT.JS)       |   |       DESKTOP APP (PYSIDE6)      |  |
|   |  - Synchronized 4-Up MPR Viewport  |   |  - VTK 3D Volume & Mesh Viewer   |  |
|   |  - Three.js 3D Organ Meshes (.glb) |   |  - Native PolyData (.vtp) Actor  |  |
|   |  - Crosshair & Clipping Controls   |   |  - Multi-slice axial/coronal/sag |  |
|   |  - AI Analysis & QC Right Panel    |   |  - Report generation interface   |  |
|   +------------------------------------+   +----------------------------------+  |
+------------------------------------------+---------------------------------------+
                                           |
                                           v HTTP / JSON API
+----------------------------------------------------------------------------------+
|                           MERIDIAN NEXT.JS API LAYER                             |
|                                                                                  |
|   /api/ai/hardware               -> System hardware diagnostics & CUDA status    |
|   /api/ai/jobs & jobs/[jobId]    -> Async job queue, progress polling & cache    |
|   /api/ai/derived/[studyId]      -> Manifest of segmented masks, meshes, metrics |
|   /api/ai/derived/[studyId]/mesh -> High-speed binary GLB / VTP mesh streaming   |
|   /api/ai/registration           -> Prior-vs-current 3D study registration       |
|   /api/ai/motion                 -> 4D cine dynamic volumetrics & cardiac LVEF   |
|   /api/ai/qc                     -> Finding coordinate vs organ mask validation  |
+------------------------------------------+---------------------------------------+
                                           |
                                           v Subprocess / CLI Jobs (Thread-safe)
+----------------------------------------------------------------------------------+
|                        ISOLATED PYTHON AI WORKER SERVICE                         |
|                     (services/ai_worker/ in dedicated .venv)                     |
|                                                                                  |
|   [ Ingestion ]                                                                  |
|     - adapters/dicom.py: Load axial stacks, slice spacing (sz,sy,sx), affine     |
|     - adapters/nifti.py: 3D/4D NIfTI loader/saver with qform/sform preservation  |
|     - adapters/monai_physio.py: Standardized organ taxonomy, RGB, opacity        |
|                                                                                  |
|   [ Pipelines ]                                                                  |
|     - pipelines/segmentation.py: 11-structure CT segmenter & MRI sequence check  |
|     - pipelines/registration.py: Rigid & deformable alignment + difference map   |
|     - pipelines/longitudinal.py: RECIST 1.1 volume & caliper comparison          |
|     - pipelines/motion.py: 4D cardiac & respiratory cine + stroke volume & LVEF  |
|     - pipelines/qc.py: Anatomical coordinate & laterality validation             |
|                                                                                  |
|   [ Outputs ]                                                                    |
|     - outputs/meshes.py: Marching Cubes -> Decimation (<=25k faces) -> GLB & VTP |
|     - outputs/metrics.py: Volume (ml), caliper (mm), area (cm2), centroid (x,y,z)|
|     - outputs/manifest.py: Study manifest.json serialization                     |
+------------------------------------------+---------------------------------------+
                                           |
                                           v Authoritative Output
+----------------------------------------------------------------------------------+
|                              DERIVED STUDY ASSETS                                |
|                        (.scanlab/derived/<studyId>/)                             |
|                                                                                  |
|   manifest.json                 -> Full metadata, models, times, segments, meshes|
|   segmentation/*.nii.gz         -> Physical 3D binary NIfTI organ masks          |
|   meshes/*.glb                  -> WebGL-optimized Draco/glTF 2.0 binary meshes  |
|   meshes/*.vtp                  -> PyVista / VTK PolyData XML format for desktop |
|   metrics/anatomy.json          -> Quantitative morphometrics per structure      |
|   registration/difference_map   -> Subtraction NIfTI and spatial alignment report|
|   metrics/longitudinal.json     -> Prior-vs-current RECIST 1.1 percentage change |
|   motion/motion_report.json     -> Dynamic phases, EDV, ESV, SV, LVEF (%)        |
|   metrics/anatomical_qc.json    -> Coordinate validation & radiologist flags     |
+----------------------------------------------------------------------------------+
```

---

## 2. Component Boundaries & Virtual Environments

1. **Desktop App Environment (`desktop/.venv`)**:
   - Python 3.10
   - PySide6 6.8, VTK 9.3, PyVista, pydicom.
   - Responsible for local desktop UI rendering, local PACS connectivity, and interactive desktop visualization.

2. **AI Worker Service (`services/ai_worker/.venv`)**:
   - Isolated environment running PyTorch, MONAI 1.6.1, NumPy, SciPy, Scikit-Image, Trimesh, Nibabel, Pydicom.
   - Decoupled from desktop Qt libraries to prevent DLL, ABI, or CUDA version conflicts.
   - Invoked via JSON job queue (`services/ai_worker/worker.py`).

---

## 3. Web & Desktop Cross-Platform Uniformity

Both the Next.js Three.js web application and the PySide6 VTK desktop application consume **identical derived assets** produced by the AI worker:

| Output Asset | Web Viewer (Three.js) | Desktop Viewer (PySide6 / VTK) |
|---|---|---|
| **Volume Data** | Dynamic REST slice streaming | Native VTK 3D Volume Mapper |
| **Organ Meshes** | Binary `.glb` via `GLTFLoader` | Native `.vtp` via `vtkXMLPolyDataReader` |
| **Segmentations**| Voxel overlays via canvas shaders | VTK Labelmap / Stencil overlays |
| **MPR Coordinates**| Synchronized slice crosshairs | Orthogonal MPR slice viewer planes |
| **Metrics** | Real-time RECIST table & cards | Native Qt table & clinical report widget |

---

## 4. Preservation of Authoritative Data

The primary dataset directory `D:\ScanLab_Datasets` remains **read-only and untouched**:
- Original DICOM files are never modified, moved, renamed, or overwritten.
- All derived AI results (segmentations, meshes, registration maps, metrics) are written exclusively into `.scanlab/derived/<studyId>/`.
- Caching keys are computed using `SHA-256(studyUID + seriesUID + pipeline + modelVersion)`. If derived outputs already exist for the study, reprocessing is skipped, satisfying the CEO's low-latency requirement.
