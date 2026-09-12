param(
  [string]$Archive,
  [switch]$KeepWorkdir
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $Archive) { $Archive = Join-Path $projectRoot 'release\Branchlet-1.0.0-windows-x64.zip' }
$archivePath = [IO.Path]::GetFullPath($Archive)
$testParent = [IO.Path]::GetFullPath((Join-Path $projectRoot '.branchlet'))
# Construct Unicode explicitly so this script also loads correctly in Windows PS 5.1.
$testName = 'portable smoke ' + [char]0x4E2D + [char]0x6587 + ' ' + [Guid]::NewGuid().ToString('N')
$testRoot = [IO.Path]::GetFullPath((Join-Path $testParent $testName))
$windowsRoot = $env:WINDIR
$windowsPowerShell = Join-Path $windowsRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$restrictedPath = $windowsRoot + ';' + (Join-Path $windowsRoot 'System32') + ';' + (Split-Path -Parent $windowsPowerShell)
$packageRoot = $null
$dataDirectory = Join-Path $testRoot 'isolated data'
$stopped = $false
$testPort = 0
$observedPid = 0
$baselineHealth = $null

function Assert-Smoke([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw ('SMOKE CHECK FAILED: ' + $Message) }
  Write-Host ('PASS: ' + $Message)
}

function Test-FreePort([int]$Port) {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
  try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Invoke-RestrictedPowerShell([string[]]$ChildArguments, [string]$Executable = $windowsPowerShell) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = (($ChildArguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  }) -join ' ')
  $start.WorkingDirectory = $packageRoot
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.EnvironmentVariables['PATH'] = $restrictedPath
  # A pwsh parent's module paths break Windows PS 5 built-in module discovery.
  $start.EnvironmentVariables.Remove('PSModulePath')
  $start.EnvironmentVariables['BRANCHLET_PORT'] = [string]$testPort
  $start.EnvironmentVariables['BRANCHLET_DATA_DIR'] = $dataDirectory
  $start.EnvironmentVariables['BRANCHLET_DEMO'] = '1'
  $child = New-Object Diagnostics.Process
  $child.StartInfo = $start
  if (-not $child.Start()) { throw 'Could not launch isolated Windows PowerShell.' }
  $stdout = $child.StandardOutput.ReadToEndAsync()
  $stderr = $child.StandardError.ReadToEndAsync()
  if (-not $child.WaitForExit(180000)) { $child.Kill(); throw 'Isolated launcher exceeded 180 seconds.' }
  # The detached server can retain an inherited pipe handle after its launcher
  # exits. Do not wait indefinitely for EOF from that long-lived descendant.
  $output = if ($stdout.Wait(2000)) { $stdout.GetAwaiter().GetResult() } else { '[Launcher exited; its background process retained the output pipe.]' }
  $errorOutput = if ($stderr.Wait(2000)) { $stderr.GetAwaiter().GetResult() } else { '' }
  $result = [pscustomobject]@{ Code = $child.ExitCode; Output = $output; Error = $errorOutput }
  $child.Dispose()
  return $result
}

