@echo off
title LTDC HR ^& Payroll
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo.
  echo   The runtime folder is missing. Unzip the whole LTDC-HR folder again, then run this file.
  echo.
  pause
  exit /b 1
)
echo.
echo   Starting LTDC HR ^& Payroll. Your browser will open in a moment.
echo   Keep this window open while you use the app. Close it to stop the app.
set OPEN_BROWSER=1
"%~dp0runtime\node.exe" server.js
echo.
echo   The app has stopped. You can close this window.
pause
