@echo off
rem Opens the Updater: which version this Link is, which is the newest, and a button that brings it up to date.
cd /d "%~dp0"
start "" "%~dp0tools\reels\shell\node_modules\electron\dist\electron.exe" "%~dp0tools\reels\updater"
