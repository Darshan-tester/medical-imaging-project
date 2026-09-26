@echo off
REM Build Meridian.exe for Windows.
REM Result: desktop\dist\Meridian\Meridian.exe
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller || goto :err
python -m PyInstaller meridian.spec --noconfirm || goto :err
echo.
echo Build complete: dist\Meridian\Meridian.exe
exit /b 0
:err
echo Build FAILED.
exit /b 1
