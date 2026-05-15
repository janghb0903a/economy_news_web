@echo off
setlocal
cd /d "%~dp0"
start "" "%~dp0..\runtime\python\pythonw.exe" "%~dp0..\tools\control.py" install-ui
endlocal
