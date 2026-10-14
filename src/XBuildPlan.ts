import * as path from "node:path";
import { getBuildSettings, applyBuildEnvironment } from "./XBuildSettings";
import { existingBuild, qmakeArgumentsMatch } from "./XExistingBuild";
import { parseRunArguments } from "./XRunArguments";
import { qmakeState, qmakeSettingsChanged } from "./XQmakeState";
import { isCMakeProject } from "./XProjectIdentity";
import { makeCMakePlan } from "./XCMakePlan";
import type { BuildPlan, ProjectPreferences, QtKit } from "./XProjectTypes";

export function kitEnvironment(kit: QtKit): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && key.toUpperCase() !== "PATH") { environment[key] = value; }
    }
    Object.assign(environment, kit.environment ?? {});
    const extraPathKey = Object.keys(kit.environment ?? {}).find(key => key.toUpperCase() === "PATH");
    const inheritedPath = extraPathKey ? kit.environment![extraPathKey] : process.env.PATH ?? "";
    for (const key of Object.keys(environment)) {
        if (key.toUpperCase() === "PATH") { delete environment[key]; }
    }
    environment.PATH = [...(kit.qmakePath ? [path.dirname(kit.qmakePath)] : []), kit.compilerDirectory, ...(kit.cmakeMakePath ? [path.dirname(kit.cmakeMakePath)] : []), inheritedPath].filter(Boolean).join(path.delimiter);
    if (kit.qmakePath) {
        environment.QTDIR = path.dirname(path.dirname(kit.qmakePath));
        environment.QT_PLUGIN_PATH = path.join(environment.QTDIR, "plugins");
    }
    delete environment.QMAKESPEC;
    delete environment.QMAKEPATH;
    delete environment.QMAKEFEATURES;
    return environment;
}

export function makeBuildPlan(projectPath: string, kit: QtKit, preferences: ProjectPreferences, storagePath: string): BuildPlan {
    if (isCMakeProject(projectPath)) { return makeCMakePlan(projectPath, kit, preferences, storagePath, kitEnvironment(kit)); }
    if (!kit.qmakePath) { throw new Error("qmake 프로젝트에는 Qt · qmake 경로가 있는 키트를 선택하세요."); }
    const settings = getBuildSettings(preferences, kit);
    const projectDirectory = path.dirname(projectPath);
    const shadowDirectory = settings.buildDirectory.replaceAll("${projectDir}", projectDirectory);
    const buildDirectory = settings.shadowBuild ? path.resolve(projectDirectory, shadowDirectory) : projectDirectory;
    const existing = existingBuild(projectPath, kit, preferences.configuration, [buildDirectory]);
    const projectArgument = buildDirectory.toLowerCase() === projectDirectory.toLowerCase() ? path.basename(projectPath) : projectPath;
    const qmakeArguments = [projectArgument];
    if (kit.spec) { qmakeArguments.push("-spec", kit.spec); }
    qmakeArguments.push(`CONFIG+=${preferences.configuration}`, ...parseRunArguments(settings.qmakeArguments));
    const state = qmakeState(storagePath, buildDirectory, kit, settings);
    return {
        projectPath, configuration: preferences.configuration, buildDirectory, outputDirectory: buildDirectory,
        qmakeArguments, makeArguments: parseRunArguments(settings.makeArguments), cleanArguments: parseRunArguments(settings.cleanArguments),
        environment: applyBuildEnvironment(kitEnvironment(kit), settings.environment), kit,
        needsQmake: !existing || qmakeSettingsChanged(state) || !qmakeArgumentsMatch(buildDirectory, preferences.configuration, parseRunArguments(settings.qmakeArguments)), qmakeState: state
    };
}
