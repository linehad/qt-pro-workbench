import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { debugSupportDirectory } from "./XDebugRuntime";

export function interruptDebugProcess(processId: number, executable: string): Promise<void> {
    if (!Number.isSafeInteger(processId) || processId <= 0) { return Promise.reject(new Error("No debugged process ID")); }
    const windows = process.env.SystemRoot ?? "C:/Windows";
    const legacyPowershell = path.join(windows, "SysWOW64/WindowsPowerShell/v1.0/powershell.exe");
    // GDB 7.2 misses the remote-break event from a 64-bit caller on this Qt 4 setup.
    const powershell = fs.existsSync(legacyPowershell) ? legacyPowershell : path.join(windows, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = path.join(debugSupportDirectory(), "InterruptProcess.ps1");
    return new Promise((resolve, reject) => execFile(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessId", String(processId), "-ExpectedExecutable", executable], { windowsHide: true, timeout: 6000, maxBuffer: 16384 }, (error, _stdout, stderr) => {
        if (error) { reject(new Error(stderr.trim() || error.message)); } else { resolve(); }
    }));
}
