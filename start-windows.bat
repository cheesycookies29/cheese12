@echo off
title LTDC HR ^& Payroll
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS version from https://nodejs.org, install it, then run this file again.
  echo.
  pause
  exit /b 1
)

rem Opens the app in your browser once it has started. Close this window to stop the app.
set OPEN_BROWSER=1
node server.js
pause
