@echo off
setlocal
cd /d "%~dp0"
"%~dp0..\runtime\python\python.exe" "%~dp0..\tools\control.py" open
endlocal
