# Vedh / Meridian Medical Imaging — Desktop Application

A local, offline desktop viewer for the delivered study dataset: a study list
over a SQLite index, a diagnostic viewer with axial / coronal / sagittal MPR,
GPU-accelerated 3-D volume rendering, linked navigation with crosshairs,
window/level controls, and world-coordinate annotations that stay aligned in
2-D and 3-D.

Patient scan data stays on this machine. The application has no network access,
performs no uploads, and collects no telemetry.

## Stack

Python 3.10+, PySide6 (Qt 6), NumPy. The imaging core (`desktop/core/imaging/`)
is pure NumPy and headless-testable; the Qt layer (`desktop/ui/`) only paints
what core produces and never decodes on the UI thread.

## Running from source

```bash
cd desktop
python -m pip install PySide6 numpy
# the delivered folder must contain dataset/ and index/studies.db beside
# desktop/ (or set MERIDIAN_DESKTOP_HOME to point at it)
python main.py
```

## Layout & controls

| Action | Control |
|---|---|
| Layout: 1 / 2 / 4 panes | Layout selector in the viewer top bar, or press `M` |
| Per-pane view | Right-click a pane's label, or pick from the pane's view combo |
| Maximize a pane | Double-click the pane; `Esc` restores |
| Active pane | Highlighted border; click a pane to activate |
| Linked navigation | On by default; `L` toggles. Clicking in any plane moves the others |
| Crosshairs | `C` toggles |
| Window / level | Sliders + numeric inputs in the right rail, presets, "Reset window/level" |
| 3-D color presets | Preset combo above the 3-D pane. Grayscale = measured intensity; everything else is labeled **pseudocolor** (MRI intensities have no true tissue colors) |
| 3-D interaction | Drag = rotate, wheel = zoom, right-drag = pan, double-click = reset camera |

## Building installers

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File desktop\build\build_windows.ps1
```

Produces `desktop\dist\VedhMedicalImaging\` (folder with `VedhMedicalImaging.exe`).
With Inno Setup 6 installed, an installer is also produced. Copy your
`dataset\` and `index\` folders next to the exe to deliver.

### macOS

```bash
bash desktop/build/build_macos.sh
```

Produces `desktop/dist/VedhMedicalImaging.app`.

### Signing and notarization (honest status)

No signing credentials are available in this environment, so **builds produced
by these scripts are unsigned** and this is stated on screen by the scripts.

* Windows: SmartScreen will warn on first run until you sign with `signtool`
  and an EV/OV code-signing certificate (`SIGNTOOL_PFX` /
  `SIGNTOOL_PASSWORD` environment variables are honored by the script).
* macOS: Gatekeeper will block an unsigned app; users must right-click → Open
  on first launch. To distribute normally, sign with `codesign --deep --force
  --options runtime --sign "Developer ID Application: …"` and notarize with
  `xcrun notarytool submit` then `xcrun stapler staple` (commands are printed
  in `build_macos.sh`).

## Tests

```bash
cd desktop
python tests/run_tests.py        # zero-dependency runner (numpy only)
python -m pytest tests -q        # or pytest where available
```

Covers: plane-pick round trips across all MPR planes, cross-plane consistency,
world↔voxel transforms (exact values on a known affine), degenerate-affine
safety, transfer-function identity/pseudocolor behavior, opacity thresholds,
volume downsampling, and annotation persistence round trips.

## Known limitations

* macOS/Windows installers were **not** built or executed in the development
  environment (no Qt runtime, no GPU, and no Windows/macOS host available);
  the scripts have not been run end-to-end there. Run them on the target OS.
* Unsigned builds: see above; nothing here claims certification.
* 3-D rendering requires OpenGL 3.3; on machines without it the pane shows an
  error rather than a software fallback.
* Pen-stroke annotations draw on their original slice plane in 3-D; they are
  not volumetric objects.
