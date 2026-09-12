param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$Architecture = 'x64'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($Architecture -notin @('x64', 'arm64')) { throw 'Only Windows x64 and arm64 are supported.' }
$branchletRoot = Split-Path -Parent $PSScriptRoot
$runtimeConfig = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
$runtimeVersion = [string]$runtimeConfig.version
if ($runtimeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Node.js runtime version.' }
$runtimeDestination = [IO.Path]::GetFullPath($Destination)
$runtimeExecutable = Join-Path $runtimeDestination 'node.exe'
if ((Test-Path -LiteralPath $runtimeExecutable) -and (Test-Path -LiteralPath (Join-Path $runtimeDestination 'npm.cmd')) -and (Test-Path -LiteralPath (Join-Path $runtimeDestination 'node_modules\npm\bin\npm-cli.js'))) {
  $runtimeInstalledVersion = & $runtimeExecutable --version
  if ($LASTEXITCODE -eq 0 -and $runtimeInstalledVersion -eq "v$runtimeVersion") { Write-Host "Node.js $runtimeInstalledVersion ready."; return }
}
$runtimeCache = Join-Path $branchletRoot '.cache\node'
New-Item -ItemType Directory -Force -Path $runtimeCache | Out-Null
$runtimeArchiveName = "node-v$runtimeVersion-win-$Architecture.zip"
$runtimeArchive = Join-Path $runtimeCache $runtimeArchiveName
$runtimeBaseUrl = "https://nodejs.org/dist/v$runtimeVersion"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Write-Host "Verifying Node.js $runtimeVersion against the pinned official SHA-256..."
# These values are copied from the official version-specific SHASUMS256.txt.
# Updating Node.js requires updating the version and hashes together.
$runtimeExpectedHash = [string]$runtimeConfig.sha256.$Architecture
if ($runtimeExpectedHash -notmatch '^[a-f0-9]{64}$') { throw 'Missing pinned official SHA-256 for this runtime.' }
$runtimeNeedsDownload = -not (Test-Path -LiteralPath $runtimeArchive)
if (-not $runtimeNeedsDownload) { $runtimeNeedsDownload = (Get-FileHash -LiteralPath $runtimeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeExpectedHash }
if ($runtimeNeedsDownload) {
  Write-Host "Downloading $runtimeArchiveName from nodejs.org..."
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe --fail --location --retry 2 --connect-timeout 20 --max-time 300 --output $runtimeArchive "$runtimeBaseUrl/$runtimeArchiveName"
    if ($LASTEXITCODE -ne 0) { throw 'Runtime download failed. Check your internet connection and retry.' }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$runtimeBaseUrl/$runtimeArchiveName" -OutFile $runtimeArchive -TimeoutSec 300
  }
}
if ((Get-FileHash -LiteralPath $runtimeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeExpectedHash) { throw 'Node.js SHA-256 verification failed. The runtime was not installed.' }
$runtimeExtractDirectory = Join-Path $runtimeCache ('extract-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $runtimeArchive -DestinationPath $runtimeExtractDirectory
$runtimeSource = Join-Path $runtimeExtractDirectory "node-v$runtimeVersion-win-$Architecture"
New-Item -ItemType Directory -Force -Path $runtimeDestination | Out-Null
Get-ChildItem -LiteralPath $runtimeSource -Force | Copy-Item -Destination $runtimeDestination -Recurse -Force
$runtimeActualVersion = & $runtimeExecutable --version
if ($LASTEXITCODE -ne 0 -or $runtimeActualVersion -ne "v$runtimeVersion") { throw 'The extracted Node.js runtime did not pass its version check.' }
Write-Host "Verified Node.js $runtimeActualVersion installed in $runtimeDestination"
