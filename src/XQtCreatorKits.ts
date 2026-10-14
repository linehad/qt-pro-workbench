import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { findCMakeTool } from "./XCMakeTools";
import { debuggerPathForKit } from "./XDebugConfiguration";
import type { QtKit } from "./XProjectTypes";
import type { QtCreatorMap, QtCreatorSettings, QtCreatorValue } from "./XQtCreatorTypes";

function object(value: QtCreatorValue | undefined): QtCreatorMap { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value: QtCreatorValue | undefined): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function executable(value: QtCreatorValue | undefined): string | undefined {
    const file = text(value);
    return path.isAbsolute(file) && fs.existsSync(file) && fs.statSync(file).isFile() ? path.resolve(file) : undefined;
}
function records(settings: QtCreatorSettings[], file: string, prefix: string): QtCreatorMap[] {
    return settings.flatMap(source => Object.entries(source.files[file] ?? {}).filter(([key]) => new RegExp(`^${prefix}\\.\\d+$`).test(key)).map(([, value]) => object(value)));
}

export function qtCreatorKits(settings: QtCreatorSettings[], skipped: string[]): QtKit[] {
    const chains = new Map<string, QtCreatorMap>();
    for (const item of records(settings, "toolchains.xml", "ToolChain")) {
        const id = text(item["ProjectExplorer.ToolChain.Id"]);
        chains.set(id, item); chains.set(id.slice(id.lastIndexOf(":") + 1), item);
    }
    const versions = new Map<string, QtCreatorMap>();
    for (const item of records(settings, "qtversion.xml", "QtVersion")) {
        const source = text(item.autodetectionSource); const id = text(item.Id);
        if (source) { versions.set(source, item); }
        if (id && id !== "-1") { versions.set(id, item); }
    }
    const debuggers = new Map(records(settings, "debuggers.xml", "DebuggerItem").map(item => [text(item.Id), item]));
    const cmake = new Map(records(settings, "cmaketools.xml", "CMakeTools").map(item => [text(item.Id), item]));
    const profiles = new Map(records(settings, "profiles.xml", "Profile").map(item => [text(item["PE.Profile.Id"]), item]));
    const result: QtKit[] = [];
    for (const [id, profile] of profiles) {
        const data = object(profile["PE.Profile.Data"]);
        if (text(data["PE.Profile.DeviceType"]) !== "Desktop") { continue; }
        const toolchains = object(data["PE.Profile.ToolChainsV3"]);
        const cxx = chains.get(text(toolchains.Cxx)) ?? chains.get(text(data["PE.Profile.ToolChain"]));
        const c = chains.get(text(toolchains.C));
        const cxxCompilerPath = executable(cxx?.["ProjectExplorer.GccToolChain.Path"] ?? cxx?.["ProjectExplorer.MsvcToolChain.Path"]);
        const name = text(profile["PE.Profile.Name"]) || "Qt Creator kit";
        if (!cxxCompilerPath) { skipped.push(`${name}: C++ 컴파일러 경로 없음`); continue; }
        const version = versions.get(text(data["QtSupport.QtInformation"]));
        const qmakePath = executable(version?.QMakePath) ?? "";
        if (version && !qmakePath) { skipped.push(`${name}: qmake 경로 없음`); continue; }
        const compilerDirectory = path.dirname(cxxCompilerPath);
        const isMsvc = path.basename(cxxCompilerPath).toLowerCase() === "cl.exe";
        const makePath = executable(path.join(compilerDirectory, isMsvc ? "nmake.exe" : "mingw32-make.exe")) ?? "";
        const cmakePath = executable(cmake.get(text(data["CMakeProjectManager.CMakeKitInformation"]))?.Binary) ?? findCMakeTool("cmake.exe");
        if ((!qmakePath && !cmakePath) || (qmakePath && !makePath)) { skipped.push(`${name}: 빌드 도구 경로 없음`); continue; }
        const generator = object(data["CMake.GeneratorKitInformation"]);
        const cmakeGenerator = text(generator.Generator) || (isMsvc ? "Ninja" : "MinGW Makefiles");
        const debuggerInfo = data["Debugger.Information"];
        const debuggerItem = debuggers.get(text(debuggerInfo)) ?? object(debuggerInfo);
        if (!isMsvc && debuggerItem.EngineType !== undefined && debuggerItem.EngineType !== 1) { skipped.push(`${name}: GDB가 아닌 디버거`); continue; }
        const qtVersion = qmakePath ? path.basename(path.dirname(path.dirname(path.dirname(qmakePath)))) : "";
        const cCompilerPath = executable(c?.["ProjectExplorer.GccToolChain.Path"] ?? c?.["ProjectExplorer.MsvcToolChain.Path"]);
        const kit: QtKit = {
            id: "qtcreator-" + createHash("sha256").update(id).digest("hex").slice(0, 12), name: name.replaceAll("%{Qt:Version}", qtVersion),
            qmakePath, compilerDirectory, makePath, cxxCompilerPath, cCompilerPath: cCompilerPath?.includes("++") ? undefined : cCompilerPath,
            spec: text(data["QtSupport.MkspecInformation"]) || (isMsvc ? "win32-msvc" : "win32-g++"),
            cmakePath, cmakeGenerator, cmakeMakePath: cmakeGenerator.startsWith("Ninja") ? findCMakeTool("ninja.exe") : makePath || undefined,
            cmakePlatform: text(generator.Platform) || undefined, debuggerType: isMsvc ? "msvc" : "gdb"
        };
        kit.debuggerPath = qtVersion === "4.8.1" ? debuggerPathForKit(kit) : executable(debuggerItem.Binary);
        result.push(kit);
    }
    return result;
}

export function mergeQtCreatorKits(existing: QtKit[], imported: QtKit[], initialize = false): { kits: QtKit[]; added: number; updated: number } {
    const kits = existing.map(kit => ({ ...kit }));
    let added = 0; let updated = 0;
    for (const kit of imported) {
        const identity = (value: QtKit): string => `${value.qmakePath ? path.resolve(value.qmakePath).toLowerCase() : ""}|${path.resolve(value.compilerDirectory).toLowerCase()}`;
        const index = kits.findIndex(value => {
            if (value.id === kit.id || identity(value) === identity(kit)) { return true; }
            return initialize && Boolean(kit.qmakePath) && path.resolve(value.qmakePath).toLowerCase() === path.resolve(kit.qmakePath).toLowerCase();
        });
        if (index < 0) { kits.push(kit); added++; continue; }
        const previous = kits[index]; const overrides = Object.fromEntries(Object.entries(previous).filter(([, value]) => value !== undefined));
        const merged = initialize ? { ...previous, ...kit, id: previous.id } : { ...kit, ...overrides } as QtKit;
        if (Object.entries(merged).some(([key, value]) => JSON.stringify(previous[key as keyof QtKit]) !== JSON.stringify(value))) { kits[index] = merged; updated++; }
    }
    return { kits, added, updated };
}