function Invoke-Launcher([string]$Name, [switch]$Start, [string]$PowerShellPath = $windowsPowerShell) {
  $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $packageRoot ('scripts\' + $Name)))
  if ($Start) { $arguments += '-NoBrowser' }
  $result = Invoke-RestrictedPowerShell $arguments $PowerShellPath
  if ($result.Output) { Write-Host $result.Output.Trim() }
  if ($result.Error) { Write-Host $result.Error.Trim() }
  return $result
}

try {
  Assert-Smoke (Test-Path -LiteralPath $archivePath) 'Portable ZIP exists.'
  $checksumPath = $archivePath + '.sha256'
  Assert-Smoke (Test-Path -LiteralPath $checksumPath) 'Portable ZIP has a SHA-256 companion file.'
  $checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
  Assert-Smoke ($checksumLine -match '^([a-fA-F0-9]{64})\s+(.+)$') 'Checksum file contains a SHA-256 digest and archive filename.'
  $expectedChecksum = $Matches[1]
  $checksumFilename = $Matches[2]
  Assert-Smoke ($checksumFilename -eq [IO.Path]::GetFileName($archivePath) -and (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -eq $expectedChecksum) 'Portable ZIP matches its published SHA-256 checksum.'
  Assert-Smoke (Test-Path -LiteralPath $windowsPowerShell) 'Windows PowerShell 5.1 is available.'
  foreach ($candidatePort in @(4318, 4319)) { if (Test-FreePort $candidatePort) { $testPort = $candidatePort; break } }
  Assert-Smoke ($testPort -in @(4318, 4319)) 'An isolated test port is free; port 4317 will not be stopped.'
  try { $baselineHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/health' -TimeoutSec 2 } catch { }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $archiveEntries = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $roots = @($archiveEntries | ForEach-Object { $_.Split('/')[0] } | Select-Object -Unique)
    Assert-Smoke ($roots.Count -eq 1 -and $roots[0] -match '^Branchlet-[\w.-]+$') 'ZIP contains one expected application root.'
    foreach ($entry in $archiveEntries) {
      if ($entry.StartsWith('/') -or $entry -match '^[a-zA-Z]:' -or $entry.Split('/') -contains '..') { throw 'Unsafe path in ZIP archive.' }
    }
    $relativeEntries = @($archiveEntries | ForEach-Object { $_.Substring($roots[0].Length).TrimStart('/') })
    $unexpected = @($relativeEntries | Where-Object { $_ -match '(^|/)(\.branchlet|\.git)(/|$)' -or $_ -match '^(node_modules|\.runtime|\.cache|release)(/|$)' -or $_ -match '^(\.env(?:\.[^/]+)?|\.npmrc|secret(?:s)?(?:\.[^/]+)?)(/|$)' })
    Assert-Smoke ($unexpected.Count -eq 0) 'ZIP excludes user repositories, Git internals, root dependencies and secret configuration.'
    foreach ($required in @('runtime/node.exe', 'runtime/npm.cmd', 'app/server.cjs', 'dist/index.html', 'scripts/start-windows.ps1', 'scripts/stop-windows.ps1', 'docs/GETTING-STARTED.en.md', 'docs/GETTING-STARTED.zh-CN.md')) {
      Assert-Smoke ($relativeEntries -contains $required) ('Bundled artifact exists: ' + $required)
    }
    $packageRoot = Join-Path $testRoot $roots[0]
  } finally { $zip.Dispose() }
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $testRoot)
  Assert-Smoke ((Test-Path -LiteralPath $packageRoot) -and $testRoot.Contains(' ') -and $testRoot.Contains([string][char]0x4E2D)) 'ZIP extracts beneath .branchlet into a path containing spaces and Chinese characters.'

  $preflightCode = @'
@{ psMajor = $PSVersionTable.PSVersion.Major; nodeFound = [bool](Get-Command node.exe -ErrorAction SilentlyContinue); npmFound = [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue); gitFound = [bool](Get-Command git.exe -ErrorAction SilentlyContinue) } | ConvertTo-Json -Compress
'@
  $encodedPreflight = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($preflightCode))
  $preflightResult = Invoke-RestrictedPowerShell @('-NoLogo', '-NoProfile', '-EncodedCommand', $encodedPreflight)
  Assert-Smoke ($preflightResult.Code -eq 0) 'Restricted PowerShell preflight succeeds.'
  $preflight = $preflightResult.Output | ConvertFrom-Json
  Assert-Smoke ($preflight.psMajor -eq 5) 'Launch is tested with Windows PowerShell 5, not pwsh.'
  Assert-Smoke (-not $preflight.nodeFound -and -not $preflight.npmFound -and -not $preflight.gitFound) 'Restricted PATH has no system Node.js, npm or Git; Git must be auto-discovered.'

  $startResult = Invoke-Launcher 'start-windows.ps1' -Start
  Assert-Smoke ($startResult.Code -eq 0) 'Portable launcher starts without system Node.js or npm.'
  $baseUrl = 'http://127.0.0.1:' + $testPort
  $health = Invoke-RestMethod -Uri ($baseUrl + '/api/health') -TimeoutSec 5
  Assert-Smoke ($health.ok -and $health.app -eq 'Branchlet' -and $health.dataDir -eq $dataDirectory) 'Health identifies the isolated app and its own data directory.'
  $observedPid = [int]$health.pid
  $recordPath = Join-Path $dataDirectory 'server-process.json'
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $expectedNode = Join-Path $packageRoot 'runtime\node.exe'
  Assert-Smoke ($record.pid -eq $observedPid -and $record.node -eq $expectedNode) 'Process record identifies the bundled runtime and exact health PID.'
  $processInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $observedPid)
  Assert-Smoke ($processInfo.ExecutablePath -eq $expectedNode) 'The live service actually uses the ZIP-bundled node.exe.'
  $indexResponse = Invoke-WebRequest -UseBasicParsing -Uri $baseUrl -TimeoutSec 5
  Assert-Smoke ($indexResponse.StatusCode -eq 200 -and $indexResponse.Content -match 'id="root"') 'Compiled application HTML is served.'
  $scriptMatch = [regex]::Match($indexResponse.Content, 'src="(/assets/[^" ]+\.js)"')
  Assert-Smoke $scriptMatch.Success 'Application references a compiled JavaScript asset.'
  $assetResponse = Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + $scriptMatch.Groups[1].Value) -TimeoutSec 5
  Assert-Smoke ($assetResponse.StatusCode -eq 200 -and $assetResponse.RawContentLength -gt 1000) 'Compiled JavaScript is readable.'
  $docsResponse = Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + '/help/GETTING-STARTED.en.md') -TimeoutSec 5
  Assert-Smoke ($docsResponse.StatusCode -eq 200 -and $docsResponse.Headers['Content-Type'] -match 'text/plain' -and $docsResponse.Content -match 'Getting started') 'Bundled help documentation is served as readable text.'
  $chineseDocs = Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + '/help/GETTING-STARTED.zh-CN.md') -TimeoutSec 5
  $chineseHeading = [string][char]0x5165 + [char]0x95E8
  Assert-Smoke ($chineseDocs.StatusCode -eq 200 -and $chineseDocs.Headers['Content-Type'] -match 'text/plain' -and $chineseDocs.Content.Contains($chineseHeading) -and $chineseDocs.Content.Contains('Start-Branchlet.cmd')) 'Chinese help preserves readable Unicode and startup instructions.'
  $repositories = @(Invoke-RestMethod -Uri ($baseUrl + '/api/repos') -TimeoutSec 10)
  Assert-Smoke ($repositories.Count -gt 0) 'The independent sample repository is initialized.'
  $repository = $repositories[0]
  Assert-Smoke ($repository.path.StartsWith($dataDirectory, [StringComparison]::OrdinalIgnoreCase)) 'Sample repository lives only in the isolated data directory.'
  $files = Invoke-RestMethod -Uri ($baseUrl + '/api/repos/' + $repository.id + '/files?path=') -TimeoutSec 10
  Assert-Smoke ($files.entries.Count -gt 0 -and -not ($files.entries.name -contains '.git')) 'Repository file browsing works and excludes .git.'
  $previewFile = @($files.entries | Where-Object { $_.type -eq 'file' })[0]
  $preview = Invoke-RestMethod -Uri ($baseUrl + '/api/repos/' + $repository.id + '/file?path=' + [Uri]::EscapeDataString($previewFile.path)) -TimeoutSec 10
  Assert-Smoke ($preview.path -eq $previewFile.path -and $preview.size -ge 0) 'Read-only file preview works in the packaged app.'

  $repeatResult = Invoke-Launcher 'start-windows.ps1' -Start
  Assert-Smoke ($repeatResult.Code -eq 0) 'Repeated launch succeeds.'
  $repeatHealth = Invoke-RestMethod -Uri ($baseUrl + '/api/health') -TimeoutSec 5
  Assert-Smoke ($repeatHealth.pid -eq $observedPid) 'Repeated launch reuses the same process.'
  $registryPath = Join-Path $dataDirectory 'repos.json'
  $registryHash = (Get-FileHash -LiteralPath $registryPath -Algorithm SHA256).Hash
  $stopResult = Invoke-Launcher 'stop-windows.ps1'
  Assert-Smoke ($stopResult.Code -eq 0) 'Packaged stop script succeeds.'
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-Process -Id $observedPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
  }
  Assert-Smoke (-not (Get-Process -Id $observedPid -ErrorAction SilentlyContinue)) 'Stop terminates the exact launched PID.'
  Assert-Smoke (-not (Test-Path -LiteralPath $recordPath)) 'Stopped process record is removed.'
  Assert-Smoke ((Test-Path -LiteralPath $repository.path) -and (Get-FileHash -LiteralPath $registryPath -Algorithm SHA256).Hash -eq $registryHash) 'Stop preserves repository files and the unchanged registry.'
  $pwshCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($pwshCommand) {
    $restartResult = Invoke-Launcher 'start-windows.ps1' -Start
    Assert-Smoke ($restartResult.Code -eq 0) 'Stopped package can start again with Windows PowerShell 5.'
    $restartedHealth = Invoke-RestMethod -Uri ($baseUrl + '/api/health') -TimeoutSec 5
    $pwshStop = Invoke-Launcher 'stop-windows.ps1' -PowerShellPath $pwshCommand.Source
    Assert-Smoke ($pwshStop.Code -eq 0 -and -not (Get-Process -Id $restartedHealth.pid -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $recordPath)) 'PowerShell 7 can also stop the saved instance without a UTC timestamp mismatch.'
  }
  if ($baselineHealth) {
    $afterHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4317/api/health' -TimeoutSec 5
    Assert-Smoke ($afterHealth.pid -eq $baselineHealth.pid) 'Main preview on port 4317 is untouched.'
  }
  $stopped = $true
  [pscustomobject]@{ result = 'PASS'; archive = $archivePath; archiveBytes = (Get-Item -LiteralPath $archivePath).Length; port = $testPort; pid = $observedPid; windowsPowerShell = $preflight.psMajor; systemNodeUsed = $false; dataPreservedByStop = $true; workdir = $testRoot } | ConvertTo-Json
} finally {
  if (-not $stopped -and $packageRoot -and (Test-Path -LiteralPath (Join-Path $dataDirectory 'server-process.json'))) {
    try { $cleanupStop = Invoke-Launcher 'stop-windows.ps1'; $stopped = $cleanupStop.Code -eq 0 } catch { Write-Warning $_.Exception.Message }
  }
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTest = [IO.Path]::GetFullPath((Get-Item -LiteralPath $testRoot).FullName)
    if ([IO.Path]::GetDirectoryName($resolvedTest) -ne $testParent -or -not [IO.Path]::GetFileName($resolvedTest).StartsWith('portable smoke ')) { throw 'Refusing cleanup outside the dedicated smoke-test directory.' }
    $live = @()
    if ($packageRoot) {
      $expectedExecutable = Join-Path $packageRoot 'runtime\node.exe'
      $live = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $expectedExecutable })
    }
    if ($KeepWorkdir -or $live.Count -gt 0) { Write-Host ('Retained isolated test directory: ' + $resolvedTest) }
    else { Remove-Item -LiteralPath $resolvedTest -Recurse -Force; Write-Host 'Isolated smoke-test directory cleaned.' }
  }
}
