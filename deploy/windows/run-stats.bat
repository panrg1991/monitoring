@echo off
rem ============================================================
rem  MES Monitor - production stats job wrapper
rem  Calls stats_job.js which posts to the local API service:
rem    POST http://127.0.0.1:3456/api/stats/rebuild
rem
rem  Usage:
rem    run-stats.bat                  rem today + yesterday
rem    run-stats.bat --all            rem full rebuild from process_data
rem    run-stats.bat --days 7
rem    run-stats.bat --date 2026-11-17
rem
rem  Optional:
rem    set "NODE_EXE=C:\Program Files\nodejs\node.exe"  rem if node is not in PATH
rem ============================================================
setlocal

set "APP_DIR=%~dp0..\.."
set "JOB_FILE=%APP_DIR%\stats_job.js"

if defined NODE_EXE (
  set "NODE_CMD=%NODE_EXE%"
) else (
  set "NODE_CMD=node"
)

if not exist "%JOB_FILE%" (
  echo [run-stats] stats_job.js not found: %JOB_FILE%
  exit /b 1
)

pushd "%APP_DIR%"
"%NODE_CMD%" "%JOB_FILE%" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
