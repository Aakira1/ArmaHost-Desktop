@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Arma 3 Local Host Tests
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or newer first. Node.js 24 LTS is recommended.
  pause
  exit /b 1
)
node --test tests/*.test.mjs
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (echo All automated tests passed.) else (echo Tests failed. Read the output above.)
pause
exit /b %RESULT%
