# MERIDIAN / SCANLAB AI PRO — SYSTEM ARCHITECTURE SPECIFICATION
**Version:** 2.0.0-PROD-AUDIT  
**Date:** October 2026  
**Status:** Comprehensive Architectural Blueprint  
**Authors:** Senior Healthcare Software Architect, DICOM/PACS Engineer, Medical Imaging UX Architect, AI/ML Specialist

---

## 1. Executive Architectural Overview

Meridian (formerly ScanLab AI Pro) is an enterprise-grade medical imaging AI workstation engineered for radiologists and clinical specialists. It bridges high-performance multi-modality volumetric visualization (CT, MRI, PET, Chest X-ray, Ultrasound) with agentic artificial intelligence, structured clinical reporting, and PACS/RIS workflow integration.

The platform operates across two synchronized deployment targets:
1. **Clinical Web Workstation (Next.js 16 + React 19 + Turbopack + WebGL/Three.js + Cloudflare Workers / R2 Mirror):** High-availability, zero-install browser workstation with full MPR, 3D volume raymarching, slice prefetching, and agentic reporting.
2. **Native Diagnostic Workstation (PySide6 / Qt + VTK + Python Core):** Native clinical desktop client for on-premise hospital environments with zero-network requirements, native GPU-accelerated volume rendering, direct local PACS querying, and microsecond slice access.

Both targets share an identical single source of truth for study manifests, series structures, slice ordering, and real clinical reports derived from authentic medical imaging datasets (`.scanlab/manifest.json`).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 MERIDIAN WORKSTATION ARCHITECTURE                      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   ┌────────────────────────────────┐                 ┌─────────────────────────────┐   │
│   │     CLINICAL WEB WORKSTATION   │                 │     NATIVE WORKSTATION      │   │
│   │    (Next.js 16 / React 19)     │                 │   (PySide6 / Qt6 / VTK)     │   │
│   │  • Three-Column Resizable Shell│                 │  • Multi-viewport Layout    │   │
│   │  • MultiPlaneGrid (Ax/Sag/Cor) │                 │  • VTK GPU Volume Rendering │   │
│   │  • WebGL 3D Ray-Marching Shader│                 │  • Voxel-Space Annotations  │   │
│   │  • Vector SVG Annotation Canvas│                 │  • Worker-Thread Decoders   │   │
│   │  • Prioritized Slice Scheduler │                 │  • Local Memory Caching     │   │
│   └───────────────┬────────────────┘                 └──────────────┬──────────────┘   │
│                   │                                                 │                  │
│                   ▼                                                 ▼                  │
│   ┌────────────────────────────────┐                 ┌─────────────────────────────┐   │
│   │       HTTP / JSON ROUTING      │                 │     LOCAL NATIVE RUNTIME    │   │
│   │  /api/studies/[id]/images      │                 │  imageloader.py             │   │
│   │  /api/studies/[id]/volume      │                 │  volumes.py                 │   │
│   │  /api/studies/[id]/report      │                 │  annotations.py             │   │
│   └───────────────┬────────────────┘                 └──────────────┬──────────────┘   │
│                   │                                                 │                  │
│                   ├─────────────────────────┬───────────────────────┤                  │
│                   ▼                         ▼                       ▼                  │
│   ┌────────────────────────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │
│   │     DATASET / ADAPTER LAYER    │ │  AGENTIC AI   │ │     DATA PERSISTENCE      │   │
│   │  • CT Adapter (DICOM stack)    │ │  SUBSYSTEM    │ │  • .scanlab/manifest.json │   │
│   │  • MRI Adapter (MR-RATE NIfTI) │ │ • Study Agent │ │  • SQLite / IndexedDB     │   │
│   │  • PET Adapter (PETWB SUV)     │ │ • Analysis Agt│ │  • Local ScanLab Datasets │   │
│   │  • CXR Adapter (MIMIC-CXR)     │ │ • Compare Agt │ │  • Cloudflare R2 Mirror   │   │
│   │  • Image-Render / NIfTI Voxel  │ │ • Report QC Ag│ │  • DICOM / PACS Store     │   │
│   └────────────────────────────────┘ └───────────────┘ └───────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Workspace & Module Map

