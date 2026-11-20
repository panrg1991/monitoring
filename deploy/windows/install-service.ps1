<#
.SYNOPSIS
    Register the MES Monitor API (server.js) as a Windows service with NSSM.

.DESCRIPTION
    Run this script in an elevated PowerShell (Run as Administrator).
    NSSM is required: https://nssm.cc/download  (or: winget install NSSM.NSSM)

    The service keeps `node server.js` running in the project directory so that the
    statistics job (stats_job.js) can call http://127.0.0.1:<Port>/api/stats/rebuild.

.PARAMETER AppDir
    Project root. Defaults to two folders above this script (deploy\windows -> project root).

.PARAMETER NodeExe
    Full path to node.exe. Defaults to `node.exe` found in PATH.

.PARAMETER Port
    HTTP port of server.js (default 3456). Must match the port used by stats_job.js.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$AppDir = '',
    [string]$NodeExe = '',
    [string]$ServiceName = 'MESMonitor',
    [int]$Port = 3456,
    [switch]$Force,
    [switch]$Uninstall,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------- helpers ----------
function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

$script:Nssm = $null
function Invoke-Nssm {
    param([string[]]$Arguments)
    Write-Host ("    nssm " + ($Arguments -join ' '))
    if ($DryRun) { return }
    & $script:Nssm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "nssm failed with exit code $LASTEXITCODE" }
}

# ---------- checks ----------
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run PowerShell as Administrator.'
}

if (-not $AppDir) {
    $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
if (-not (Test-Path $AppDir)) { throw "Project directory not found: $AppDir" }
$AppDir = (Resolve-Path $AppDir).Path
if (-not (Test-Path (Join-Path $AppDir 'server.js'))) {
    throw "server.js not found in $AppDir"
}

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

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

# ---------- uninstall ----------
if ($Uninstall) {
    if (-not $existing) {
        Write-Step "Service $ServiceName does not exist, nothing to remove."
        return
    }
    Write-Step "Removing service $ServiceName"
    Invoke-Nssm @('stop', $ServiceName)
    Invoke-Nssm @('remove', $ServiceName, 'confirm')
    Write-Host "Service removed. Project files and mesmonitor.db were kept."
    return
}

$nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
if ($nssmCmd) {
    $script:Nssm = $nssmCmd.Source
} elseif ($DryRun) {
    $script:Nssm = 'nssm'
    Write-Warning 'nssm.exe not found; DryRun only prints the commands that would be executed.'
} else {
    throw 'nssm.exe not found. Download from https://nssm.cc/download or run: winget install NSSM.NSSM, then reopen PowerShell.'
}

if ($existing) {
    if (-not $Force) {
        throw "Service $ServiceName already exists. Use -Force to reinstall or -Uninstall to remove it."
    }
    Write-Step "Reinstalling existing service $ServiceName"
    Invoke-Nssm @('stop', $ServiceName)
    Invoke-Nssm @('remove', $ServiceName, 'confirm')
}

# ---------- install ----------
$logDir = Join-Path $AppDir 'logs'
if (-not (Test-Path $logDir) -and -not $DryRun) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

Write-Step "Registering service $ServiceName"
Invoke-Nssm @('install', $ServiceName, $NodeExe, 'server.js')
Invoke-Nssm @('set', $ServiceName, 'AppDirectory', $AppDir)
Invoke-Nssm @('set', $ServiceName, 'AppEnvironmentExtra', 'NODE_ENV=production', "PORT=$Port")
Invoke-Nssm @('set', $ServiceName, 'AppStdout', (Join-Path $logDir 'service.out.log'))
Invoke-Nssm @('set', $ServiceName, 'AppStderr', (Join-Path $logDir 'service.err.log'))
Invoke-Nssm @('set', $ServiceName, 'AppRotateFiles', '1')
Invoke-Nssm @('set', $ServiceName, 'AppRotateOnline', '1')
Invoke-Nssm @('set', $ServiceName, 'AppRotateBytes', '10485760')
Invoke-Nssm @('set', $ServiceName, 'AppStopMethodConsole', '15000')
Invoke-Nssm @('set', $ServiceName, 'Start', 'SERVICE_AUTO_START')
Invoke-Nssm @('start', $ServiceName)

if ($DryRun) {
    Write-Host ''
    Write-Host 'DryRun finished, no changes were made.' -ForegroundColor Yellow
    return
}

Write-Step 'Verifying service state'
$svc = Get-Service -Name $ServiceName
Write-Host ("    Status: " + $svc.Status)
Start-Sleep -Seconds 2
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
    Write-Host ("    HTTP check: " + $resp.StatusCode + " http://127.0.0.1:$Port/")
} catch {
    Write-Warning "HTTP check failed: $($_.Exception.Message). See $logDir\service.err.log"
}

Write-Host ''
Write-Host "Service installed: $ServiceName"
Write-Host "  AppDir   : $AppDir"
Write-Host "  Node     : $NodeExe"
Write-Host "  Port     : $Port"
Write-Host "  Logs     : $logDir\service.out.log / service.err.log"
Write-Host "  Manage   : nssm restart $ServiceName"
Write-Host "  Note     : set the system time zone to China Standard Time (UTC+8)."
