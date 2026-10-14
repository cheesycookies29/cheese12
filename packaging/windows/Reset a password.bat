@echo off
title LTDC ERP - reset a password
cd /d "%~dp0"
echo.
echo   Use this if an administrator is locked out.
echo   First close the LTDC ERP window so the app is not running.
echo.
set /p "RESET_USER=  Username: "
set /p "RESET_PASS=  New temporary password (8+ letters and numbers): "
echo.
"%~dp0runtime\node.exe" scripts\reset-password.js "%RESET_USER%" "%RESET_PASS%"
echo.
pause
