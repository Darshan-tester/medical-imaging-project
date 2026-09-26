# Meridian Desktop — Medical Imaging Workstation

A native desktop application (Windows + macOS) built on PySide6/Qt + VTK that
reuses the existing Meridian dataset architecture. It reads the SAME
`.scanlab/manifest.json` the web app produces, so the real image/report
pairing, series structure, slice ordering metadata and verbatim reports are
consumed as-is — nothing is re-derived, and no fake data exists.

## Run (development)

```
cd desktop
python -m venv .venv
.venv\Scripts\activate            (Windows)   |   source .venv/bin/activate  (macOS)
pip install -r requirements.txt
run-dev.bat                        (Windows)   |   ./run-dev.sh               (macOS)
```

Dataset configuration: the app finds `.scanlab/manifest.json` next to your
dataset root (`SCANLAB_DATA_ROOT`, e.g. `D:\ScanLab_Datasets`) or walks up from
its own location. Point Settings at either location; no path is ever exposed in
rendered image data.

## Build

Windows `.exe`:  `build-windows.bat`  →  `dist\Meridian\Meridian.exe`
macOS `.app`:    `./build-macos.sh`   →  `dist\Meridian.app`

PyInstaller onedir layout; end users need no Python/Node tooling installed.

## Architecture

```
desktop/meridian_desktop/
  config.py            settings persistence (data root, window state)
  app.py               entry point, logging (~/.meridian/logs/meridian.log)
  dataset/manifest.py  DatasetStudy/Series/ImageRef/DicomVolume model,
                       study search/filter — reads .scanlab/manifest.json
  dataset/imageloader.py  slice decoders (DICOM/NIfTI/raster), correct-order
                       volume builders (ImagePositionPatient-ordered stack or
                       NIfTI affine), SliceCache (LRU), VolumeCache, SliceLoader
                       (thread pool + neighbour prefetch, never blocks GUI)
  dataset/volumes.py   background volume service with caching
  dataset/annotations.py  voxel-coordinate annotation model, JSON persistence
                       per study, plane<->voxel projection, mm measurements
  viewer/sliceview.py  2-D slice widget: WW/WL, invert, zoom/pan/fit,
                       crosshair overlay, annotation overlay, spacing-correct
                       aspect (no stretched anatomy)
  viewer/vtk3d.py      GPU volume rendering, CT presets (Bone/Soft Tissue/Lung),
                       MRI Color intensity-based false-colour transfer function,
                       Tissue/High Contrast presets, shading, AA, camera ops
  ui/main_window.py    workstation shell: study list + search + modality filter,
                       toolbar (W/L, pan, zoom, measure, line, arrow, rect,
                       ellipse, freehand, text, invert, reset), layouts
                       1x1 / 1x2 / 2x2, view sync, report/AI-findings/annotation
                       tabs, radiologist disclaimer
```

Key behaviours:

- Correct ordering: slice order always comes from the manifest (ordered at
  index time by ImagePositionPatient / InstanceNumber), never from filesystem
  enumeration. Corrupt DICOM instances are skipped with a log entry.
- Latency: visible slice loads first; adjacent slices prefetch in background;
  decoded slices and built volumes are LRU-cached; the GUI thread never decodes.
- MPR: the volume is resliced per plane with true voxel spacing; crosshair
  position is shared across planes (click in one plane updates the others);
  wheel scrolls the crosshair along each plane's own axis.
- Sync: WW/WL changes propagate across all panels when Sync Views is ON.
- 3D: native-resolution VTK GPU volume rendering with progressive sampling
  (VTK auto-adjusts sample distance during interaction and refines when idle);
  MRI Color is explicitly a false-colour visualization driven by actual
  intensity percentiles.
- Annotations: stored in voxel coordinates, projected into every plane and
  available for 3D highlighting; persisted per study under the app config dir.

## Known limitations

- 3D panel requires VTK (`pip install vtk`); without it the 2-D/MPR viewer
  still works fully and a clear message is shown.
- Annotation 3D visualization currently marks the annotated voxel region via
  the shared voxel coordinate store; full 3D contour extraction is a
  follow-up.
- DICOM multiframe and exotic transfer syntaxes follow pydicom's supported
  set; corrupted files are skipped rather than crashing the app.
- macOS build should be produced on a Mac (cross-compiling from Windows is not
  supported by PyInstaller); the codebase itself is fully cross-platform.

## Testing checklist

1. Launch app → study list appears quickly; search and modality filter work.
2. Open a CT study → first slice renders without blocking; wheel navigates in
   acquisition/spatial order.
3. WW/WL drag updates image in real time; presets via drag; Invert works;
   Reset restores fit + auto window.
4. Switch layout to 2×2 → Axial/Coronal/Sagittal/3D panels appear.
5. Double-click in axial → crosshair updates in coronal and sagittal at the
   same anatomy; wheel in coronal scrolls along y only.
6. Sync Views OFF → WW/WL changes affect only the active panel.
7. Measure a structure → mm value matches physical spacing (unstretched).
8. Draw line/rect/ellipse/freehand/arrow/text → persists after restart.
9. 3D panel → rotate/zoom/pan; switch preset Grayscale ↔ MRI Color ↔ Bone;
   reset camera.
10. Open an MRI study → MRI Color preset shows intensity-based colouring.
11. Open an X-Ray study → single image renders; report pane shows verbatim text.
12. Verify report pane matches the study's real report and shows the
    radiologist disclaimer.
