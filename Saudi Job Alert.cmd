@echo off
rem Double-click to watch the laptop worker live (and start it if needed).
rem Closing the window does not stop the worker.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\laptop\control.ps1"
if errorlevel 1 pause
