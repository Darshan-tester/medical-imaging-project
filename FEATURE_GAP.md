# MERIDIAN / SCANLAB AI PRO — CLINICAL FEATURE GAP ANALYSIS
**Version:** 2.0.0-AUDIT  
**Date:** October 2026  
**Status:** Comprehensive Capability Assessment & Gap Matrix  
**Auditor:** Senior Clinical Workflow Specialist & Enterprise Healthcare Solutions Architect

---

## 1. Executive Summary

Meridian has established an authentic foundation: genuine multi-modality datasets (MIMIC-CXR, MR-RATE, PETWB-REP, Perle CT), real clinical reports, and basic 2D/3D viewing capabilities. However, a significant gap separates its current state—an **AI demo viewer with static report forms**—from the target state: an **Enterprise Agentic AI Radiology Workstation** trusted by clinical specialists for daily diagnostic reading.

This document identifies every missing capability, architectural discrepancy, and clinical workflow gap, mapping them directly to implementation phases.

---

## 2. Feature Gap Matrix

| Functional Area | Current Implementation State | Enterprise Clinical Workstation Target | Status / Gap |
| :--- | :--- | :--- | :--- |
| **Main Workstation Layout** | Tabbed views (Overview / Viewer / Report) with collapsible drawers | 3-Column resizable layout (Patient info & Priors \| Center Viewport \| AI Findings & Evidence \| Bottom Report/QC) | 🔴 Major Gap |
| **CT/MRI Multi-Planar Reconstruction (MPR)** | MultiPlaneGrid prototype with static panel assignments | Interactive 3-plane (Axial/Coronal/Sagittal) + 3D grid, synchronized crosshairs, linked pan/zoom, independent W/L | 🔴 Major Gap |
| **Window Level / Contrast** | Basic CSS filters with limited presets | Clinical 16-bit HU presets (Lung, Bone, Brain, Soft Tissue, Mediastinum, Abdomen, Liver) + interactive mouse drag W/L | ⚠️ Moderate Gap |
| **Agentic AI Architecture** | Monolithic regex sentence matching (`simulated-findings.ts`) | Modular agent subsystem: Study Agent, Analysis Agent, Comparison Agent, Reporting Agent, QC Agent, Workflow Agent | 🔴 Critical Gap |
| **Finding ↔ Image Bidirectional Link** | Unidirectional jump-to-slice from finding card | Full bidirectional sync: Report text ↔ AI Finding ↔ Measurement Caliper ↔ Slice & Center Coordinates | 🔴 Major Gap |
| **Prior Studies & Longitudinal Tracking** | Non-existent; studies viewed in strict isolation | Prior study discovery, side-by-side synchronized comparison, lesion tracking (New, Stable, Increased, Decreased, Resolved) | 🔴 Major Gap |
| **Report Quality Control (QC) Engine** | None; manual visual proofreading only | Automated pre-approval QC: laterality verification, measurement consistency, contradiction detection, missing critical findings | 🔴 Critical Gap |
| **Voice Dictation Workflow** | None; manual keyboard input only | Integrated voice dictation (speech-to-text → AI structured formatting → radiologist review & edit) | ⚠️ Moderate Gap |
| **Structured Report Templates** | Single generic 4-field textarea editor | Modality/body-part templates (CT Chest, MRI Brain, MRI Knee, CT Abdomen, Chest X-ray, PET/CT) with macro insertion | ⚠️ Moderate Gap |
| **Critical Findings Workflow** | Visual "stat" priority badge only | Dedicated urgent finding banner, deliberate radiologist confirmation/rejection flow, urgent audit trail | ⚠️ Moderate Gap |
| **Audit Trail & Governance** | None; actions lost on session end | Comprehensive audit logging (study opened, slice viewed, finding accepted/rejected, report approved, exported) | 🔴 Critical Gap |
| **PACS / DICOMweb Readiness** | Direct disk/R2 reading only | Extensible abstraction layer with DICOMweb adapters (QIDO-RS, WADO-RS, STOW-RS) and HL7/FHIR readiness | ⚠️ Moderate Gap |
| **Performance Instrumentation** | CT perf helpers in dev console | Real-time diagnostic performance HUD: TTFI, TTI, slice frame rate, memory footprint, cache hit ratio | ⚠️ Moderate Gap |

---

## 3. Deep-Dive Gap Specifications

### 3.1 Main Workstation 3-Column Resizable Layout
* **Current State:** The workspace is split across three tabs (`overview`, `analysis`, `report`). When reviewing images, the radiologist cannot view the clinical history, prior exam timeline, and structured report simultaneously.
* **Target Requirement:**
  ```text
  ┌────────────────────────────────────────────────────────────────────────────┐
  │ MERIDIAN | Patient | Study | AI Status | Search | Settings | User         │
  ├───────────────┬──────────────────────────────────────┬─────────────────────┤
  │ PATIENT CONTEXT│          IMAGE VIEWPORT              │ AI FINDINGS         │
  │ • Patient Info│ • Axial / Coronal / Sagittal / 3D    │ • Finding Cards     │
  │ • Study List  │ • Synchronized Crosshairs            │ • Evidence Preview  │
  │ • Prior Exams │ • Window/Level, Tools, MPR Controls  │ • Caliper Metrics   │
  │ • Indication  │ • True DICOM Voxel Aspect Ratio      │ • Status (Accept/..)│
  ├───────────────┴──────────────────────────────────────┴─────────────────────┤
  │ BOTTOM DRAWER: Structured Report Editor | AI QC Verification | Audit Trail │
  └────────────────────────────────────────────────────────────────────────────┘
  ```
