import * as fs from "node:fs";
import * as path from "node:path";
import { selectedMakefile } from "./XExistingBuild";
import type { BuildPlan, ProjectData } from "./XProjectTypes";
import type { CppConfiguration } from "./XIntelliSenseTypes";

function words(text: string): string[] {
    return (text.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map(word => word.replace(/"/g, ""));
}

export function makeCppConfiguration(project: ProjectData, plan: BuildPlan): CppConfiguration {
    if (plan.buildSystem === "cmake") {
        return { includePath: [path.dirname(project.projectPath)], defines: [], compilerPath: plan.kit.cxxCompilerPath || path.join(plan.kit.compilerDirectory, "g++.exe"), compilerArgs: [],
            intelliSenseMode: `windows-${plan.kit.debuggerType === "msvc" ? "msvc" : "gcc"}-${/32|qtsdk/i.test(plan.kit.name + plan.kit.compilerDirectory) ? "x86" : "x64"}`, standard: "c++17" };
    }
    const qtDirectory = path.dirname(path.dirname(plan.kit.qmakePath));
    const includeDirectory = path.join(qtDirectory, "include");
    let modules: string[] = [];
    try { modules = fs.readdirSync(includeDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(includeDirectory, entry.name)); } catch { /* 사용자 키트의 설치 상태는 빌드 시 진단한다. */ }
    const includes = [path.dirname(project.projectPath), ...project.includePaths, includeDirectory, ...modules, path.join(qtDirectory, "mkspecs", plan.kit.spec ?? "win32-g++"), path.join(plan.buildDirectory, "ui"), path.join(plan.buildDirectory, "moc")];
    const is32 = plan.kit.name.includes("32-bit") || plan.kit.compilerDirectory.toLowerCase().includes("qtsdk");
    const standards = project.config.filter(value => /^c\+\+\d+$/.test(value));
    const result: CppConfiguration = {
        includePath: [...new Set(includes)], defines: [...project.defines, "UNICODE", "_UNICODE", "QT_CORE_LIB"],
        compilerPath: path.join(plan.kit.compilerDirectory, "g++.exe"), compilerArgs: [],
        intelliSenseMode: is32 ? "windows-gcc-x86" : "windows-gcc-x64",
        standard: standards.at(-1) ?? (qtDirectory.includes("4.8.") ? "c++98" : qtDirectory.includes("6.") ? "c++17" : "c++11")
    };
    try {
        const makefile = fs.readFileSync(path.join(plan.buildDirectory, selectedMakefile(plan.buildDirectory, plan.configuration)), "utf8");
        const value = (name: string) => makefile.match(new RegExp(`^${name}\\s*=\\s*(.*)$`, "m"))?.[1] ?? "";
        const paths = words(value("INCPATH")).filter(word => word.startsWith("-I")).map(word => path.resolve(plan.buildDirectory, word.slice(2)));
        if (paths.length) { result.includePath = [...new Set([...paths, path.dirname(project.projectPath)])]; }
        const defines = words(value("DEFINES")).filter(word => word.startsWith("-D")).map(word => word.slice(2));
        if (defines.length) { result.defines = defines; }
        result.compilerArgs = words(value("CXXFLAGS")).filter(word => /^(?:-std=|-m32$|-m64$|-fms-extensions$)/.test(word));
        const standard = result.compilerArgs.find(word => word.startsWith("-std="))?.slice(5);
        if (standard) { result.standard = standard; }
    } catch { /* 최초 빌드 전에는 프로젝트와 Qt 설치의 정적 정보를 사용한다. */ }
    return result;
}
