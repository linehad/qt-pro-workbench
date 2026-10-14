import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadKits } from "./XKitStore";
import { mergeQtCreatorKits, qtCreatorKits } from "./XQtCreatorKits";
import type { QtCreatorImportResult, QtCreatorSettings } from "./XQtCreatorTypes";

export function readQtCreatorSettings(extension: string, directories: string[]): QtCreatorSettings[] {
    if (!directories.length) { return []; }
    const powershell = path.join(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = path.join(extension, "media/ReadQtCreatorSettings.ps1");
    // A JSON array is passed as one literal argument because powershell -File does not bind multiple array arguments.
    const output = execFileSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Directories", JSON.stringify(directories)], { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(output.replace(/^\uFEFF/, "")) as QtCreatorSettings[];
}

export function importQtCreatorOnce(extension: string, kitsFile: string, sources?: string[], initialize = false): QtCreatorImportResult | undefined {
    const marker = path.join(path.dirname(kitsFile), "qt-creator-import.json");
    let descriptor: number;
    try { descriptor = fs.openSync(marker, "wx"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") { return undefined; } throw error; }
    try {
        const candidates = sources ?? ["C:/Qt/Tools/sdktool/share/qtcreator/QtProject/qtcreator", "C:/Qt/Tools/QtCreator/share/qtcreator/QtProject/qtcreator", path.join(process.env.APPDATA ?? "", "QtProject/qtcreator")];
        const directories = candidates.filter(directory => fs.existsSync(path.join(directory, "profiles.xml")));
        const skipped: string[] = [];
        const imported = qtCreatorKits(readQtCreatorSettings(extension, directories), skipped);
        const merged = mergeQtCreatorKits(loadKits(kitsFile), imported, initialize);
        if (merged.added || merged.updated) {
            const temporary = `${kitsFile}.${randomUUID()}.tmp`;
            try { fs.writeFileSync(temporary, JSON.stringify(merged.kits, null, 4), "utf8"); fs.renameSync(temporary, kitsFile); }
            finally { if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); } }
        }
        const result: QtCreatorImportResult = { added: merged.added, updated: merged.updated, sources: directories, skipped };
        fs.writeFileSync(descriptor, JSON.stringify({ version: 1, status: "complete", ...result }, null, 4), "utf8");
        return result;
    } catch (error) {
        fs.writeFileSync(descriptor, JSON.stringify({ version: 1, status: "failed", error: String(error) }, null, 4), "utf8");
        throw error;
    } finally { fs.closeSync(descriptor); }
}
