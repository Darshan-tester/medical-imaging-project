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

---

## Phase 7 — Real dataset integration: report matching + true multiplanar reconstruction

Scope: diagnose why Chest X-Ray and PET studies had no report, and why MRI/PET only ever produced an axial view, then fix the causes in the existing adapter/render pipeline. CT was deliberately not touched — the DICOM half of `lib/dataset/image-render.ts` and `lib/dataset/adapters/ct.ts` are byte-identical to before.

### Root causes

1. **Chest X-Ray reports** — two unrelated datasets were being joined. The indexed images are Kaggle Chest-Xray-Pneumonia JPEGs; the only report file inside `01_CHEST_XRAY` is `MIMIC-CXR_complete_metadata.csv`, whose entire header is `reports,image_information` (values like `"Image present | Bytes: 33,749"`). With no identifier column, `pickColumn(row, ["filename", …])` returned undefined for every row, so the report lookup was always empty. The genuine MIMIC pairing survives only as row-adjacency inside the parquet files, and had already been materialized by `_integration\extract_chest_images.py` into `chest_images\CHEST_%06d.jpg` + `chest_image_manifest.csv` — a folder that sits *outside* `01_CHEST_XRAY`, and the scanner only ever hands an adapter one directory, so the adapter never saw it.
2. **PET reports** — the adapter and `report_en.csv` were already compatible (`Image ID` normalizes to `imageid`, `Report Diagnosis` is read). The committed manifest was simply stale: its PET `sourceStudyId` values were full filename stems that the current code cannot produce. Re-indexing is the fix. A second, real bug was found alongside it: one study was emitted per NIfTI file, which doubled the PET study count and presented the attenuation CT as if it were PET.
3. **MRI axial-only** — MR-RATE is genuinely volumetric, but `buildSeriesFromFiles` mapped one NIfTI *file* to one `DatasetImageRef` with no `frameIndex`, so `renderNifti(absPath, 0)` returned slice 0 and nothing else in the volume was reachable. Orientation was a filename-substring guess with an `"Axial"` fallback; nothing read the affine.
4. **PET multiplanar** — same cause as MRI. PETWB-REP volumes are 200×200×221 at 4.07×4.07×5 mm with a valid affine, so all three planes are reconstructable; the anisotropy just has to be resampled.

### Files changed

- `lib/dataset/types.ts` — `DatasetImageRef` gained optional `frameIndex` (slice within a multi-frame container) and `orientation` (which anatomical plane `frameIndex` counts along).
- `lib/dataset/image-render.ts` — NIfTI half rewritten: `readNiftiGeometry`, affine-driven `assignAxes` (greedy strongest-component matching, so an oblique volume still yields a true axis permutation), `geometryFromHeader` (per-plane slice count plus physically-square pixel dimensions from pixdim, capped at 1024 px), and `renderNifti(absPath, frameIndex, plane)`. `hasSpatialTransform` records whether a qform/sform was actually present. Volumes are LRU-cached (2 entries) so scrolling 200 coronal slices inflates the gzip once, not 200 times.
- `lib/dataset/adapters/shared.ts` — new `buildNiftiVolumeSeries`: one `DatasetSeries` per plane the volume genuinely supports, all pointing at the same `absPath`, varying only `frameIndex`/`orientation`. Planes with < 2 slices are dropped, not fabricated; the acquired plane sorts first and the other two are labelled `(MPR)`.
- `lib/dataset/adapters/mri.ts` — the inline orientation-guessing block was replaced by `buildMriSeriesForFiles`, which routes NIfTI volumes through `buildNiftiVolumeSeries` and leaves DICOM/raster stacks on the original `buildSeriesFromFiles` path with `flatOrientation` (DICOM `ImageOrientationPatient` first, filename only as fallback).
- `lib/dataset/adapters/pet.ts` — `scanNifti` now groups volumes by BIDS subject+session into one study, and `volumeDescriptor` types `_desc-resampled_ct` as `modality: "CT"` inside that study rather than mislabelling it PET. `scanDicom` untouched.
- `lib/dataset/adapters/chest-xray.ts` — new pass 1 detects any CSV carrying an identifier, an image path and a report *in the same row*, discovers such manifests in sibling `_integration`/`_derived`/`_prepared` folders, re-checks every resolved path with `assertWithinRoot(dataRoot, …)` plus an existence and extension check, dedupes by id and by path, and excludes those images from the generic pass 2.
- `lib/dataset/config.ts` — `getChestPairLimit()` (`SCANLAB_CHEST_PAIR_LIMIT`, default 1500, `"all"` to lift). Caps how many pairs are indexed; never alters the content of a report that is indexed.
- `lib/dataset/manifest-store.ts` — `readManifest()` memoizes on the manifest's mtime+size (it is called on every slice GET, and volumes expanded per plane make it far larger); `writeManifest` invalidates.
- `scripts/mpr-check.ts` + `package.json` — new `npm run dataset:mpr-check`.

