@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'LTDC ERP.lnk')); $s.TargetPath = (Join-Path '%~dp0' 'Start LTDC ERP.bat'); $s.WorkingDirectory = '%~dp0'; $s.IconLocation = (Join-Path '%~dp0' 'app.ico'); $s.Description = 'Start LTDC ERP'; $s.Save()"
if errorlevel 1 (
  echo   Could not create the shortcut. You can still start the app with "Start LTDC ERP.bat".
) else (
  echo   A shortcut "LTDC ERP" was added to your desktop.
)
pause
