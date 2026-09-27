@echo off
rem One-time installation on this PC. See scripts\setup.ps1 and README-INSTALL.txt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
echo.
pause
