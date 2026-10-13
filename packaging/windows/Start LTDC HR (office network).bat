@echo off
title LTDC HR ^& Payroll (office network)
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
  echo.
  echo   The runtime folder is missing. Unzip the whole LTDC-HR folder again, then run this file.
  echo.
  pause
  exit /b 1
)
echo.
echo   Other computers on the same network can sign in at http://THIS-PC-IP:3000
echo   If Windows Firewall asks, allow access on Private networks only.
echo.
echo   This PC's IP address(es):
ipconfig | findstr /c:"IPv4"
echo.
set HOST=0.0.0.0
set OPEN_BROWSER=1
"%~dp0runtime\node.exe" server.js
echo.
echo   The app has stopped. You can close this window.
pause
