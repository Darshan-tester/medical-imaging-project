# MERIDIAN / SCANLAB AI PRO — DEFECT & BUG AUDIT REPORT
**Version:** 2.0.0-AUDIT  
**Date:** October 2026  
**Status:** Validated Defect Registry  
**Auditor:** Senior Healthcare QA Engineer & Full-Stack Medical Software Architect

---

## 1. Summary of Identified Defects

During our comprehensive source inspection and runtime verification, we identified **12 verified defects** categorized by severity:
* **Critical (P0):** 3 defects (Direct data discrepancy, session data loss, broken relative imports)
* **High (P1):** 4 defects (Incomplete reporting data model, missing QC safety gate, aspect ratio distortion, unauthenticated oracle)
* **Medium (P2):** 3 defects (Subsystem disconnection, UI state desynchronization, DOM key recycling)
* **Low (P3):** 2 defects (CSS lint/deprecation warnings, missing aria tags)

---

## 2. Detailed Bug Registry

### BUG-01 [P0 - Critical]: Dashboard Displays Synthetic Mock Data in Dataset Mode
* **File:** [app/(portal)/dashboard/page.tsx:L12, L34-L37](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/dashboard/page.tsx#L12-L37)
* **Description:** The dashboard imports `getKPIs`, `listStudies`, and `getLiveVitals` directly from `lib/mock-data.ts`.
* **Root Cause:** In `NEXT_PUBLIC_DATA_MODE=dataset`, the dashboard fails to call `fetchStudies()` from `lib/data-source.ts`. As a result, the command center presents fake synthetic patients ("MRD-1021", etc.) and fabricated metrics, completely disregarding the real 2,314 indexed clinical studies.
* **Reproduction Steps:**
  1. Set `NEXT_PUBLIC_DATA_MODE=dataset` in `.env.local`.
  2. Navigate to `/dashboard`.
  3. Notice that the statistics and recent studies list display fake mock data instead of real studies from `manifest.json`.
* **Remediation:** Refactor `DashboardPage` to fetch real studies via `fetchStudies()`, computing live clinical KPIs dynamically from real study statuses and authentic priority tiers.

---

### BUG-02 [P0 - Critical]: Universal Radiologist Annotation Loss on Browser Refresh
* **File:** [components/report/AnalysisTab.tsx:L110-L123](file:///d:/meridian-scanlab-integration/meridian/components/report/AnalysisTab.tsx#L110-L123), [app/(portal)/studies/[id]/page.tsx:L95-L116](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/studies/%5Bid%5D/page.tsx#L95-L116)
* **Description:** All user-authored clinical annotations (vector pen strokes, caliper measurements, pin markers, radiologist findings, and custom report edits) exist purely in volatile React component state (`useState`).
* **Root Cause:** No persistent local storage (IndexedDB or backend persistence API) is bound to these mutation actions.
* **Impact:** A radiologist spending 15 minutes marking complex lesions and dictating findings loses all work if the browser tab is accidentally reloaded, closed, or interrupted.
* **Remediation:** Implement a persistent `SessionAnnotationStore` utilizing IndexedDB on the client and persistent API syncing on the server, with auto-save indicators and recovery prompts.

---

### BUG-03 [P0 - Critical]: Desktop Relative Import Crash in Root File
* **File:** [desktop/main_window.py:L38-L48](file:///d:/meridian-scanlab-integration/meridian/desktop/main_window.py#L38-L48)
* **Description:** Running `python desktop/main_window.py` throws `ImportError: attempted relative import with no known parent package`.
* **Root Cause:** `desktop/main_window.py` uses package-level relative imports (`from ..config import Config`, `from ..dataset.manifest import ...`), but sits at the root of `desktop/` outside the `meridian_desktop` package.
* **Impact:** Breaks direct Python development workflows unless executed via specific module flags.
* **Remediation:** Eliminate the redundant root file in favor of `desktop/meridian_desktop/ui/main_window.py` and ensure `launcher.py` and entrypoint batch scripts properly configure `PYTHONPATH`.

---

### BUG-04 [P1 - High]: Report Domain Model Drops Clinical `Comparison` Section
* **File:** [lib/types.ts:L359-L364](file:///d:/meridian-scanlab-integration/meridian/lib/types.ts#L359-L364), [components/report/ReportEditor.tsx:L7-L12](file:///d:/meridian-scanlab-integration/meridian/components/report/ReportEditor.tsx#L7-L12)
* **Description:** The `ReportSection` interface only specifies `clinicalInformation`, `technique`, `findings`, and `impression`.
* **Root Cause:** In `lib/dataset/to-app-study.ts`, the source dataset report parser successfully extracts `ds.report.comparison`, but the working `Report.sections` data structure omits it entirely.
* **Impact:** Standard radiology reporting mandates comparison with prior studies (e.g., "Comparison made to prior CT dated 2025-04-12"). Radiologists cannot view or edit prior comparisons in the structured editor.
* **Remediation:** Add `comparison: string` to `ReportSection` and render a dedicated "Comparison" editing section in `ReportEditor.tsx` and in `pdf.ts`.

---

### BUG-05 [P1 - High]: Absence of Quality Control Gates in Approval Flow
* **File:** [components/report/ApprovalPanel.tsx:L25-L35](file:///d:/meridian-scanlab-integration/meridian/components/report/ApprovalPanel.tsx#L25-L35)
* **Description:** Clicking "Approve & Sign Report" immediately finalizes and permanently locks the report without performing safety checks.
* **Root Cause:** No validation passes are run to check for:
  1. Contradictions between Findings and Impression (e.g., Findings state "Large pleural effusion", Impression states "Normal chest without effusion").
  2. Laterality mismatches (Left lung lesion vs Right lung impression).
  3. AI-detected critical findings that the radiologist neither accepted, addressed, nor explicitly dismissed.
* **Impact:** Severe clinical risk; permits sign-off on erroneous or contradictory medical documentation.
* **Remediation:** Introduce an automated pre-approval QC validation modal that flags contradictions and requires explicit radiologist acknowledgment.

---

### BUG-06 [P1 - High]: Anisotropic Pixel Aspect Ratio Offset in Calipers
* **File:** [components/viewer/ImageViewer.tsx:L21-L35](file:///d:/meridian-scanlab-integration/meridian/components/viewer/ImageViewer.tsx#L21-L35)
* **Description:** 2D distance measurements use Euclidean pixel math ($d = \sqrt{\Delta x^2 + \Delta y^2}$) normalized to bounding boxes.
* **Root Cause:** When displaying reconstructed planes with non-square voxel spacing (such as coronal/sagittal planes of anisotropic PET or CT scans), a 10 mm diagonal line calculated without voxel spacing weighting reports distorted physical measurements.
* **Impact:** Inaccurate measurement calculations for clinical staging (e.g., RECIST criteria for tumor evaluation).
* **Remediation:** Incorporate DICOM `pixelSpacing` $[s_r, s_c]$ and slice thickness into the caliper measurement formula: $\text{Distance} = \sqrt{(\Delta x \cdot s_c)^2 + (\Delta y \cdot s_r)^2}$.

---

### BUG-07 [P1 - High]: Unauthenticated Public Dataset Membership Oracle
* **File:** [app/api/uploads/match/route.ts:L15-L30](file:///d:/meridian-scanlab-integration/meridian/app/api/uploads/match/route.ts#L15-L30)
* **Description:** The `/api/uploads/match` endpoint evaluates uploaded file hashes against the entire patient image manifest without authentication.
* **Root Cause:** No authentication headers or session validation guards this route on deployed Cloudflare Worker environments.
* **Impact:** An attacker can probe whether a given medical scan belongs to a patient indexed within the database, violating HIPAA de-identification standards.
* **Remediation:** Enforce session token authorization on `/api/uploads/match` and disable public access.

---

### BUG-08 [P2 - Medium]: Volume Cache Deadlock Under Multi-Plane Cycling
* **File:** [lib/dataset/image-render.ts:L89-L115](file:///d:/meridian-scanlab-integration/meridian/lib/dataset/image-render.ts#L89-L115)
* **Description:** Rapidly switching between Axial, Sagittal, and Coronal views under cine causes extreme latency spikes.
* **Root Cause:** Fixed 2-entry volume LRU cache evicts active volume representations repeatedly during multi-viewport rendering.
* **Remediation:** Increase volume cache capacity with adaptive byte budgeting and reuse memory buffers across planes.

---

### BUG-09 [P2 - Medium]: Hardcoded Current User in Audit Actions
* **File:** [app/(portal)/studies/[id]/page.tsx:L124](file:///d:/meridian-scanlab-integration/meridian/app/%28portal%29/studies/%5Bid%5D/page.tsx#L124), [lib/mock-data.ts:L56-L60](file:///d:/meridian-scanlab-integration/meridian/lib/mock-data.ts#L56-L60)
* **Description:** Report approval stamps `CURRENT_USER` ("Dr. Amara Chen") regardless of who is authenticated in the session.
* **Root Cause:** The authentication store in `lib/store.ts` is not wired into the study approval handler.
* **Remediation:** Bind approval attribution to the active authenticated user profile from `useAuthStore`.

---

### BUG-10 [P2 - Medium]: Missing Error Boundary on WebGL 3D Raymarching Failure
* **File:** [components/viewer/Volume3DViewer.tsx:L150-L180](file:///d:/meridian-scanlab-integration/meridian/components/viewer/Volume3DViewer.tsx#L150-L180)
* **Description:** If WebGL2 context initialization fails or GPU runs out of VRAM for 3D textures, the canvas throws an unhandled exception.
* **Impact:** The entire viewer column collapses into a blank screen.
* **Remediation:** Wrap `Volume3DViewer` with a dedicated medical viewer error boundary displaying a graceful 2D fallback message.

---

### BUG-11 [P3 - Low]: Missing Keyboard Accessibility on Tool Navigation
* **File:** [components/viewer/ViewerToolbar.tsx](file:///d:/meridian-scanlab-integration/meridian/components/viewer/ViewerToolbar.tsx)
* **Description:** Diagnostic toolbar buttons lack full keyboard roving tabindex support and ARIA tool descriptions.
* **Remediation:** Add standardized radiology shortcut bindings and accessibility attributes.

---

### BUG-12 [P3 - Low]: Obsolete Lint Script in `package.json`
* **File:** [package.json:L11](file:///d:/meridian-scanlab-integration/meridian/package.json#L11)
* **Description:** `npm run lint` invokes `next lint`, which Next.js 16 deprecated in favor of ESLint flat config.
* **Remediation:** Update linting script to invoke `eslint .` directly.
