param([Parameter(Mandatory = $true)][string]$Directories)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-QtValue($node) {
    if ($node.Name -eq 'valuemap') {
        $values = @{}
        foreach ($child in $node.SelectNodes('value|valuemap|valuelist')) { $values[$child.GetAttribute('key')] = Read-QtValue $child }
        return $values
    }
    if ($node.Name -eq 'valuelist') {
        $values = @($node.SelectNodes('value|valuemap|valuelist') | ForEach-Object { Read-QtValue $_ })
        return ,$values
    }
    if ($node.GetAttribute('type') -eq 'bool') { return $node.InnerText -eq 'true' }
    if ($node.GetAttribute('type') -in @('int', 'uint', 'qlonglong')) { return [long]$node.InnerText }
    return $node.InnerText
}

$result = @()
foreach ($directory in ($Directories | ConvertFrom-Json)) {
    $files = @{}
    foreach ($name in @('profiles.xml', 'toolchains.xml', 'qtversion.xml', 'debuggers.xml', 'cmaketools.xml')) {
        $file = Join-Path $directory $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $settings = [System.Xml.XmlReaderSettings]::new()
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
        $settings.XmlResolver = $null
        $settings.MaxCharactersInDocument = 10000000
        $reader = [System.Xml.XmlReader]::Create($file, $settings)
        try {
            $document = [System.Xml.XmlDocument]::new()
            $document.XmlResolver = $null
            $document.Load($reader)
            $data = @{}
            foreach ($entry in $document.SelectNodes('/qtcreator/data')) {
                $value = $entry.SelectSingleNode('value|valuemap|valuelist')
                if ($value) { $data[$entry.SelectSingleNode('variable').InnerText] = Read-QtValue $value }
            }
            $files[$name] = $data
        } finally { $reader.Dispose() }
    }
    $result += @{ directory = $directory; files = $files }
}
ConvertTo-Json -InputObject $result -Depth 30 -Compress
