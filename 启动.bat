@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [Main] 未检测到 Node.js，请先安装后再启动。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [Main] 首次启动，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [Main] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo [Main] 正在启动天枢台...
call npm run dev
if errorlevel 1 (
  echo [Main] 启动失败。
  pause
)
