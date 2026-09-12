param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $Source -DestinationPath $Target -CompressionLevel Optimal -Force
$releaseHash = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($Target + '.sha256') -Value ($releaseHash + '  ' + [IO.Path]::GetFileName($Target)) -Encoding ascii
Write-Host ('SHA-256: ' + $releaseHash)
