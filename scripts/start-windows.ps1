param([switch]$NoBrowser, [switch]$Foreground, [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$branchletRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $branchletRoot
$branchletProcess = $null
$startupTracked = $false
try {
  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
  if (-not $gitCommand) {
    $gitCandidates = @((Join-Path $env:ProgramFiles 'Git\cmd\git.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe'))
    foreach ($gitCandidate in $gitCandidates) {
      if (Test-Path -LiteralPath $gitCandidate) { $env:PATH = (Split-Path -Parent $gitCandidate) + ';' + $env:PATH; $gitCommand = Get-Command git.exe; break }
    }
  }
  if (-not $gitCommand) { throw 'Git for Windows is required. Install it from https://git-scm.com/install/windows, then run Start-Branchlet.cmd again.' }
  $gitVersion = & $gitCommand.Source --version
  if ($LASTEXITCODE -ne 0) { throw 'Git could not start. Repair Git for Windows and retry.' }
  Write-Host "Branchlet - $gitVersion"
  $runtimeNode = Join-Path $branchletRoot 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $runtimeNode)) {
    $cachedNode = Join-Path $branchletRoot '.runtime\node.exe'
    $cachedNpm = Join-Path $branchletRoot '.runtime\node_modules\npm\bin\npm-cli.js'
    if ((Test-Path -LiteralPath $cachedNode) -and (Test-Path -LiteralPath $cachedNpm)) { $runtimeNode = $cachedNode }
    else {
      $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
      $nodeCompatible = $false
      if ($systemNode) { & $systemNode.Source -e 'process.exit(parseInt(process.versions.node)>=22?0:1)'; $nodeCompatible = $LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $systemNode.Source) 'node_modules\npm\bin\npm-cli.js')) }
      if ($nodeCompatible) { $runtimeNode = $systemNode.Source }
      else {
        & (Join-Path $PSScriptRoot 'node-runtime.ps1') -Destination (Join-Path $branchletRoot '.runtime')
        if ($LASTEXITCODE -ne 0) { throw 'Portable Node.js setup failed.' }
        $runtimeNode = $cachedNode
      }
    }
  }
  $env:PATH = (Split-Path -Parent $runtimeNode) + ';' + $env:PATH
  $env:BRANCHLET_APP_DIR = $branchletRoot
  $branchletData = if ($env:BRANCHLET_DATA_DIR) { [IO.Path]::GetFullPath($env:BRANCHLET_DATA_DIR) } else { Join-Path $branchletRoot '.branchlet' }
  New-Item -ItemType Directory -Path $branchletData -Force | Out-Null
  $env:BRANCHLET_DATA_DIR = $branchletData
  $serverFile = Join-Path $branchletRoot 'app\server.cjs'
  if ($Rebuild -or -not (Test-Path -LiteralPath $serverFile) -or -not (Test-Path -LiteralPath (Join-Path $branchletRoot 'dist\index.html'))) {
    if (-not (Test-Path -LiteralPath (Join-Path $branchletRoot 'package-lock.json'))) { throw 'This download is incomplete. Extract the complete portable ZIP before starting.' }
    $npmCli = Join-Path (Split-Path -Parent $runtimeNode) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm is missing. Use the complete portable download or install a current Node.js LTS runtime.' }
    Write-Host 'Preparing source launch: installing locked dependencies (internet required)...'
    & $runtimeNode $npmCli ci --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your connection and run Start-Branchlet.cmd again.' }
    Write-Host 'Building Branchlet...'
    & $runtimeNode $npmCli run build:portable
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. See the messages above.' }
  }
  $branchletPort = if ($env:BRANCHLET_PORT) { [int]$env:BRANCHLET_PORT } else { 4317 }
  if ($branchletPort -lt 1024 -or $branchletPort -gt 65535) { throw 'BRANCHLET_PORT must be between 1024 and 65535.' }
  $branchletUrl = "http://127.0.0.1:$branchletPort"
  $existingService = $null
  try { $existingService = Invoke-RestMethod -Uri "$branchletUrl/api/health" -TimeoutSec 2 } catch { }
  if ($existingService) {
    if ($existingService.app -ne 'Branchlet' -or $existingService.dataDir -ne $branchletData) { throw "Port $branchletPort is used by another app or Branchlet installation. Stop that instance, or set BRANCHLET_PORT to another port." }
    if ($Rebuild) {
      $existingRecord = Join-Path $branchletData 'server-process.json'
      if (-not (Test-Path -LiteralPath $existingRecord)) { throw 'Build completed. Stop the existing development server, then run Start-Branchlet.cmd again.' }
      $existingInstance = Get-Content -LiteralPath $existingRecord -Raw | ConvertFrom-Json
      if ($existingInstance.pid -ne $existingService.pid) { throw 'Build completed, but the running server differs from the launcher record. Stop that instance and start Branchlet again.' }
      & (Join-Path $PSScriptRoot 'stop-windows.ps1')
      if ($LASTEXITCODE -ne 0) { throw 'Build completed, but the previous instance could not be stopped.' }
    } else {
      Write-Host "Branchlet is already running: $branchletUrl"
      if (-not $NoBrowser) { Start-Process $branchletUrl }
      exit 0
    }
  }
  if ($Foreground) { & $runtimeNode $serverFile; exit $LASTEXITCODE }
  $branchletLog = Join-Path $branchletData 'server.log'
  $branchletErrorLog = Join-Path $branchletData 'server-error.log'
  $branchletProcess = Start-Process -FilePath $runtimeNode -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $branchletRoot -WindowStyle Hidden -RedirectStandardOutput $branchletLog -RedirectStandardError $branchletErrorLog -PassThru
  $branchletReady = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($branchletProcess.HasExited) { $serverError = Get-Content -LiteralPath $branchletErrorLog -Raw -ErrorAction SilentlyContinue; throw "Branchlet did not start. $serverError" }
    try { $health = Invoke-RestMethod -Uri "$branchletUrl/api/health" -TimeoutSec 1; if ($health.app -eq 'Branchlet' -and $health.dataDir -eq $branchletData -and $health.pid -eq $branchletProcess.Id) { $branchletReady = $true; break } } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $branchletReady) { Stop-Process -Id $branchletProcess.Id -ErrorAction SilentlyContinue; throw "Startup timed out. Read $branchletErrorLog" }
  @{ pid = $branchletProcess.Id; port = $branchletPort; node = $runtimeNode; server = $serverFile; dataDir = $branchletData; started = $branchletProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $branchletData 'server-process.json') -Encoding UTF8
  $startupTracked = $true
  Write-Host "Branchlet is ready: $branchletUrl"
  Write-Host 'Use Stop-Branchlet.cmd to stop this instance.'
  if (-not $NoBrowser) { Start-Process $branchletUrl }
} catch {
  if ($branchletProcess -and -not $startupTracked -and -not $branchletProcess.HasExited) { $branchletProcess | Stop-Process -ErrorAction SilentlyContinue }
  Write-Host ("ERROR: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
