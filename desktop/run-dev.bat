@echo off
REM Run the Meridian desktop app in development mode.
REM Requires: Python 3.10+ and `pip install -r requirements.txt`
REM Dataset: SCANLAB_DATA_ROOT env var or a previously built .scanlab/manifest.json
cd /d "%~dp0"
python -m meridian_desktop
