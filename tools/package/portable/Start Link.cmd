@echo off
rem Starts Link from this folder. The first time it gets the speech model (466 MB): Link needs it for captions.
setlocal
cd /d "%~dp0"
if not exist "tools\reels\models\ggml-small.bin" call "%~dp0Get speech model.cmd" quiet
if not exist "tools\reels\models\ggml-small.bin" (
  echo.
  echo Link was not started: it needs its speech model. Run "Get speech model" and then this again.
  pause
  exit /b 1
)
start "" "%~dp0runtime\python\pythonw.exe" "%~dp0tools\reels\link.pyw"
