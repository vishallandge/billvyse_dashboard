@echo off
title BillVyse Print Bridge
cd /d "%~dp0"
rem The zip carries its own node.exe; a machine with Node installed can also run it directly.
if exist "billvyse-print-bridge.exe" (
  "billvyse-print-bridge.exe"
) else if exist "node.exe" (
  "node.exe" bridge.js
) else (
  node bridge.js
)
pause
