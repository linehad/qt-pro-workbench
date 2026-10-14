param(
    [string]$Operation = 'help',
    [string]$InstanceId,
    [string]$ArgumentsJson = '{}',
    [string]$RequestFile
)

$ErrorActionPreference = 'Stop'
$runtime = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($RequestFile) {
    $request = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    $arguments = $ArgumentsJson | ConvertFrom-Json
    if ($InstanceId) { $arguments | Add-Member -NotePropertyName instanceId -NotePropertyValue $InstanceId -Force }
    $request = @{ operation = $Operation; arguments = $arguments }
}
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
$previousOutputEncoding = $OutputEncoding
$previousConsoleEncoding = [Console]::OutputEncoding
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $request | ConvertTo-Json -Depth 20 -Compress | & $runtime.executable (Join-Path $PSScriptRoot 'XControlCli.js')
    $resultCode = $LASTEXITCODE
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
    $OutputEncoding = $previousOutputEncoding
    [Console]::OutputEncoding = $previousConsoleEncoding
}
exit $resultCode