### 2.1 Web Application Root (`/`)
* [package.json](file:///d:/meridian-scanlab-integration/meridian/package.json): Defines dependencies (Next.js 16.3.4, React 19.2.8, Three.js 0.160.1, dicom-parser 1.8.21, nifti-reader-js 0.6.8, pngjs 7.0.0, jsPDF 2.5.1, Zustand 5.0.15, Tailwind CSS 3.4.4, OpenNext 1.20.5, Wrangler 4.127.1).
* [next.config.js](file:///d:/meridian-scanlab-integration/meridian/next.config.js): Configures environment inlining (`NEXT_PUBLIC_DATA_MODE`), static optimization, and bundle behavior.
* [open-next.config.ts](file:///d:/meridian-scanlab-integration/meridian/open-next.config.ts): Cloudflare Workers configuration wrapping OpenNext adapter.
* [wrangler.jsonc](file:///d:/meridian-scanlab-integration/meridian/wrangler.jsonc): Cloudflare Worker service specification (`vedh-medical-imaging`), asset bindings, nodejs compatibility flags.
* [.env.local](file:///d:/meridian-scanlab-integration/meridian/.env.local): Server-side configuration (`SCANLAB_DATA_ROOT=D:\ScanLab_Datasets`, `NEXT_PUBLIC_DATA_MODE=dataset`).

### 2.2 Application Routing (`app/`)
* [app/(portal)/dashboard/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/dashboard/page.tsx): Clinical operational dashboard. *(Audit finding: currently invokes synthetic mock methods directly)*.
* [app/(portal)/studies/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/studies/page.tsx): Main study worklist with multi-attribute filtering, sorting, pagination, and data-mode detection.
* [app/(portal)/studies/[id]/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/studies/%5Bid%5D/page.tsx): Study workspace root routing between Overview, Viewer & AI Analysis, and Report tabs.
* [app/(portal)/upload/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/upload/page.tsx): Ingestion portal with demographic capture and live BMI/BSA calculations.
* [app/(portal)/reports/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/reports/page.tsx): Multi-study report index and export management.
* [app/(portal)/analytics/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/analytics/page.tsx): Operational metrics and diagnostic throughput charts.
* [app/(portal)/incident-report/page.tsx](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/incident-report/page.tsx): Clinical QA discrepancy reporting.

### 2.3 Backend API Endpoints (`app/api/`)
* [app/api/studies/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/studies/route.ts): Streams study list summaries from `.scanlab/manifest.json` or R2 mirror.
* [app/api/studies/[id]/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/studies/%5Bid%5D/route.ts): Returns full study domain model, series specifications, and patient demographic profiles.
* [app/api/studies/[id]/images/[...path]/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/studies/%5Bid%5D/images/%5B...path%5D/route.ts): Dynamic slice delivery engine. Dispatches to DICOM parser, NIfTI reslicer, or raster stream with ETags and cache control.
* [app/api/studies/[id]/report/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/studies/%5Bid%5D/report/route.ts): Returns verbatim source report and parsed clinical sections.
* [app/api/studies/[id]/volume/[seriesId]/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/studies/%5Bid%5D/volume/%5BseriesId%5D/route.ts): Serves binary volumetric scalar buffers (`.bin`) with voxel dimension sidecars (`.bin.meta.json`).
* [app/api/datasets/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/datasets/route.ts) & [status/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/datasets/status/route.ts): Telemetry on index freshness and dataset coverage.
* [app/api/uploads/match/route.ts](file:///d:/meridian-scanlab-integration/meridian/app/api/uploads/match/route.ts): SHA-256 hash matching against indexed series.

### 2.4 Diagnostic Imaging Core (`lib/`)
* [lib/dataset/image-render.ts](file:///d:/meridian-scanlab-integration/meridian/lib/dataset/image-render.ts): Core image rendering engine (1,594 lines). Implements server-side DICOM HU windowing, NIfTI coordinate affine permutation (`assignAxes`), nearest-neighbor resampling, LRU volume cache, and PNG stream encoding.
* [lib/dataset/to-app-study.ts](file:///d:/meridian-scanlab-integration/meridian/lib/dataset/to-app-study.ts): Translates low-level manifest structures to rich client domain representations (`Study`).
* [lib/dataset/adapters/](file:///d:/meridian-scanlab-integration/meridian/lib/dataset/adapters): Specialized modality scanners (`ct.ts`, `mri.ts`, `pet.ts`, `chest-xray.ts`, `rocov2.ts`, `ultrasound.ts`, `shared.ts`).
* [lib/viewer/slice-cache.ts](file:///d:/meridian-scanlab-integration/meridian/lib/viewer/slice-cache.ts): In-memory synchronous 256-slice LRU cache storing decoded object URLs for zero-latency frame stepping.
* [lib/viewer/request-queue.ts](file:///d:/meridian-scanlab-integration/meridian/lib/viewer/request-queue.ts): Concurrent, prioritized, and preemptible slice download scheduler.
* [lib/viewer/use-slice-prefetch.ts](file:///d:/meridian-scanlab-integration/meridian/lib/viewer/use-slice-prefetch.ts): Asymmetric sliding-window prefetch hook ([-5, +8] slices).
* [lib/patient-profile.ts](file:///d:/meridian-scanlab-integration/meridian/lib/patient-profile.ts): Deterministic demographic and anthropometric extraction engine.
* [lib/simulated-findings.ts](file:///d:/meridian-scanlab-integration/meridian/lib/simulated-findings.ts): NLP sentence parser extracting clinical pathology terms and mapping to coordinates.
* [lib/pdf.ts](file:///d:/meridian-scanlab-integration/meridian/lib/pdf.ts): Clinical PDF report compilation via jsPDF with paginated layout and mandatory legal disclosures.

### 2.5 Diagnostic Viewer & Reporting Components (`components/`)
* [components/viewer/ImageViewer.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/ImageViewer.tsx): Primary 2D medical image canvas supporting WW/WL, pan, zoom, crosshairs, and synchronized overlays.
* [components/viewer/MultiPlaneGrid.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/MultiPlaneGrid.tsx): Multi-viewport orchestrator (1x1, 1x2, 2x2) with synchronized crosshair spatial navigation across Axial, Coronal, Sagittal, and 3D.
* [components/viewer/Volume3DViewer.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/Volume3DViewer.tsx): Three.js WebGL volume raymarching shader with transfer functions for Bone, Soft Tissue, Lung, MRI Tissue, and PET SUV.
* [components/viewer/AnnotationCanvas.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/AnnotationCanvas.tsx): Zero-latency vector drawing layer using direct SVG DOM path mutation with quadratic-midpoint smoothing.
* [components/viewer/ViewerToolbar.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/ViewerToolbar.tsx): Diagnostic tool ribbon (Pan, Zoom, WW/WL, Caliper Measure, Pin Marker, Vector Pen, Invert, Reset, Fullscreen).
* [components/viewer/WindowLevelControls.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/WindowLevelControls.tsx): Modality-specific clinical presets (Lung, Bone, Brain, Soft Tissue, Mediastinum, Liver).
* [components/report/AnalysisTab.tsx](file:///d:/meridian-scanlab-integration/meridian/components/report/AnalysisTab.tsx): Main workstation coordination tab (1,226 lines).
* [components/report/ReportEditor.tsx](file:///d:/meridian-scanlab-integration/meridian/components/report/ReportEditor.tsx): Structured radiology report section editor.
* [components/report/ApprovalPanel.tsx](file:///d:/meridian-scanlab-integration/meridian/components/report/ApprovalPanel.tsx): Clinical report sign-off and locking modal.

### 2.6 Native Desktop Architecture (`desktop/`)
* [desktop/meridian_desktop/main_window.py](file:///d:/meridian-scanlab-integration/meridian/desktop/meridian_desktop/ui/main_window.py): PySide6/Qt6 workstation interface.
* [desktop/meridian_desktop/dataset/imageloader.py](file:///d:/meridian-scanlab-integration/meridian/desktop/meridian_desktop/dataset/imageloader.py): Multi-threaded asynchronous slice decoder with memory-bounded LRU caches.
* [desktop/meridian_desktop/dataset/volumes.py](file:///d:/meridian-scanlab-integration/meridian/desktop/meridian_desktop/dataset/volumes.py): 3D volume reconstruction service with orientation verification.
* [desktop/meridian_desktop/viewer/sliceview.py](file:///d:/meridian-scanlab-integration/meridian/desktop/meridian_desktop/viewer/sliceview.py): Hardware-accelerated 2D viewport with DICOM pixel spacing aspect preservation.
* [desktop/meridian_desktop/viewer/vtk3d.py](file:///d:/meridian-scanlab-integration/meridian/desktop/meridian_desktop/viewer/vtk3d.py): VTK-powered GPU raycasting with transfer functions.
* [desktop/build-portable-demo.bat](file:///d:/meridian-scanlab-integration/meridian/desktop/build-portable-demo.bat): Standalone zero-dependency distribution packaging script.

---

## 3. Imaging Ingestion & Dataset Pipeline

The dataset ingestion pipeline processes raw hospital data from `D:\ScanLab_Datasets` into a standardized manifest:

```
D:\ScanLab_Datasets
  ├── 01_CHEST_XRAY   -> MIMIC-CXR (1,500 pairs) -> JPEG + CSV Metadata
  ├── 02_CT           -> Perle Thorax (4 studies, 3,144 slices) -> DICOM stacks
  ├── 03_MRI          -> MR-RATE (310 volumetric studies) -> 3D NIfTI (.nii.gz) + TSV
  ├── 04_ULTRASOUND   -> US Thyroid (1 study) -> DICOM Single Frame
  ├── 05_REPORTS      -> Clinical Reports matching imaging cohorts
  ├── 06_PET          -> PETWB-REP (490 volumetric studies) -> 3D NIfTI + report_en.csv
  └── ROCOv2          -> Multimodal Case Studies (10 studies) -> Images + Captions
```

### 3.1 Indexing Algorithm
1. **Discovery:** `scripts/dataset-index.ts` triggers `scanner.ts`, invoking modality-specific adapters.
2. **DICOM Stack Sorting:** `adapters/ct.ts` inspects DICOM headers using `dicom-parser`. Instances are sorted by `ImagePositionPatient[2]` (or projection along `ImageOrientationPatient` normal) rather than filename, guaranteeing correct anatomical cranial-caudal ordering.
3. **NIfTI Multi-Planar Expansion:** `adapters/shared.ts` (`buildNiftiVolumeSeries`) reads NIfTI headers (`pixdim`, `qform`, `sform`). It derives three orthogonal series (Axial, Coronal, Sagittal) for each volumetric scan with anisotropic physical spacing preserved.
4. **Report Pairing:** Verified CSV/TSV matchers extract authentic clinical reports and link them to `DatasetStudy.report` with zero synthetic clinical fabrication.
5. **Manifest Compilation:** The resulting graph is serialized to `.scanlab/manifest.json` with an atomic rename.

---

## 4. Real Image-to-Report Linking & Rendering

### 4.1 Image Rendering Pipeline
* **DICOM Slices:** On request, `renderDicom()` parses DICOM bytes, extracts `PixelData`, calculates Hounsfield units via $HU = V \times \text{RescaleSlope} + \text{RescaleIntercept}$, applies Window Center and Window Width, transforms to 8-bit grayscale, and compresses into PNG via `pngjs`.
* **NIfTI Slices:** `renderNifti()` inflates gzipped NIfTI bytes into an in-memory typed array (`VOLUME_CACHE`). An affine transform determines voxel indices along the requested orientation plane. The plane is resampled with aspect correction into physically square pixels and encoded into PNG.
* **Direct Raster:** MIMIC-CXR and ROCOv2 JPEG/PNG files are streamed directly via `fs.createReadStream()` with zero transcoding loss.

### 4.2 Finding-to-Slice Navigation
Each clinical finding in `Study.findings` carries:
* `seriesId`: The specific acquisition or reconstructed plane.
* `sliceIndex`: The exact frame index along that series.
* `region`: Normalized 0-1 bounding box coordinates.
Clicking any finding automatically updates `activeSeriesId` and `currentSlice`, centers the viewport, and highlights the corresponding bounding box overlay.

---

## 5. Architectural Deficiencies & Vulnerabilities

1. **Dashboard Disconnection:** `app/(portal)/dashboard/page.tsx` directly calls `listStudies()` from `mock-data.ts`, completely bypassing the real dataset index.
2. **AnalysisTab Monolith:** `components/report/AnalysisTab.tsx` spans 1,226 lines and manages over 20 separate pieces of React state, causing severe re-render cascades on slice navigation.
3. **Lack of Agentic Decoupling:** AI findings and report generation currently rely on monolithic heuristic scripts (`simulated-findings.ts`) rather than discrete, verifiable agent microservices.
4. **Missing Report Quality-Control Layer:** Reports can be approved with blatant contradictions, mismatched lateralities, and missing critical findings.
5. **Absence of Report Templates & Dictation:** Clinical workflows lack structured templates (CT Chest, MRI Brain, etc.) and voice recognition.
6. **State Ephemerality:** All radiologist annotations, markers, and report edits exist purely in client component memory and are destroyed upon page refresh.

---

## 6. Target Production Architecture

The modernized Meridian architecture transforms the system into a resilient, decoupled, agent-driven workstation:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MODERN AGENTIC WORKSTATION ARCHITECTURE           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                    REPRESENTATION & VIEW LAYER                 │   │
│   │   • Viewport Core (ImageViewer, MultiPlaneGrid, Volume3D)      │   │
│   │   • Interactive Annotations (Vector SVG + Spatial Calipers)    │   │
│   │   • Agentic Clinical Panel (Findings, Provenance, Confidence)  │   │
│   │   • Structured Report Editor (Sectioned, QC-Gated, Voice)      │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────▼────────────────────────────────┐   │
│   │                  UNIFIED STATE & EVENT BUS                     │   │
│   │   • StudySessionStore (Active Study, Slices, Tools, Layout)    │   │
│   │   • AnnotationStore (IndexedDB / SQLite Sync)                  │   │
│   │   • AgentWorkflowStore (Agent Runs, Verification, Audit Trail) │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────▼────────────────────────────────┐   │
│   │                  AGENTIC AI SERVICE SUBSYSTEM                  │   │
│   │  ┌───────────────┐ ┌───────────────┐ ┌──────────────────────┐  │   │
│   │  │  Study Agent  │ │ Analysis Agt  │ │   Comparison Agent   │  │   │
│   │  └───────┬───────┘ └───────┬───────┘ └──────────┬───────────┘  │   │
│   │          │                 │                    │              │   │
│   │  ┌───────▼───────┐ ┌───────▼───────┐ ┌──────────▼───────────┐  │   │
│   │  │Reporting Agent│ │ QC Audit Agt  │ │  Workflow / PACS Agt │  │   │
│   │  └───────────────┘ └───────────────┘ └──────────────────────┘  │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────▼────────────────────────────────┐   │
│   │                 STORAGE & INTEGRATION INTERFACES               │   │
│   │   • Manifest & Indexed Store (Local / Cloudflare R2 Mirror)    │   │
│   │   • DICOMweb Adapter (WADO-RS / QIDO-RS / STOW-RS)             │   │
│   │   • Audit Logging Engine (HIPAA / 21 CFR Part 11 compliant)    │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```
