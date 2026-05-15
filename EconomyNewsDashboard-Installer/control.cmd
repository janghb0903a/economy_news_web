@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set "APPDIR=%~dp0EconomyNewsDashboard"
set "ELECTRON=%APPDIR%\control-ui\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" if exist "%APPDIR%\control-ui\electron-bin\electron.exe.part001" (
  "%APPDIR%\runtime\python\python.exe" "%APPDIR%\tools\restore_electron.py"
)
if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%APPDIR%\control-ui"
) else (
  start "" "%APPDIR%\runtime\python\pythonw.exe" "%APPDIR%\tools\control.py" gui
)
endlocal