### How the planes are generated

The NIfTI affine's column *j* is the world direction travelled by stepping +1 along array axis *j*, so `assignAxes` reads which array axis carries R/A/S and `PLANE_SCREEN_AXES` fixes one display convention for every modality (anterior up on coronal, superior up on coronal/sagittal, patient right on the viewer's left). `renderNifti` then walks the through-axis for the requested plane and nearest-neighbour resamples the in-plane axes onto physically square pixels — which is why a 4.07×4.07×5 mm PET volume yields a 271-row coronal image rather than a squashed 221. Slice 0 of the acquired plane is still array index 0, so axial numbering is unchanged from before MPR existed.

### Verification status — READ THIS

`npm run dataset:index`, `npm run dataset:verify`, `npm run dataset:mpr-check`, `npx next build` and `npx next lint` were **NOT run** for this phase: the sandbox this work was done in had no shell (the Linux VM failed to start). Everything above was reviewed statically only. Run, in order:

```
npm run dataset:index
npm run dataset:verify
npm run dataset:mpr-check
npx next build
npx next lint
```

`dataset:mpr-check` prints each volume's dims, mm spacing, whether a qform/sform was present, the acquired plane, and then per plane: slice count, rendered pixel size, through-axis, and the non-black fraction of the middle slice — writing those slices as PNGs under `.scanlab/logs/mpr-check`. Differing slice counts and pixel heights per plane are what prove these are reslices of the volume rather than rotations of one image; open the PNGs to confirm the anatomy.

## Phase 8 — Cloudflare Workers deployment (Next 16 + OpenNext)

Scope: get the app deployable to Cloudflare Workers. CT was again not touched — `lib/dataset/adapters/ct.ts` and the DICOM half of `lib/dataset/image-render.ts` are unchanged in this phase.

### Why the first Cloudflare build failed

Build `#c59ba8e9` ran `npm run build` then `npx wrangler deploy`. With no Wrangler config in the repo, `wrangler deploy` entered its automatic-configuration path (`runAutoConfigLogic` → `maybeRunAutoConfig`), picked the OpenNext adapter for us and ran `npx opennextjs-cloudflare build`, which exited 1:

```
ERROR Next.js version 14.2.35 is not supported by the Next.js team.
```

Two separate problems sat behind that one line. First, `package.json` had been bumped to Next 16.3.4 / React 19 locally but the *deployed* branch was still 14.2.35 and the code had never been migrated. Second, Wrangler was choosing the adapter itself, so nothing about the deployment was pinned or reviewable.

### Files added

- `wrangler.jsonc` — Worker name `vedh-medical-imaging` (must match the existing Worker, or `deploy` creates a second one), `main: ".open-next/worker.js"`, `compatibility_date` 2026-08-04, flags `nodejs_compat` + `global_fetch_strictly_public`, assets binding `ASSETS` → `.open-next/assets`, observability on. No R2/D1/KV bindings.
- `open-next.config.ts` — bare `defineCloudflareConfig()`. R2 incremental cache and D1 tag cache are deliberately off: they need bindings that do not exist yet, a missing binding fails the build rather than degrading, and every API route here is `force-dynamic` with no ISR pages, so there is nothing to cache.
- `lib/dataset/counts.ts` — `countByDataset` extracted verbatim from `scanner.ts`. `/api/datasets` imported it from `scanner`, which pulled all six adapters → `adapters/mri.ts` → `zip-cache.ts` → `adm-zip` (and its optional `original-fs` require) into the Worker bundle for one pure function. `scanner.ts` is now reachable only from `scripts/`.

