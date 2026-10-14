import * as path from "node:path";
import { readCMakeModel } from "./XCMakeFileApi";
import { parseRunArguments } from "./XRunArguments";
import type { BuildPlan } from "./XProjectTypes";
import type { CppConfiguration } from "./XIntelliSenseTypes";

export function cmakeConfigurations(plan: BuildPlan): Map<string, CppConfiguration> {
    const result = new Map<string, CppConfiguration>();
    const model = readCMakeModel(plan.buildDirectory, plan.configuration, plan.projectPath);
    if (!model) { return result; }
    for (const target of model.targets) {
        for (const source of target.sources ?? []) {
            const group = target.compileGroups?.[source.compileGroupIndex ?? -1] ?? target.compileGroups?.find(entry => entry.language === "CXX") ?? target.compileGroups?.[0];
            if (!group) { continue; }
            const compilerPath = model.compilers[group.language] || plan.kit.cxxCompilerPath || path.join(plan.kit.compilerDirectory, "g++.exe");
            const compilerArgs = (group.compileCommandFragments ?? []).flatMap(entry => parseRunArguments(entry.fragment)).filter(arg => /^(?:-std=|-m32$|-m64$|-f|\/std:|\/arch:)/.test(arg));
            const msvc = plan.kit.debuggerType === "msvc" || /(?:^|[\\/])cl\.exe$/i.test(compilerPath);
            const x86 = /32-bit|mingw810_32|qtsdk|i686/i.test(plan.kit.name + plan.kit.compilerDirectory) || plan.kit.cmakePlatform === "Win32";
            const standard = group.languageStandard?.standard;
            const file = path.resolve(source.isGenerated ? model.build : model.source, source.path).toLowerCase();
            if (result.has(file)) { continue; }
            const defaultStandard = group.language === "C" ? "c11" : "c++17";
            const languageStandard = standard ? `${group.language === "C" ? "c" : "c++"}${standard}` : defaultStandard;
            result.set(file, { includePath: (group.includes ?? []).map(entry => path.resolve(model.source, entry.path)), defines: (group.defines ?? []).map(entry => entry.define), compilerPath, compilerArgs,
                intelliSenseMode: `windows-${msvc ? "msvc" : "gcc"}-${x86 ? "x86" : "x64"}`, standard: languageStandard });
        }
    }
    return result;
}
