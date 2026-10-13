@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = [Environment]::GetFolderPath('Desktop'); $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'LTDC HR and Payroll.lnk')); $s.TargetPath = (Join-Path '%~dp0' 'Start LTDC HR.bat'); $s.WorkingDirectory = '%~dp0'; $s.IconLocation = (Join-Path '%~dp0' 'app.ico'); $s.Description = 'Start LTDC HR and Payroll'; $s.Save()"
if errorlevel 1 (
  echo   Could not create the shortcut. You can still start the app with "Start LTDC HR.bat".
) else (
  echo   A shortcut "LTDC HR and Payroll" was added to your desktop.
)
pause
