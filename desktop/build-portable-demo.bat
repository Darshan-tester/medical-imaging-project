@echo off
REM ============================================================================
REM Build the portable Vedh Medical Imaging demo bundle.
REM
REM One command on the developer machine:
REM
REM     desktop\build-portable-demo.bat
REM
REM Produces, ready to ZIP and hand to anyone (no Python, no Node, no
REM browser, no Cloudflare, no D:\ScanLab_Datasets needed on the target PC):
REM
REM     desktop\dist\VedhMedicalImaging\
REM       VedhMedicalImaging.exe    <- presenter double-clicks this
REM       _internal\ ...           <- packaged Python/Qt runtime (PyInstaller)
REM       demo-data\manifest.json   <- study/report index, RELATIVE paths
REM       demo-data\pet\ ...         <- real PET NIfTI volumes
REM       demo-data\mri\ ...        <- real MRI volumes (extracted from zips)
REM       demo-data\ct\ ...          <- real CT DICOM instances
REM       demo-data\chest-xray\ ... <- real X-ray images
REM
REM ORDER MATTERS: PyInstaller --noconfirm deletes dist\<name> before writing,
REM so the exe is built FIRST and the demo data is assembled into the finished
REM folder SECOND.
REM
REM Exit codes: 0 ok, 1 failure (message printed).
REM ============================================================================
setlocal
cd /d "%~dp0"

echo == 1/3: Packaging the application (PyInstaller) ==========================
python -m pip install --quiet --upgrade pyinstaller || goto :err
set MERIDIAN_EXE_NAME=VedhMedicalImaging
python -m PyInstaller meridian.spec --noconfirm || goto :err
if not exist dist\VedhMedicalImaging\VedhMedicalImaging.exe goto :err

echo.
echo == 2/3: Assembling demo data (from public\demo-data) =====================
python build_demo_bundle.py --out dist\VedhMedicalImaging
if errorlevel 1 goto :err

echo.
echo == 3/3: Done ==============================================================
echo.
echo Portable bundle: %CD%\dist\VedhMedicalImaging\
echo Zip the folder and share it. To run: double-click VedhMedicalImaging.exe
echo (Windows SmartScreen may warn on first launch - click "More info" then
echo  "Run anyway". That is normal for unsigned demo builds.)
exit /b 0

:err
echo.
echo Build FAILED. See the messages above.
exit /b 1