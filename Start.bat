@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\electron\package.json (
  echo Installing desktop dependencies...
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)
call npm.cmd start
