#Requires -Version 5.1
<#
.SYNOPSIS
  CI-friendly bridge lifecycle wrapper: cold-start the vw-runtime-api bridge,
  gate on /health, and emit the rotated token for the test job to consume.

.DESCRIPTION
  Wraps Start-VWRuntimeApi.ps1 (from $env:VW_RUNTIME_API_HOME) with a health
  poll + token capture. Prints `VW_BRIDGE_TOKEN=<token>` on success so a CI step
  can append it to $GITHUB_ENV. See architecture §9.2 / §9.5.

.EXAMPLE
  ./bridge-lifecycle.ps1 -KillExisting
#>
[CmdletBinding()]
param(
  [string]$BridgeUrl = 'http://127.0.0.1:9876',
  [int]$HealthTimeoutSec = 90,
  [switch]$KillExisting
)

$ErrorActionPreference = 'Stop'

$apiHome = $env:VW_RUNTIME_API_HOME
if ([string]::IsNullOrWhiteSpace($apiHome)) {
  throw 'VW_RUNTIME_API_HOME is not set. Point it at the vw-runtime-api checkout.'
}

$starter = Join-Path $apiHome 'scripts\Start-VWRuntimeApi.ps1'
if (-not (Test-Path -LiteralPath $starter)) {
  throw "Start-VWRuntimeApi.ps1 not found at $starter"
}

Write-Host "Cold-starting bridge via $starter (Parcel mode)..."
$startArgs = @('-Mode', 'Parcel')
if ($KillExisting) { $startArgs += '-KillExisting' }
& $starter @startArgs

Write-Host "Polling $BridgeUrl/health (up to $HealthTimeoutSec s)..."
$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  $body = & curl.exe -s "$BridgeUrl/health" 2>$null
  if ($body -match '"status":"ok"') { $healthy = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $healthy) {
  throw "Bridge did not become healthy within $HealthTimeoutSec seconds."
}

$tokenPath = Join-Path $env:LOCALAPPDATA 'Enviro365\vw-runtime-api\token'
if (-not (Test-Path -LiteralPath $tokenPath)) {
  throw "Token file not found at $tokenPath after cold-start."
}
$token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()

Write-Host 'Bridge healthy.'
Write-Output "VW_BRIDGE_TOKEN=$token"
