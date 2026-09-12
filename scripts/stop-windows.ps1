$ErrorActionPreference = 'Stop'
$branchletRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$branchletData = if ($env:BRANCHLET_DATA_DIR) { [IO.Path]::GetFullPath($env:BRANCHLET_DATA_DIR) } else { Join-Path $branchletRoot '.branchlet' }
$branchletRecord = Join-Path $branchletData 'server-process.json'
if (-not (Test-Path -LiteralPath $branchletRecord)) { Write-Host 'No launcher-managed Branchlet instance was found.'; exit 0 }
try {
  $instance = Get-Content -LiteralPath $branchletRecord -Raw | ConvertFrom-Json
  $branchletPid = [int]$instance.pid
  $branchletProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $branchletPid"
  if (-not $branchletProcess) { Write-Host 'Branchlet is already stopped.'; exit 0 }
  $expectedServer = Join-Path $branchletRoot 'app\server.cjs'
  $actualProcess = Get-Process -Id $branchletPid
  if ($instance.server -ne $expectedServer -or $branchletProcess.ExecutablePath -ne $instance.node -or -not $branchletProcess.CommandLine.Contains($expectedServer) -or [Math]::Abs(($actualProcess.StartTime.ToUniversalTime() - ([DateTime]$instance.started).ToUniversalTime()).TotalSeconds) -gt 2) { throw 'Process identity differs from the saved instance. No process was stopped.' }
  Stop-Process -Id $branchletPid
  Remove-Item -LiteralPath $branchletRecord
  Write-Host 'Branchlet stopped. Your repositories and data are preserved.'
} catch { Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red; exit 1 }
