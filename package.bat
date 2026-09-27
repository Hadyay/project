@echo off
rem Makes dist\RealEstateERP-<date>.zip to carry to another PC. See scripts\package.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package.ps1" %*
echo.
pause
