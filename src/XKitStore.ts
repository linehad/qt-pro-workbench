import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { QtKit } from "./XProjectTypes";
import { discoverCMakeKits, findCMakeTool } from "./XCMakeTools";

function childDirectories(directory: string): string[] {
    try { return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name)); }
    catch { return []; }
}

function qtCompilerVersion(qtDirectory: string): string {
    try {
        const text = fs.readFileSync(path.join(qtDirectory, "mkspecs", "qconfig.pri"), "utf8");
        const major = text.match(/QT_GCC_MAJOR_VERSION\s*=\s*(\d+)/)?.[1];
        const minor = text.match(/QT_GCC_MINOR_VERSION\s*=\s*(\d+)/)?.[1] ?? "0";
        if (major) { return `${major}${minor}`; }
    } catch { return ""; }
    return "";
}

export function discoverKits(qmakePaths: string[] = []): QtKit[] {
    const roots = ["C:/Qt", "C:/QtSDK"];
    const candidates = new Set(qmakePaths.map(value => path.resolve(value)));
    candidates.add("C:/QtSDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe");
    for (const root of roots) {
        for (const version of childDirectories(root)) {
            for (const kit of childDirectories(version)) { candidates.add(path.join(kit, "bin", "qmake.exe")); }
        }
    }
    const compilerDirectories = childDirectories("C:/Qt/Tools");
    const kits: QtKit[] = [];
    const seen = new Set<string>();
    for (const qmakePath of candidates) {
        if (!fs.existsSync(qmakePath)) { continue; }
        const canonical = path.resolve(qmakePath).toLowerCase();
        if (seen.has(canonical)) { continue; }
        seen.add(canonical);
        const qtDirectory = path.dirname(path.dirname(qmakePath));
        const kitName = path.basename(qtDirectory);
        const isLegacy = qmakePath.toLowerCase().includes("qtsdk");
        if (!isLegacy && !kitName.toLowerCase().includes("mingw")) { continue; }
        const architecture = kitName.includes("_32") || isLegacy ? "32" : "64";
        const versionPrefix = qtCompilerVersion(qtDirectory);
        if (!isLegacy && !versionPrefix) { continue; }
        const candidatesForArchitecture = compilerDirectories.filter(directory => path.basename(directory).startsWith("mingw" + versionPrefix)).filter(directory => directory.endsWith("_" + architecture));
        const compilerRoot = isLegacy ? "C:/QtSDK/mingw" : candidatesForArchitecture[0];
        if (!compilerRoot) { continue; }
        const compilerDirectory = path.join(compilerRoot, "bin");
        const makePath = path.join(compilerDirectory, "mingw32-make.exe");
        if (!fs.existsSync(makePath)) { continue; }
        if (!fs.existsSync(path.join(compilerDirectory, "g++.exe"))) { continue; }
        const qtVersion = path.basename(path.dirname(qtDirectory));
        kits.push({
            id: crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12),
            name: `Qt ${qtVersion} / ${path.basename(compilerRoot)} (${architecture}-bit)`,
            qmakePath: path.resolve(qmakePath), compilerDirectory, makePath, spec: "win32-g++",
            cmakePath: findCMakeTool("cmake.exe"), cmakeGenerator: "MinGW Makefiles"
        });
    }
    return [...kits, ...discoverCMakeKits()];
}

export function loadKits(filePath: string): QtKit[] {
    const kits: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(kits)) { throw new Error("kits.json은 키트 배열이어야 합니다."); }
    for (const kit of kits) {
        const fields = ["id", "name", "qmakePath", "compilerDirectory", "makePath"];
        if (fields.some(field => typeof kit[field] !== "string")) { throw new Error("키트의 id, name, qmakePath, compilerDirectory, makePath를 확인하세요."); }
    }
    return kits as QtKit[];
}
