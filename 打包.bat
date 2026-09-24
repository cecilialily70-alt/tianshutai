@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ============================================================
rem  TianShuTai Windows packaging launcher
rem  Keep this file ASCII-only: cmd.exe mis-parses multi-byte
rem  text in .bat files. All Chinese UI + build logic live in
rem  build\package.js
rem ============================================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found on this computer.
  echo   Please install Node.js 18 or newer first: https://nodejs.org/zh-cn
  echo.
  pause
  exit /b 1
)

node "build\package.js"
set "EXITCODE=%errorlevel%"

echo.
pause
exit /b %EXITCODE%