### Next 16 breaking changes fixed

- Route handler `params` is a `Promise` in Next 15+. Awaited in `app/api/studies/[id]/route.ts`, `.../report/route.ts`, `.../images/[...path]/route.ts`, `.../volume/[seriesId]/route.ts`. The generated `.next/types` route validators fail the build otherwise.
- `next.config.js` — `eslint.ignoreDuringBuilds` removed (Next 16 dropped `next lint` and `next build` no longer lints) and the `original-fs` webpack alias removed (unnecessary now that `adm-zip` is out of the app graph; a `webpack` key would also be ignored under Next 16's default Turbopack build).
- `npm run lint` still points at `next lint`, which no longer exists. Left as-is rather than half-migrated: `.eslintrc.json` is eslintrc-format while the installed ESLint is 9.x, so that needs a flat-config migration of its own. Nothing in `verify:all` or the build calls it.

### Type errors fixed (React 19 / framer-motion 13)

Eleven whole-program type errors, in three groups:

- Six `Type 'string' is not assignable to type 'never'` errors on icon props. Cause was **not** React 19 or lucide-react: `@react-three/fiber` augments the global `JSX.IntrinsicElements` with three.js elements that have no `className`, so `React.ElementType`'s prop intersection collapses to `never`. `components/ui/Badge.tsx` typechecks clean in isolation and only fails in the full program. Fixed by switching five sites to `LucideIcon` (already used without error in `StatCard.tsx` and `EmptyState.tsx`): `Badge.tsx`, `ViewerToolbar.tsx`, `AnalysisTab.tsx`, `CommandPalette.tsx`, `app/(portal)/studies/[id]/page.tsx`.
- `app/(portal)/dashboard/page.tsx` — `cardVariants` annotated `Variants` so `ease: [0.16, 1, 0.3, 1]` stays a 4-tuple instead of widening to `number[]`. The many inline `transition={{ ease: [...] }}` props never errored because the prop supplies that context already.
- `lib/hooks.ts` — `useOnClickOutside` now takes `RefObject<HTMLElement | null>`; React 19 types `useRef<T>(null)` as `RefObject<T | null>`, which `Header.tsx` passes three of.

### Repo hygiene

- The in-tree `meridian/` duplicate (a full stale copy of this app, 130 of 276 tracked files) and the `*.backup` / `*-debug.txt` working files were untracked with `git rm -r --cached` and gitignored. **Nothing was deleted from disk** — every file is still there; git just stops shipping them to the builder. Tracked files: 276 → 141.
- Dataset ignore patterns are now root-anchored. Unanchored `datasets/` also matched `app/api/datasets/`, so `/api/datasets` and `/api/datasets/status` were never committed and never reached any build. Both are now tracked.
- `demo-pack/INDEX.txt` and `lib/dataset/adapters/chest.ts` show as modified but differ from `HEAD` only in line endings (CRLF in the worktree, LF in git). Left uncommitted on purpose — committing them would be a 2,066-line no-op diff.

### Verification status — READ THIS

What was actually run: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` over the whole program. It reports exactly one error, and only this one:

```
open-next.config.ts(1,40): error TS2307: Cannot find module '@opennextjs/cloudflare'
```

That clears as soon as the package is installed. All eleven pre-existing type errors are gone.

What was **not** run, and cannot be run in this environment: `next build`, `next dev`, `opennextjs-cloudflare build`, ESLint, and any `npm install`. The npm registry returns 403 here and the only installed SWC binary is `@next/swc-win32-x64-msvc`, so the build must be verified on Windows or on Cloudflare's builder. Treat "typechecks" as strictly weaker than "builds".

Also still true from Phase 7: the dataset index on disk is `builderVersion 3` while the code expects `4`, so real data stays invisible until `npm run dataset:index` is re-run on Windows.

### What has to happen next (on Windows)

```
npm install --save-dev @opennextjs/cloudflare wrangler
npm run build
npx opennextjs-cloudflare build
git push -u origin cloudflare-next-upgrade
```

Status as of 2026-09-01: the install and `npm run build` both **passed** on Windows (`@opennextjs/cloudflare` 1.20.5, `wrangler` 4.127.1, `@opennextjs/aws` 4.1.3). `npx opennextjs-cloudflare build` **failed with an out-of-memory abort** — see the OOM section below; it is a Windows/RAM problem, not a code problem, and the fix is to let Cloudflare's Linux builder run it.

The install has to be done there, not here, so `package.json` and `package-lock.json` stay in sync — Cloudflare's install step runs `npm ci`-style and will fail on a lockfile that does not list the adapter. Next.js 16 and the latest minors of 14/15 are the supported set for `@opennextjs/cloudflare`, and Turbopack builds have been supported since adapter v1.15.0, so Next 16's default Turbopack `next build` is fine.

Then in the Cloudflare dashboard, for the `vedh-medical-imaging` Worker:

- Build branch: `cloudflare-next-upgrade` (leave `main` alone until this deploy is proven green).
- Deploy command: `npx opennextjs-cloudflare deploy` — not `npx wrangler deploy`. The adapter has to build `.open-next/` before anything is uploaded; `wrangler deploy` on its own is what triggered the auto-config guessing.
- Build command: must be `npx opennextjs-cloudflare build`, **not** `npm run build`. See the OOM section below — `deploy` does not build, so `npm run build` alone leaves `.open-next/` missing and the deploy has nothing to upload.

### What the first successful deploy will and will not show

It will serve the app against the seeded mock studies. It will **not** serve real scans: Workers have no filesystem, so `SCANLAB_DATA_ROOT`, `.scanlab/manifest.json`, the ZIP extraction cache and the server-side DICOM/NIfTI decode have nothing to read. `readManifest()` swallows ENOENT and returns `undefined`, so the dataset surfaces degrade to "No dataset index has been built yet." rather than erroring. `NEXT_PUBLIC_DATA_MODE` must stay unset (or `mock`) until the R2 work below lands.

### R2 migration — sequenced, not yet started

The chosen end state is the full dataset in R2. In dependency order:

1. Upload the dataset to an R2 bucket and add the binding to `wrangler.jsonc` (keeping `SCANLAB_DATA_ROOT` as the local Windows path — it must never become a `NEXT_PUBLIC_*` var, and `absPath` must never reach the client).
2. Replace the single 5.7 MB `.scanlab/manifest.json` with per-study objects or a KV/D1 index; a 2,314-study JSON blob per cold start is not viable in a Worker.
3. Make `fs-utils.ts`, `manifest-store.ts` and `image-render.ts` read through an async storage interface with two implementations — Node `fs` for Windows, R2 `get()` for Workers — so the local path keeps working unchanged.
4. Pre-extract the ZIPs during indexing instead of at request time (`adm-zip` and its `original-fs` require cannot run on Workers).
5. Pre-compute the CT volume exports rather than decoding DICOM per request; `assertWithinRoot` must stay in the path-resolution chain in whatever form the R2 key mapping takes.

Steps 3–5 are where CT is most at risk. None of it should be started without re-reading the Phase 7 notes above.

### The Windows OOM on `opennextjs-cloudflare build` — and the corrected commands

`npm run build` succeeds on Windows (Next 16.3.4 Turbopack, ~51 s, all 19 routes, TypeScript clean). `npx opennextjs-cloudflare build` then failed with:

```
memory allocation of 4193332 bytes failed
Error: Command failed: npm run build   status: 3221226505
```

`3221226505` is `0xC0000409` (Windows fail-fast abort) and the line above it is **Rust** — Turbopack — failing to get 4 MB from the OS. It is a machine memory failure, not a code error. Nothing in the app is broken.

Why the second build failed when the first passed:

1. Run 1 started with a cold Turbopack cache and, on success, wrote **99 MB** into `.next/cache/turbopack` (five `.sst` files, largest 19.7 MB). Run 2 restores that cache.
2. OpenNext calls `setStandaloneBuildMode()` before `npm run build`, which sets `NEXT_PRIVATE_STANDALONE=true` and `NEXT_PRIVATE_OUTPUT_TRACE_ROOT`. So run 2 additionally does full output-file tracing and copies a `.next/standalone` tree — work run 1 never did.
3. OpenNext prints `WARN OpenNext is not fully compatible with Windows … recommended to use WSL` for exactly this class of problem.

Note also that `buildHelper.initOutputDir()` wipes `.open-next` and Next wipes its own `.next/server` and `.next/static` at build start, so **a failed OpenNext build destroys the output of the `npm run build` that came before it.** After that failure `.next/server` and `.next/static` were empty; only `.next/cache` survived. Do not assume a previous good build is still on disk.

**Corrected Cloudflare dashboard settings.** Read from the installed adapter source (`@opennextjs/cloudflare@1.20.5`, `dist/cli/commands/deploy.js`): `deploy` does **not** build. It reads `.open-next/.build/open-next.config.mjs`, populates the cache, then shells out to `wrangler deploy`. So the build phase has to produce `.open-next/` or the deploy has nothing to upload:

- Build command: `npx opennextjs-cloudflare build` (or `npm run cf:build`) — **not** `npm run build`, which produces no `.open-next/`.
- Deploy command: `npx opennextjs-cloudflare deploy` — **not** `npx wrangler deploy`.
- Build branch: `cloudflare-next-upgrade`.

The same file also explains the original `#c59ba8e9` failure outright. `deploy` sets `OPEN_NEXT_DEPLOY=true` with the comment *"otherwise `wrangler deploy` run in an open-next project would call `opennextjs-cloudflare deploy` (thus causing an unwanted recursion)"* — i.e. bare `wrangler deploy` in an OpenNext project delegates back to the adapter. That delegation is what ran the adapter against Next 14.

**Preferred fix: do not run the OpenNext build on Windows at all.** Cloudflare's builder is Linux, which is the supported platform, and it clones only tracked files — so the 7 GB `.scanlab/` and the `meridian/` duplicate (both untracked now) never reach it. Push the branch and let the builder do it.

**If a local `.open-next/` is wanted anyway** (for `npm run cf:preview`), in order of cost:

1. Clear the Turbopack cache first, so the build starts cold like the run that worked. `.next` is entirely regenerable build cache.
   ```powershell
   Remove-Item -Recurse -Force .next
   npx opennextjs-cloudflare build
   ```
2. Build with webpack instead of Turbopack, then let OpenNext skip the rebuild. This moves the allocation onto the V8 heap where `--max-old-space-size` actually applies — it cannot help a Rust allocator failure. `next build --webpack` exists in 16.3.4, `--skipNextBuild` exists on the adapter (aliases `--skipBuild`/`-s`, env `SKIP_NEXT_APP_BUILD=1`), and OpenNext detects either runtime via `getBundlerRuntime()`. `NEXT_PRIVATE_STANDALONE` must be set by hand here, because the adapter only sets it on the branch that runs the build.
   ```powershell
   Remove-Item -Recurse -Force .next
   $env:NEXT_PRIVATE_STANDALONE="true"
   $env:NODE_OPTIONS="--max-old-space-size=8192"
   npm run build -- --webpack
   npx opennextjs-cloudflare build --skipNextBuild
   ```
3. Run it under WSL, which is what OpenNext recommends.

### Pre-flight checks done against the installed packages

Each of these was a plausible way the first Cloudflare build could fail, and each is cleared:

- **Native binary for Linux.** `package-lock.json` was generated on Windows, but it carries all eight `@next/swc-*` platform entries as optional deps, `@next/swc-linux-x64-gnu` included. `npm ci` on the builder resolves the Linux binary; the Windows-only `node_modules` here is not what ships.
- **Node version.** `wrangler@4.127.1` declares `engines.node >= 22.0.0`. Workers Builds defaults to **Node 24.18.0** (changelog 2026-07-30), so this is satisfied. Pinning it explicitly (a `NODE_VERSION` build variable or `.nvmrc`) is still worth doing — Cloudflare recommends pinning so a future default bump cannot move under the project.
- **Next version gate.** `@opennextjs/cloudflare@1.20.5` declares `peerDependencies.next` as `">=15.5.24 <16 || >=16.3.3"`. 16.3.4 satisfies the upper branch — which is why `ensureNextjsVersionSupported()` and `checkNextVersionSupport()` both passed in the local run. This is the check Next 14.2.35 failed in `#c59ba8e9`.
- **`compatibility_date`.** The adapter's check on it is informational only: warn if older than six months, otherwise log. `2026-08-04` logged as info, as seen locally. Note that with a compat date this recent, `nodejs_compat` is on by default anyway; it stays listed in `wrangler.jsonc` because the adapter's middleware bundler asserts on it and being explicit costs nothing.
- **`rclone.js`.** Declared as an *optional* peer (`peerDependenciesMeta.rclone.js.optional`) and not installed. Harmless now. It becomes relevant at the R2 step, since `populate-cache` is the consumer.

### The one knob that works on both platforms

`buildNextjsApp()` in `@opennextjs/aws` composes the inner build as:

```js
const command = config.buildCommand ?? (["bun","npm"].includes(packager) ? `${packager} run build` : `${packager} build`);
cp.execSync(command, { stdio: "inherit", cwd: path.dirname(options.appPackageJsonPath) });
```

So `buildCommand` in `open-next.config.ts` replaces the `npm run build` shell-out, and unlike a `$env:` variable set in one PowerShell session it is committed and therefore applies on Cloudflare's builder too. It is left unset deliberately — the default is correct and Turbopack is faster — but if the *Linux* build also runs out of memory, that is the place to put `next build --webpack`, not a dashboard tweak.

### Most likely next failure, if there is one

Worker size. OpenNext bundles all server code into one `worker.js`, and the limit is **3 MiB compressed on the free plan, 10 MiB on Workers Paid**. `three`, `@react-three/*` and `framer-motion` are client-only so they land in `.open-next/assets`, but `dicom-parser`, `nifti-reader-js` and `pngjs` are pulled in by `lib/dataset/image-render.ts`, which the study routes import on the server. `adm-zip` is already out of the graph (`scanner.ts` is reachable only from `scripts/`, and `/api/datasets` goes through `lib/dataset/counts.ts` instead). If the deploy is rejected for size, the fix is to check what the bundle actually contains before removing anything.

### Build `#5c4e246f` — built the wrong branch

The branch is pushed: `origin/cloudflare-next-upgrade` is at `c4b0ab6`, byte-identical to local `HEAD`, and carries `wrangler.jsonc`, `open-next.config.ts`, `lib/dataset/counts.ts`, both `app/api/datasets` routes and the lockfile with the adapter pinned.

`#5c4e246f` did not build it. It built **`main`**, which is still the initial commit: Next 14.2.35, no `@opennextjs/cloudflare`, no `wrangler.jsonc`, and **no `cf:build` script at all**. `npm run cf:build` there exits on "Missing script" — which is the whole 2-second Building phase. Installing passed (37 s) because `main`'s lockfile is valid; it just installs an app that has no adapter in it.

Two dashboard changes remain, both under Settings → Build:

1. **Branch control → Production branch:** `main` → `cloudflare-next-upgrade`. This is what makes the pushed work the thing that gets built, and it leaves `main` untouched until the deploy is green.
2. **Deploy command:** `npx wrangler deploy` → `npx opennextjs-cloudflare deploy`.

The build command `npm run cf:build` is already correct — on the branch that script is `opennextjs-cloudflare build`, resolved from `node_modules/.bin`, so it is equivalent to `npx opennextjs-cloudflare build`.

Do not skip step 1 by pushing the branch and leaving production on `main`. Commits to a non-production branch produce a **preview** build, and a preview build replaces the deploy command with a preview deploy command defaulting to `npx wrangler versions upload` — which delegates back into the adapter exactly the way bare `wrangler deploy` does. The adapter does have an `upload` command (`build`, `deploy`, `migrate`, `populate-cache`, `preview`, `skew-protection`, `upload`) if preview builds are wanted later.

### Build `#2d87983a` — the same root cause, one stage later

Also branch `main`. `npm run build` passed in 1m 7s (Next 14 builds fine), then `npx wrangler deploy` failed in 1m 30s with the original error verbatim: `escapedCommand: 'npx opennextjs-cloudflare build'`, `Next.js version : 14.2.35`, `ERROR ... is not supported`. That is `#c59ba8e9` again, and the reason is unchanged: **Cloudflare is building `main`, and `main` is the pre-upgrade initial commit.** Three failed builds, one cause.

Two repo changes were made so the deploy stops depending on getting dashboard fields exactly right.

**1. `main` fast-forwarded to the upgrade branch.** `origin/main` (`bf98f9c`) is a strict ancestor of the branch, so `git branch -f main cloudflare-next-upgrade` is a fast-forward: no merge commit, no conflicts, nothing on `main` lost. The earlier plan was to leave `main` alone until a deploy was green, but that precaution existed to protect a working production deploy and there has never been one — meanwhile the dashboard keeps building `main`. To undo: `git branch -f main bf98f9c` (and a force-push if it has already gone up).

**2. `wrangler.jsonc` now carries a `build.command`.** From wrangler 4.127.1's source, entrypoint resolution unconditionally calls `runCustomBuild(config.build)` before `deploy` / `versions upload` / `dev`, then asserts the entrypoint exists:

```js
async function runCustomBuild(expectedEntryAbsolute, expectedEntryRelative, build6, configPath, runOptions) {
  if (build6.command) {
    await runCommand(build6.command, build6.cwd, "[custom build]", runOptions);
    assertEntryPointExists(expectedEntryAbsolute, expectedEntryRelative, build6.command, configPath);
  } else { assertEntryPointExists(expectedEntryAbsolute, expectedEntryRelative); }
}
```

So `"build": { "command": "node scripts/cf-ensure-open-next.mjs" }` runs on every deploy no matter what the dashboard's own build command is. `scripts/cf-ensure-open-next.mjs` is idempotent — it skips when `.open-next/worker.js` already exists, so it costs nothing when the Building phase already ran `npm run cf:build`, and it builds when the Building phase only ran `npm run build`. `OPEN_NEXT_BUILD_COMMAND` overrides the command it runs, which is the hook to use from Cloudflare's Build variables if Turbopack ever needs replacing on the builder. Its four paths (skip / build / propagate a failing exit code / fail loudly when the command lies about success) were tested directly.

Also worth recording, since it retires an earlier worry: `npx wrangler deploy` is now safe. `getDetailsForAutoConfig()` returns `configured: true` as soon as a real wrangler config is found —

```js
if (target === "wrangler" && wranglerConfig?.configPath && !wranglerConfig.pages_build_output_dir) {
  return { configured: true, ... };
}
```

— and `maybeRunAutoConfig` only enters auto-config on `!details.configured`. Committing `wrangler.jsonc` is therefore what stops the delegation to `opennextjs-cloudflare build`, permanently. `npx opennextjs-cloudflare deploy` is still the better command (it also runs `populateCache`, which will matter once R2 is wired), but it is no longer required to avoid the recursion.

Net effect: with `main` pushed, the existing dashboard settings (`npm run build` + `npx wrangler deploy`) deploy successfully. Switching the build command to `npm run cf:build` is now an optimisation — it moves the OpenNext build out of the Deploying phase and avoids one redundant `next build`.

## How To Continue

1. Read this file top to bottom before touching anything.
2. Do a manual browser QA pass on `/studies/[id]?tab=analysis` for a CT or MRI study (multi-series, multi-slice) — this exercises series switching, slice navigation, cine, markers, measurements, and AI-finding jump-to all at once.
3. If persistence is requested next, look at `lib/mock-data.ts`'s stated integration boundary — markers/measurements should follow the same pattern as `onUpdateFinding` in `app/(portal)/studies/[id]/page.tsx` once there's a real backend.
4. Do not redo the marker/measurement lifting — it's complete and scoped correctly per series+slice.
5. Run `npx next build` after any further change before considering it done. (`npx next lint` no longer exists — Next 16 removed it. Use `npm run typecheck`.)
