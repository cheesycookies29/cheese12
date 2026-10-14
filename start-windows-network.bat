@echo off
title LTDC ERP (office network)
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

rem Lets other computers on the same network sign in at http://THIS-PC-IP:3000
rem If Windows Firewall asks, allow access on Private networks only.
echo.
echo   This computer's IP address(es) on the network:
ipconfig | findstr /c:"IPv4"
set HOST=0.0.0.0
set OPEN_BROWSER=1
node server.js
pause
