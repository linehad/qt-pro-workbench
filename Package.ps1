$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$packageMetadata = Get-Content -LiteralPath (Join-Path $sourceRoot 'package.json') -Raw | ConvertFrom-Json
$packageVersion = $packageMetadata.version
$packagePath = Join-Path $sourceRoot "qt-pro-workbench-$packageVersion.vsix"
Add-Type -AssemblyName System.IO.Compression
$packageStream = [System.IO.File]::Open($packagePath, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($packageStream, [System.IO.Compression.ZipArchiveMode]::Create)
function Add-PackageText([string]$name, [string]$text) {
    $entry = $archive.CreateEntry($name)
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    $writer.Write($text)
    $writer.Dispose()
}
try {
    $contentTypes = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="css" ContentType="text/css"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="map" ContentType="application/json"/><Default Extension="ts" ContentType="text/plain"/><Default Extension="py" ContentType="text/plain"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="ps1" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>'
    $contentTypes = $contentTypes.Replace('</Types>', '<Default Extension="yaml" ContentType="text/plain"/></Types>')
    Add-PackageText '[Content_Types].xml' $contentTypes
    $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="qt-pro-workbench" Version="$packageVersion" Publisher="ynlim" />
    <DisplayName>Qt Pro Workbench (Local)</DisplayName>
    <Description xml:space="preserve">Personal qmake/CMake project tree, Qt/compiler kits, build and run.</Description>
    <Tags>qt,qmake,pro,cmake</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.100.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="ms-vscode.cpptools" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui" />
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
"@
    Add-PackageText 'extension.vsixmanifest' $manifest
    $files = @('package.json', 'README.md', 'CODEX-CONTROL.md', 'LICENSE', 'tsconfig.json', 'Package.ps1', 'package-lock.json', 'language-configuration.json')
    foreach ($folder in @('out', 'src', 'media')) {
        $files += Get-ChildItem -LiteralPath (Join-Path $sourceRoot $folder) -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath($sourceRoot, $_.FullName) }
    }
    foreach ($relativePath in $files) {
        $entry = $archive.CreateEntry('extension/' + $relativePath.Replace('\', '/'))
        $inputStream = [System.IO.File]::OpenRead((Join-Path $sourceRoot $relativePath))
        $outputStream = $entry.Open()
        $inputStream.CopyTo($outputStream)
        $inputStream.Dispose()
        $outputStream.Dispose()
    }
} finally {
    $archive.Dispose()
    $packageStream.Dispose()
}
Write-Output $packagePath
