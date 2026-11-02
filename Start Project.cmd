@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 serve.py --open
  goto finish
)
where python >nul 2>nul
if not errorlevel 1 (
  python serve.py --open
  goto finish
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" serve.py --open
  goto finish
)
echo Python 3 is needed for USB mode. For simulation, open XO Dashboard.html directly.
:finish
if errorlevel 1 pause