* **Clinical Impact:** Eliminates context switching; allows simultaneous visual analysis and diagnostic reporting.

---

### 3.2 True Multi-Planar Reconstruction (MPR) & Spatial Crosshairs
* **Current State:** `MultiPlaneGrid.tsx` displays multiple series, but clicking on a point in the axial plane does not update the slice position of coronal and sagittal viewports to that exact anatomical location.
* **Target Requirement:**
  - Synchronized 3D crosshair intersection point $(x, y, z)$.
  - Moving the crosshair in any view immediately updates the slice indices of the other two orthogonal views.
  - Linked zoom and pan options.
  - Viewport layout selectors: 1x1, 1x2, 2x1, 2x2.

---

### 3.3 Modular Agentic AI Subsystem
* **Current State:** AI findings are produced by regex keyword searching over report text. There is no concept of distinct autonomous agents with defined responsibilities and provenance.
* **Target Requirement:**
  1. **Study Agent:** Ingests study metadata, extracts clinical indications, body region, modality, and discovers prior exams.
  2. **Imaging Analysis Agent:** Evaluates imaging parameters, detects findings, attaches calibrated measurements, assigns confidence intervals, and localizes visual evidence.
  3. **Comparison Agent:** Correlates current lesions with prior scans, calculating diameter/volume progression and classifying status (`New`, `Stable`, `Increased`, `Decreased`, `Resolved`).
  4. **Reporting Agent:** Drafts structured clinical reports citing visual evidence, organ-by-organ breakdown, and prioritized impressions.
  5. **Quality-Control (QC) Agent:** Analyzes draft report against findings, detecting discrepancies (laterality, measurements, contradictions, unaddressed critical findings).
  6. **Workflow Agent:** Manages clinical case states, tracks review progress, and manages audit trails.

---

### 3.4 Longitudinal Prior Study Comparison
* **Current State:** Meridian loads only one study at a time. The radiologist has no mechanism to compare the current scan against an earlier study.
* **Target Requirement:**
  - Automated identification of prior studies for the same patient/cohort.
  - Dual-study viewport: Current Study (left) vs Prior Study (right).
  - Synchronized scrolling and spatial linking.
  - Timeline slider displaying historical lesion measurements over time.

---

### 3.5 AI Report Quality-Control (QC) Guardrails
* **Current State:** Radiologists can sign off on reports with typographical errors, missing findings, or contradictory statements.
* **Target Requirement:**
  - Pre-approval automated audit checking:
    - **Laterality Consistency:** Warns if findings cite "Left upper lobe" while impression cites "Right upper lobe".
    - **Measurement Mismatch:** Flags discrepancies between finding measurements (e.g. 8.4 mm) and report text (e.g. 12 mm).
    - **Clinical Contradictions:** Identifies contradictory assertions (e.g. "Consolidation present" vs "Clear lungs").
    - **Unreviewed Critical Findings:** Blocks or issues mandatory alerts if acute pathologies (hemorrhage, pneumothorax, pulmonary embolism) remain unacknowledged.
    - **Unsupported Statements:** Flags assertions lacking imaging evidence.

---

### 3.6 Voice Dictation & Structured Report Templates
* **Current State:** Text entry is limited to standard HTML textareas with no clinical templates.
* **Target Requirement:**
  - In-browser microphone speech recognition (Web Speech API / SpeechRecognition).
  - Real-time speech-to-text with AI formatting into formal radiological syntax.
  - Standardized templates:
    - `CT CHEST` (Lungs, Mediastinum, Pleura, Chest Wall, Upper Abdomen, Impression)
    - `MRI BRAIN` (Brain parenchyma, Ventricles, Extra-axial spaces, Vascular flow voids, Impression)
    - `MRI KNEE` (Menisci, Ligaments, Cartilage, Extensor mechanism, Joint effusion, Impression)
    - `CT ABDOMEN/PELVIS` (Liver, Gallbladder, Pancreas, Spleen, Kidneys, Bowel, Pelvis, Impression)
    - `CHEST X-RAY` (Lungs, Heart & Mediastinum, Pleural spaces, Bones, Impression)
    - `PET/CT` (Hypermetabolic foci, SUV metrics, Anatomical correlation, Impression)

---

### 3.7 Critical Findings Urgent Workflow
* **Current State:** No dedicated workflow for life-threatening or urgent acute findings.
* **Target Requirement:**
  - High-visibility banner for critical findings (e.g. Intracranial Hemorrhage, Tension Pneumothorax, Aortic Dissection, Acute Infarct).
  - Explicit radiologist review requirement: `CONFIRM` or `REJECT` with mandatory clinical note.
  - Audit logging of critical finding communication.

---

### 3.8 HIPAA & 21 CFR Part 11 Audit Trail
* **Current State:** No persistence of who viewed what image, who edited a report, or when approval occurred.
* **Target Requirement:**
  - Structured audit trail recording:
    - `STUDY_OPENED` (timestamp, user, studyId)
    - `IMAGE_VIEWED` (seriesId, sliceIndex)
    - `AI_FINDING_REVIEWED` (findingId, action: accept/modify/reject)
    - `REPORT_EDITED` (section, delta)
    - `REPORT_QC_EVALUATED` (warnings flagged, radiologist override)
    - `REPORT_APPROVED` (radiologist signature, timestamp, version)
    - `REPORT_EXPORTED` (format: PDF/DICOM-SR)
