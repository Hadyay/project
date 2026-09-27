@echo off
rem Stops the system. See scripts\stop.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
rem A short pause so the message can be read (ping works where timeout cannot).
ping -n 3 127.0.0.1 >nul
