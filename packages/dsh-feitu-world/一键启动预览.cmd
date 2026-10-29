@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview.ps1"
set "FEITU_EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%FEITU_EXIT_CODE%"=="0" echo Preview stopped with exit code %FEITU_EXIT_CODE%.
pause
exit /b %FEITU_EXIT_CODE%
