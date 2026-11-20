# 数据库热备份（Windows），默认保留 7 天
# 用法: powershell -File deploy\backup.ps1 [-DbFile ...] [-DestDir ...] [-KeepDays 7]
# 建议计划任务：每天 02:00 执行
param(
  [string]$DbFile = (Join-Path $PSScriptRoot '..\mesmonitor.db'),
  [string]$DestDir = (Join-Path $PSScriptRoot '..\backup'),
  [int]$KeepDays = 7
)

$ErrorActionPreference = 'Stop'
$DbFile = [System.IO.Path]::GetFullPath($DbFile)
$DestDir = [System.IO.Path]::GetFullPath($DestDir)

if (-not (Test-Path $DbFile)) {
  Write-Error "数据库不存在: $DbFile"
  exit 1
}
if (-not (Test-Path $DestDir)) {
  New-Item -ItemType Directory -Path $DestDir | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$target = Join-Path $DestDir "mesmonitor_$stamp.db"

Push-Location (Join-Path $PSScriptRoot '..')
try {
  node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});db.backup(process.argv[2]).then(()=>{db.close();console.log('ok');}).catch(e=>{console.error(e);process.exit(1);});" $DbFile $target
  if ($LASTEXITCODE -ne 0) { throw '备份失败' }
} finally {
  Pop-Location
}

Write-Output "备份完成: $target"

Get-ChildItem -Path $DestDir -Filter 'mesmonitor_*.db' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  ForEach-Object { Remove-Item $_.FullName -Force; Write-Output "已清理过期备份: $($_.Name)" }
