# Meridian / Vedh Medical Imaging

A premium, production-grade AI-assisted medical imaging workspace — built with Next.js 14 (App Router), TypeScript, Tailwind CSS, React Three Fiber, and Framer Motion.

## Recent changes in this pass

You reported the scan preview looking permanently blurry, and asked for a more colorful, animated, interactive feel. Here's exactly what changed:

- **Fixed: the viewer never actually showed your uploaded file.** `ScanThumbnail.tsx` always rendered a procedurally generated noise texture (fractal turbulence) as a stand-in — regardless of what you uploaded. That texture is what read as "blurry." The upload flow now turns your real file(s) into object URLs and threads them through `Study.imageUrls` → `AnalysisTab` → `ImageViewer` → `ScanThumbnail`, which renders your actual image at full sharpness (`object-fit: cover`, no blur/filters). The synthetic texture is now used only as a fallback for the 34 seeded demo studies, which have no underlying file, or if a non-image file (e.g. raw `.dcm`) fails to load as an `<img>`.
  - You'll see a **live preview of your image the moment you select it** on the Upload Scan page, before you even click "Start Upload."
  - Multiple image files uploaded together are treated as slices — the slice navigator in the viewer pages through your real images, not placeholders.
  - Card thumbnails (Studies grid, Study Summary panel) now show the real image too, with a subtle Ken-Burns drift — the diagnostic viewer itself stays perfectly still (no drift) since that's where measurement/reading happens.
- **More color, used with intent, not just for decoration.** Dashboard KPI tiles are now tone-coded — blue for volume, green for AI throughput, amber/orange for what needs attention, red for what's critical. AI finding cards carry a colored left-edge accent matching their confidence band (green/orange/red), and briefly flash that color when you accept, modify, or reject a finding.
- **More movement.** Dashboard stat cards count up on load and stagger in; AI finding boxes on the image and their cards in the side panel animate in with a stagger; the active finding gets a soft pulsing glow; a scanning light sweep plays over the viewer while AI analysis is "in progress"; the analytics bar/donut charts draw themselves in on load instead of appearing instantly.
- Verified clean end-to-end: `tsc --noEmit`, `next lint`, and `next build` all pass with zero errors or warnings, and every route was smoke-tested against a running dev server.

## Before you start: what this is

The uploaded project skeleton contained an empty folder structure with no source files to audit or preserve. This build implements the full application from scratch, using that folder layout as the intended architecture. A few deliberate decisions worth knowing about:

- **Routes match the original scaffold** (`dashboard`, `studies`, `studies/[id]`, `upload`, `incident-report`) rather than inventing new top-level pages for every sidebar item in the brief. **"AI Analysis" and "Report"** live as tabs inside the Study Workspace (`/studies/[id]`) instead of separate routes — this mirrors how real PACS/RIS tools structure a study, and avoids routes with no clear entry point. `/reports`, `/analytics`, and `/settings` were added as new (additive, non-breaking) routes since the brief's sidebar explicitly calls for them.
- **No real backend, PACS/DICOM integration, or AI model exists.** All data lives in `lib/mock-data.ts` behind a small set of functions (`listStudies`, `getStudy`, `createDemoStudy`, …) — this is the single integration boundary. Swapping in a real API means changing that one file; no component talks to mock data directly.
- **Scan imagery you upload is shown for real** (via in-browser object URLs — nothing is sent to a server); the procedurally generated placeholder in `components/studies/ScanThumbnail.tsx` is only a fallback for the seeded demo studies that have no underlying file, seeded per study for visual variety and tinted per modality.
- **Login is a functional demo auth flow** (any email/password signs you in, session kept in `localStorage`) — there's no real identity backend to check credentials against, and the UI says so rather than pretending otherwise.
- **The AI-assisted disclaimer is never hidden** — it's shown on the Report tab and printed into every exported PDF.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on `/login` — any email and password will sign you in.

```bash
npm run build && npm run start   # production build
```

This project has been verified to build and serve cleanly end-to-end (`npm run build` + smoke-tested every route).

## Architecture

```
app/
  login/                    Demo auth
  (portal)/                 Auth-gated route group, wrapped in AppShell
    dashboard/               Clinical command center + 3D hero
    studies/                 Search/filter/sort, table + grid views
    studies/[id]/             Study Workspace: Overview / Viewer & AI / Report tabs
    upload/                   Drag-drop upload → processing pipeline → new study
    incident-report/          Incident log + submission form
    reports/                  Cross-study report index + PDF export
    analytics/                Lightweight workspace charts
    settings/                 Profile, theme, motion preference, notifications

components/
  ui/            Design-system primitives (Button, Badge, Panel, Modal, Drawer,
                 Tooltip, Input, Skeleton, EmptyState, Toaster, CommandPalette)
  layout/        AppShell, Sidebar, Header, MobileNav (bottom tabs + sheet)
  three/         MedicalScene + subcomponents (isolated from the rest of the UI)
  dashboard/     StatCard, DashboardHero, PriorityQueue
  studies/       StudyTable, StudyCard, StudyFilters, ScanThumbnail
  viewer/        ImageViewer, ViewerToolbar, SliceNavigator, SeriesNavigator,
                 FindingsPanel, FindingCard, AIOverlay
  report/        ReportEditor, ApprovalPanel, ExportButton, StudyPipeline,
                 StudySummaryCard, Overview/Analysis/Report tab compositions
  upload/        UploadZone, ProcessingTimeline
  incident/      IncidentCard, IncidentForm
  analytics/     BarChart, DonutChart (hand-rolled SVG, no chart dependency)

lib/
  types.ts        Domain model
  mock-data.ts     Deterministic seeded dataset + the integration boundary
  store.ts         Zustand: UI state (sidebar, theme, motion, toasts), auth
  hooks.ts         Reduced-motion, WebGL-support, click-outside
  pdf.ts           Client-side clinical PDF report generator (jsPDF)
  utils.ts         cn() + date/name formatting
```

## Notable implementation details

- **3D is restrained and purposeful** — used in exactly two places (login branding panel, dashboard hero), both ambient/ok-to-ignore visualizations, never blocking clinical workflow. Every 3D component respects `prefers-reduced-motion` (or the in-app override in Settings) and has a static SVG fallback if WebGL is unavailable or the scene throws.
- **Viewer tools are real, not decorative**: zoom, pan, window-level (brightness), contrast, invert, reset, fullscreen, a click-to-measure tool with live pixel distance, and click-to-annotate pins — all implemented against the procedural scan image.
- **AI findings are confidence-scored, never overstated** — bounding boxes are color-coded by confidence band, and every findings panel includes a standing note that AI output is decision support, not diagnosis.
- **Approval requires deliberate confirmation** (a modal with an explicit acknowledgment checkbox), and locks the report content once signed.
- **PDF export** builds a real, structured clinical-report layout client-side — not a screenshot.
- **Accessibility**: visible focus rings throughout, semantic controls, global reduced-motion CSS fallback, and a responsive layout that recomposes (not just shrinks) — a real bottom-tab mobile nav and drawer-based series/findings access on the study workspace, rather than a squeezed three-column desktop layout.

## Known gaps (by design, given the demo scope)

- No real PACS/DICOM ingestion, no real AI inference — see the integration boundary above.
- Priority/status edits on the Studies table are session-local (in-memory), since there's no backend to persist them to.
- Light mode is implemented for the primary surfaces but not exhaustively audited on every pixel — dark is the primary, tested experience per the brief.
