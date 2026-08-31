# ScanLab Viewer Implementation Progress

## Overall Status

Completed: 80%
Current Phase: Phase 4 (polish) — core viewer, markers, and AI-finding integration are done
Last Updated: 2026-08-27

## Completed

- [x] Audited existing viewer architecture (`ImageViewer`, `ViewerToolbar`, `SeriesNavigator`, `SliceNavigator`, `AIOverlay`, `FindingCard`, `FindingsPanel`, `AnalysisTab`) and mock data model before changing anything
- [x] Extended `lib/types.ts`: `Marker`, `ViewerMeasurement`, `ViewerImage`, `DicomInstanceMetadata` (future-PACS-ready, unused/unfabricated), `Finding.seriesId`, `SeriesInfo.images`
- [x] `lib/mock-data.ts`: findings now get a real `seriesId` + randomized `sliceIndex` within that series' actual slice count (previously always slice 0 — multi-slice/series navigation had nothing real to demonstrate)
- [x] Fixed the core bug: markers/measurements were local `ImageViewer` state and leaked across slices/series when navigating. Lifted to `AnalysisTab`, tagged with `seriesId`+`sliceIndex`, filtered per current view before reaching `ImageViewer`
- [x] Marker system: click-to-place (crosshair cursor), numbered pins, optional note editor, edit (click) / delete (double-click or trash icon), normalized 0–1 image coordinates (stay correct through zoom/pan/resize)
- [x] `MarkersPanel` (new): lists every marker across the whole study, jump-to-slice, delete — desktop sidebar + mobile drawer
- [x] Measurement tool preserved and scoped per slice/series the same way; `ViewerMeasurement.distanceMm`/`DicomInstanceMetadata.pixelSpacing` wired into the type/UI so a future real pixel-spacing value renders as `mm` automatically — never fabricated today, still shows `px`
- [x] `SliceNavigator`: cine play/pause now controlled from the page (needed for the Space key), Previous/Next disable at the first/last slice and never wrap (cine loop still wraps, intentionally), first/last jump buttons, aria-labels + tooltips
- [x] Keyboard navigation at the page level: ArrowLeft/Up = previous, ArrowRight/Down = next, Space = play/pause cine — all guarded so they don't fire while a text input (e.g. a marker note) has focus
- [x] `ThumbnailStrip` (new): windowed rendering (±20 slices around the current one, ~40 DOM nodes max regardless of a 200+ slice study), click to jump, auto-scrolls the active thumbnail into view
- [x] AI finding → viewer integration: clicking a finding (from `AIOverlay` or `FindingCard`) switches to its series (if different), jumps to its exact slice, and resets zoom/pan so the highlighted bounding box is back in frame
- [x] `FindingCard`/`FindingsPanel` now show which series + slice a finding lives on when it isn't sliceCount 1
- [x] Fullscreen fixed: previously only the bare image container went fullscreen, losing the toolbar and slice controls. Now the whole viewer column (toolbar + image + thumbnails + slice nav) is what goes fullscreen
- [x] Reset View still resets zoom/pan/brightness/contrast/invert/tool only — markers and measurements are untouched (was already implicitly true, now explicitly correct since they aren't part of `ViewerState`)
- [x] Explicit empty/error state in `ImageViewer` for a series with no image data, and a page-level empty state if a study has zero series, instead of either crashing or silently rendering nothing
- [x] Entry points: "View Scan" quick action added to `StudyCard` (hover reveal) and `StudyTable` (icon button), both deep-link to `/studies/[id]?tab=analysis`; "Open Viewer" button + clickable series rows added to `OverviewTab`; the study detail page reads `?tab=` on load to land directly on the viewer
- [x] Mobile: reused the existing `Drawer` component for Series / Findings / Markers on small screens; toolbar and quick-action row both scroll horizontally instead of overflowing on narrow phones
- [x] `npm run build` passes (0 errors); `next lint` passes (0 warnings)

## In Progress / Partially Done

- [ ] Per-series real image arrays (`SeriesInfo.images`) — the type and the viewer's fallback chain (`series.images → study.imageUrls → placeholder`) are implemented, but nothing populates `images` yet because there's no per-series upload flow (today's upload only ever produces one series). Not a blocker for the demo since seeded studies never had real per-slice imagery anyway.
- [ ] mm-based measurements — `distanceMm`/`pixelSpacing` are typed and the UI already prefers `distanceMm` when present; there is no real DICOM pixel-spacing source to populate it from yet, so it correctly stays in `px` for all current data.

## Remaining

- [ ] Manual in-browser QA pass (mouse + touch) — verified via `next build`, `next lint`, and a static-bundle string check that the new UI text/components compiled and shipped; have not click-tested in an actual browser viewport (no browser available in this environment)
- [ ] Small-screen (< 375px) visual pass on the toolbar row — it now scrolls horizontally instead of overflowing, but hasn't been eyeballed at real device widths
- [ ] Optional: a proper virtualized thumbnail strip (current approach is a fixed ±20 window, which is O(1) DOM nodes but re-renders the window on every slice change rather than true virtualization — fine at current scale, would want `react-window`-style virtualization only if studies grow far beyond ~1000 slices)
- [ ] Modality-specific toolbar tuning (e.g. hiding pan/measure for a true single-frame study) — currently the same toolbar shows for every modality; behavior differences (series/slice count) are already modality-appropriate via the data model, just not the toolbar itself

## Files Modified

- `lib/types.ts`
- `lib/mock-data.ts`
- `components/viewer/ImageViewer.tsx`
- `components/viewer/SliceNavigator.tsx`
- `components/viewer/ThumbnailStrip.tsx` (new)
- `components/viewer/MarkersPanel.tsx` (new)
- `components/viewer/FindingCard.tsx`
- `components/viewer/FindingsPanel.tsx`
- `components/report/AnalysisTab.tsx`
- `components/report/OverviewTab.tsx`
- `components/studies/StudyCard.tsx`
- `components/studies/StudyTable.tsx`
- `app/(portal)/studies/[id]/page.tsx`

Unchanged (reused as-is): `components/viewer/ViewerToolbar.tsx`, `components/viewer/SeriesNavigator.tsx`, `components/viewer/AIOverlay.tsx`, `components/studies/ScanThumbnail.tsx`, `components/ui/*`, `lib/store.ts`, `lib/hooks.ts`.

## Architecture Decisions

- No new dependencies were added — everything above uses what was already in `package.json` (React state, Zustand only where it already existed, lucide-react, framer-motion, Tailwind).
- Markers/measurements are kept in React state on `AnalysisTab`, not a Zustand store — consistent with how report edits and finding status changes already work in this app (in-memory only, lost on refresh). If persistence is added later, it should go through the same boundary `lib/mock-data.ts` already defines for studies.
- `SeriesInfo.images` / `DicomInstanceMetadata` were added as optional, currently-unpopulated fields specifically so a future PACS/DICOM integration has a typed place to land without another data-model migration. Nothing in the app fabricates values for these fields today.
- The thumbnail strip windows to ±20 slices instead of true virtualization to avoid a new dependency; revisit if studies routinely exceed ~1000 slices.

## Known Issues

- None found via `next build` / `next lint`. No in-browser interaction testing was possible in this environment — recommend a manual pass on: marker note editing (blur/Enter-to-close), cine playback across a series switch, and the fullscreen toolbar layout on an actual phone/tablet.

---

## Phase 6 — Radiologist Pen/Pencil Annotation & Finding System

Extended the existing viewer with a freehand pen tool, scoped per study/series/slice, plus a radiologist finding workflow connected to the existing Findings panel and Report editor. No existing functionality was removed or restructured.

### New files

- `lib/types.ts` — added `ViewerAnnotation` (a single pen stroke: normalized points, color, strokeWidth, opacity, optional quick note, optional `findingId` link) and `RadiologistFinding` (the radiologist's exact free-text observation plus optional structured fields, optionally linked back to an annotation via `annotationId`).
- `components/viewer/AnnotationCanvas.tsx` — the drawing + rendering layer. Pointer-event based (mouse/trackpad/touch/stylus-ready). Renders committed strokes as smoothed SVG paths (quadratic-midpoint smoothing) inside a `viewBox="0 0 100 100"` with `vector-effect="non-scaling-stroke"`, so strokes stay pinned to the same image region across zoom/pan and keep a constant on-screen thickness. The in-progress stroke is updated by mutating a `<path d>` attribute directly via a ref during `pointermove` — no React state/re-render until the stroke is finished — so drawing stays smooth regardless of study size. A plain tap (no drag) hit-tests against existing strokes to select one instead of creating a zero-length stroke; the selected stroke gets a small popover (Add/Edit Finding, quick note, delete, deselect).
- `components/viewer/AnnotationToolbar.tsx` — the compact panel shown only while Pen is the active tool: 3 brush sizes, an opacity slider, 5 colors (default red), Undo, Redo, Clear (with a confirmation modal), Exit. Exports `BRUSH_WIDTH_PX`, `ANNOTATION_COLORS`, `DEFAULT_ANNOTATION_COLOR` for reuse.
- `components/viewer/AnnotationEditor.tsx` — the "Add/Edit Finding" modal. The large free-text field is the only required input; Finding type / Location / Severity / Confidence / Radiologist note are optional. The text is stored exactly as typed — nothing here paraphrases, summarizes, or "improves" it.
- `components/viewer/RadiologistFindingCard.tsx` — renders a radiologist-authored finding, visually and label-distinct from `FindingCard` (AI). Includes Add to Report / Edit / Delete.

### Modified files

- `components/viewer/ViewerToolbar.tsx` — added `"pen"` to `ViewerTool` and a Pen button in the existing toolbar row (`[Pan] [Window] [Measure] [Marker] [Pen] [Reset] [Fullscreen]`). No existing tool behavior changed.
- `components/viewer/ImageViewer.tsx` — added a pencil SVG cursor for Pen mode (Pan keeps its grab cursor, Measure keeps crosshair, Marker keeps copy-cursor — unchanged); mounted `AnnotationCanvas` as an additional layer inside the same transformed container used by markers/measurements, so it inherits the exact same zoom/pan math (proven correct already, not reinvented). The canvas overlay only captures pointer events while Pen is active (`pointer-events-none` otherwise), so it can never intercept Pan/Measure/Marker interactions.
- `components/viewer/FindingsPanel.tsx` — now also renders a "Radiologist Findings" section below AI Findings, clearly labeled and using `RadiologistFindingCard`. Backward compatible: the new props are optional so nothing else calling this panel needed changes (none did).
- `components/report/AnalysisTab.tsx` — owns all new state: `annotations`, `radiologistFindings`, `selectedAnnotationId`, per-slice `redoStacks` (keyed `seriesId:sliceIndex`), and brush settings — same in-memory, session-scoped pattern already used for markers/measurements (no backend exists yet for any of this; not faked). Implements: stroke commit, undo/redo (per current slice only), quick note, delete-with-orphan-handling (asks whether to also delete the attached finding, or detach-and-keep it), bulk "Clear Annotations" (detaches, rather than deletes, any attached findings — stated explicitly in the confirmation copy), and the Add/Edit Finding flow. Wires "Add to Report" through a new callback down from the page.
- `app/(portal)/studies/[id]/page.tsx` — added `onAppendFindingToReport`, which appends (never overwrites) a radiologist finding into `report.sections.findings`, prefixed `"Radiologist observation:"`, and passes it into `AnalysisTab`.

### Design notes / requirements mapping

- **Slice isolation**: annotations and findings both carry `studyId`/`seriesId`/`sliceIndex`; `AnalysisTab` always filters to the current series+slice before handing them to `ImageViewer`/`FindingsPanel` gets the full list (so it can show a "Slice 18" label per item, same convention as AI findings already use).
- **Zoom/pan compatibility**: annotation points are normalized 0–1 and read from the same (already-transformed) container `getBoundingClientRect()` that markers/measurements use — proven to stay attached across zoom/pan since it's the same mechanism, not a new one.
- **Undo/redo**: scoped per slice via a keyed redo-stack; a new stroke on a slice clears that slice's redo stack (standard editor semantics).
- **Radiologist text integrity**: `AnnotationEditor` never trims, rewrites, or reformats the finding text; it's stored byte-for-byte as typed. AI-authored and radiologist-authored content are never merged into the same record — `Finding` (AI) and `RadiologistFinding` (human) stay fully separate types, surfaced with distinct labels/colors in the UI.
- **Performance**: only the current slice's annotations are ever passed to the canvas/rendered; the live stroke bypasses React state entirely until `pointerup`.

### Manual QA still recommended

Same caveat as Phase 1–5: no in-browser interaction testing was possible in this environment. Recommend running the 10-test acceptance checklist from the feature spec (draw → slice isolation → zoom → pan → add finding → exact-text persistence within the session → undo → redo → clear-current-slice-only → no regressions on pan/measure/markers/AI overlays/report editor) on a multi-slice CT/MRI study.

## Build Status

Command:
`npx next build`

Status:
PASS

Errors:
(none)

## How To Continue

1. Read this file top to bottom before touching anything.
2. Do a manual browser QA pass on `/studies/[id]?tab=analysis` for a CT or MRI study (multi-series, multi-slice) — this exercises series switching, slice navigation, cine, markers, measurements, and AI-finding jump-to all at once.
3. If persistence is requested next, look at `lib/mock-data.ts`'s stated integration boundary — markers/measurements should follow the same pattern as `onUpdateFinding` in `app/(portal)/studies/[id]/page.tsx` once there's a real backend.
4. Do not redo the marker/measurement lifting — it's complete and scoped correctly per series+slice.
5. Run `npx next build && npx next lint` after any further change before considering it done.
