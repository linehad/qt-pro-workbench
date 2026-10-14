param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$ProcessId, [Parameter(Mandatory = $true)][string]$ExpectedExecutable)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TXQtDebugInterrupt {
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CheckRemoteDebuggerPresent(IntPtr handle, out bool present);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder path, ref int size);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool DebugBreakProcess(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint size, uint flags);
}
'@
function Resolve-ExecutablePath([string]$FilePath) {
    $file = [TXQtDebugInterrupt]::CreateFile([System.IO.Path]::GetFullPath($FilePath), 0, 7, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
    if ($file -eq [IntPtr]::new(-1)) { throw 'Cannot resolve the selected executable' }
    try {
        $resolved = [System.Text.StringBuilder]::new(32768)
        $length = [TXQtDebugInterrupt]::GetFinalPathNameByHandle($file, $resolved, $resolved.Capacity, 0)
        if ($length -eq 0 -or $length -ge $resolved.Capacity) { throw 'Cannot resolve the executable file identity' }
        return $resolved.ToString()
    } finally { [TXQtDebugInterrupt]::CloseHandle($file) | Out-Null }
}
$handle = [TXQtDebugInterrupt]::OpenProcess(0x1f0fff, $false, $ProcessId)
if ($handle -eq [IntPtr]::Zero) { throw 'Cannot open the debugged process' }
try {
    $imagePath = [System.Text.StringBuilder]::new(32768)
    $pathLength = $imagePath.Capacity
    if (-not [TXQtDebugInterrupt]::QueryFullProcessImageName($handle, 0, $imagePath, [ref]$pathLength)) { throw 'Cannot identify the debugged process' }
    # Resolve filesystem redirects and junctions while still checking the exact executable.
    $expectedPath = Resolve-ExecutablePath $ExpectedExecutable
    $actualPath = Resolve-ExecutablePath $imagePath.ToString()
    if (-not [string]::Equals($actualPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Interrupt target does not match the selected executable: $actualPath (expected $expectedPath)" }
    $isDebugged = $false
    if (-not [TXQtDebugInterrupt]::CheckRemoteDebuggerPresent($handle, [ref]$isDebugged)) { throw 'Cannot confirm the debugger attachment' }
    if (-not $isDebugged) { throw 'The selected process is not being debugged' }
    if (-not [TXQtDebugInterrupt]::DebugBreakProcess($handle)) { throw 'Cannot interrupt the debugged process' }
} finally { [TXQtDebugInterrupt]::CloseHandle($handle) | Out-Null }
