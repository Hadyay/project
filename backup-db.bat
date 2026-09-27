@echo off
rem Dumps the database to db_backup\ for moving to another PC. See scripts\backup-db.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-db.ps1" %*
pause
