#!/usr/bin/env bash
# Build Meridian.app for macOS (Apple Silicon or Intel — matches the running Python).
# Result: desktop/dist/Meridian.app
set -e
cd "$(dirname "$0")"
python3 -m pip install --upgrade pyinstaller
python3 -m PyInstaller meridian.spec --noconfirm
# Bundle as .app: rerun with windowed app bundle mode
python3 -m PyInstaller --windowed --name Meridian --noconfirm \
  --hidden-import pydicom --hidden-import nibabel --collect-submodules vtk \
  launcher.py
echo "Build complete: dist/Meridian.app"
