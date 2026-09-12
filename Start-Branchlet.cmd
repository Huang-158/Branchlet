@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
set "BRANCHLET_EXIT=%ERRORLEVEL%"
if not "%BRANCHLET_EXIT%"=="0" pause
exit /b %BRANCHLET_EXIT%
