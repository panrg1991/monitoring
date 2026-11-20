<#
.SYNOPSIS
    Register the MES Monitor statistics job (stats_job.js) as a Windows scheduled task.

.DESCRIPTION
    Run this script in an elevated PowerShell (Run as Administrator).
    The task runs `node stats_job.js` and relies on the API service
    (see install-service.ps1) being online; otherwise the run is logged as failed
    in stats_job.log and the next run retries.

    Default schedule: every day at 00:10, recalculating yesterday + today.
    Use -RepeatHours 2 for an hourly-style recalculation.

.PARAMETER AppDir
    Project root. Defaults to two folders above this script.

.PARAMETER All
    Rebuild ALL statistics from process_data on every run (clears production_stats first).
    Usually you only need this once after the initial deployment:
      .\install-task.ps1 -All -RunOnce

.PARAMETER RunOnce
    Create a one-off task (fires at -StartTime today) instead of a recurring one.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File .\install-task.ps1
    powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -RepeatHours 2
    powershell -ExecutionPolicy Bypass -File .\install-task.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$AppDir = '',
    [string]$NodeExe = '',
    [string]$TaskName = 'MES-Stats-Job',
    [string]$StartTime = '00:10',
    [int]$RepeatHours = 0,
    [int]$Port = 3456,
    [switch]$All,
    [switch]$RunOnce,
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

# ---------- checks ----------
$principalCheck = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run PowerShell as Administrator.'
}

if (-not $AppDir) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
if (-not (Test-Path $AppDir)) { throw "Project directory not found: $AppDir" }
$AppDir = (Resolve-Path $AppDir).Path

$jobPath = Join-Path $AppDir 'stats_job.js'
if (-not (Test-Path $jobPath)) { throw "stats_job.js not found: $jobPath" }

if (-not $NodeExe) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'node.exe not found. Install Node.js 18+ or pass -NodeExe.' }
    $NodeExe = $cmd.Source
}
if (-not (Test-Path $NodeExe)) { throw "node.exe not found: $NodeExe" }

$nodeVersion = (& $NodeExe -v) -replace '^v', ''
if ([int]($nodeVersion.Split('.')[0]) -lt 18) {
    throw "Node.js 18+ is required (found $nodeVersion)."
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# ---------- uninstall ----------
if ($Uninstall) {
    if (-not $existing) {
        Write-Step "Task $TaskName does not exist, nothing to remove."
        return
    }
    Write-Step "Removing scheduled task $TaskName"
    if (-not $DryRun) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    Write-Host "Scheduled task removed."
    return
}

# ---------- build action ----------
$argument = '"' + $jobPath + '"'
if ($All) { $argument += ' --all' }
if ($Port -ne 3456) { $argument += " --port $Port" }

Write-Host "Task     : $TaskName"
Write-Host "Node     : $NodeExe"
Write-Host "Argument : $argument"
Write-Host "WorkDir  : $AppDir"

if ($DryRun) {
    Write-Host ''
    Write-Host 'DryRun finished, no changes were made.' -ForegroundColor Yellow
    return
}

# ---------- trigger / settings / principal ----------
$startAt = [datetime]::Today.Add([timespan]::Parse($StartTime))
if ($RunOnce) {
    $trigger = New-ScheduledTaskTrigger -Once -At $startAt
} elseif ($RepeatHours -gt 0) {
    $trigger = New-ScheduledTaskTrigger -Once -At $startAt `
        -RepetitionInterval (New-TimeSpan -Hours $RepeatHours)
} else {
    $trigger = New-ScheduledTaskTrigger -Daily -At $startAt
}

$action = New-ScheduledTaskAction -Execute $NodeExe -Argument $argument -WorkingDirectory $AppDir

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Write-Step "Registering scheduled task $TaskName"
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName

Write-Host ''
Write-Host "Scheduled task installed: $TaskName (State: $($task.State))"
Write-Host "  Next run : $($info.NextRunTime)"
Write-Host "  Log      : $AppDir\stats_job.log"
Write-Host "  Run now  : schtasks /run /tn `"$TaskName`""
Write-Host "  Note     : set the system time zone to China Standard Time (UTC+8)."
