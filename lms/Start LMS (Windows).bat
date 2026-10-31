@echo off
title LTDC LMS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting LTDC LMS. Your browser will open in a moment.
echo   Keep this window open while you use the LMS. Close it to stop the LMS.
rem Opens the admin panel in your browser once the LMS has started.
set OPEN_BROWSER=1
node server.js
echo.
echo   The LMS has stopped. You can close this window.
pause
