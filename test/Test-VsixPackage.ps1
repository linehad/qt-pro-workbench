param([Parameter(Mandatory = $true)][string]$PackagePath)

$ErrorActionPreference = 'Stop'
$resolvedPackagePath = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
Add-Type -AssemblyName WindowsBase
$package = [System.IO.Packaging.Package]::Open($resolvedPackagePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
try {
    $parts = @($package.GetParts())
    foreach ($part in $parts) {
        if ([string]::IsNullOrWhiteSpace($part.ContentType)) { throw "Missing content type: $($part.Uri)" }
        $stream = $part.GetStream([System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
        try { $stream.CopyTo([System.IO.Stream]::Null) } finally { $stream.Dispose() }
    }
    $requiredParts = @('/extension.vsixmanifest', '/extension/package.json', '/extension/LICENSE', '/extension/CODEX-CONTROL.md', '/extension/out/XExtension.js', '/extension/out/XQtDebugPrinters.js', '/extension/out/XControlCli.js', '/extension/out/XLocalControlServer.js', '/extension/media/control/QtControl.ps1', '/extension/media/debug/InterruptProcess.ps1', '/extension/media/debug/XQt4Printers.py', '/extension/media/debug/XQt4Values.py', '/extension/media/debug/XQt4Containers.py')
    foreach ($partPath in $requiredParts) {
        if (-not $package.PartExists([System.Uri]::new($partPath, [System.UriKind]::Relative))) { throw "Missing part: $partPath" }
    }
    foreach ($partPath in @('/extension/out/XDebugPipe.js', '/extension/out/XRunArguments.js', '/extension/out/XDebugRuntime.js', '/extension/out/XReferences.js', '/extension/out/XQtCreatorImport.js', '/extension/media/ReadQtCreatorSettings.ps1')) {
        if (-not $package.PartExists([System.Uri]::new($partPath, [System.UriKind]::Relative))) { throw "Missing part: $partPath" }
    }
    foreach ($partPath in @('/extension/media/control/skill/references/projects.md', '/extension/media/control/skill/references/debugging.md', '/extension/media/control/skill/references/troubleshooting.md', '/extension/media/control/skill/agents/openai.yaml', '/extension/media/control/skill/references/vscode.md', '/extension/media/control/skill/references/qt-workbench.md')) {
        if (-not $package.PartExists([System.Uri]::new($partPath, [System.UriKind]::Relative))) { throw "Missing skill resource: $partPath" }
    }
    foreach ($partPath in @('/extension/out/XGitHistory.js', '/extension/out/XGitRepository.js', '/extension/out/XGitRevisions.js', '/extension/out/XGitHistoryView.js', '/extension/out/XGitEncoding.js', '/extension/media/git-history.css', '/extension/media/git-history.js', '/extension/media/git-history-calendar.js', '/extension/media/git-history-layout.js', '/extension/media/control/skill/references/git-history.md')) {
        if (-not $package.PartExists([System.Uri]::new($partPath, [System.UriKind]::Relative))) { throw "Missing Git history resource: $partPath" }
    }
    $license = $package.GetPart([System.Uri]::new('/extension/LICENSE', [System.UriKind]::Relative))
    foreach ($partPath in @('/extension/node_modules/iconv-lite/lib/index.js', '/extension/node_modules/iconv-lite/encodings/tables/cp949.json', '/extension/node_modules/safer-buffer/safer.js', '/extension/node_modules/iconv-lite/LICENSE', '/extension/node_modules/safer-buffer/LICENSE')) {
        if (-not $package.PartExists([System.Uri]::new($partPath, [System.UriKind]::Relative))) { throw "Missing encoding runtime: $partPath" }
    }
    if ($license.ContentType -ne 'text/plain') { throw 'Invalid LICENSE content type' }
    $manifestPart = $package.GetPart([System.Uri]::new('/extension.vsixmanifest', [System.UriKind]::Relative))
    $reader = [System.IO.StreamReader]::new($manifestPart.GetStream())
    try { $manifest = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    $metadataPart = $package.GetPart([System.Uri]::new('/extension/package.json', [System.UriKind]::Relative))
    $reader = [System.IO.StreamReader]::new($metadataPart.GetStream())
    try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.PackageManifest.Metadata.Identity.Version -ne $metadata.version) { throw 'Version mismatch' }
    $dependencies = $manifest.PackageManifest.Metadata.Properties.Property | Where-Object Id -eq 'Microsoft.VisualStudio.Code.ExtensionDependencies'
    if ($dependencies.Value -ne ($metadata.extensionDependencies -join ',')) { throw 'Extension dependency mismatch' }
    if ($manifest.PackageManifest.Installation.InstallationTarget.Id -ne 'Microsoft.VisualStudio.Code') { throw 'Wrong installation target' }
    if ($parts.Count -ne ($parts.Uri.OriginalString | Select-Object -Unique).Count) { throw 'Duplicate package parts' }
    Write-Output "OPC_PACKAGE_CHECKS_PASSED version=$($metadata.version) parts=$($parts.Count)"
} finally { $package.Close() }
