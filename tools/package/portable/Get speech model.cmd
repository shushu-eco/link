@echo off
rem Gets the speech model Link writes captions with (466 MB) and puts it where Link looks for it.
rem Run it again if it was cut off: it goes on from where it stopped.
setlocal
cd /d "%~dp0"
set "DIR=tools\reels\models"
set "FILE=%DIR%\ggml-small.bin"
set "URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
set "SHA=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"
if exist "%FILE%" (
  echo The speech model is here already.
  if not "%~1"=="quiet" pause
  exit /b 0
)
if not exist "%DIR%" mkdir "%DIR%"
echo Getting Link's speech model: 466 MB, once.
echo.
curl.exe -L --fail --retry 3 -C - -o "%FILE%.part" "%URL%"
if errorlevel 1 (
  echo.
  echo The speech model could not be downloaded. Check the internet connection and run this again.
  pause
  exit /b 1
)
set "GOT="
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "%FILE%.part" SHA256') do if not defined GOT set "GOT=%%h"
set "GOT=%GOT: =%"
if /i not "%GOT%"=="%SHA%" (
  del "%FILE%.part"
  echo.
  echo The file that arrived is not the speech model: it was thrown away. Run this again.
  pause
  exit /b 1
)
move /y "%FILE%.part" "%FILE%" >nul
echo.
echo The speech model is in place.
if not "%~1"=="quiet" pause
exit /b 0
