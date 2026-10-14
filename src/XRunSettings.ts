import * as fs from "node:fs";
import * as path from "node:path";
import { parseRunArguments } from "./XRunArguments";
import { applyBuildEnvironment } from "./XBuildSettings";
import type { BuildPlan, ProjectPreferences } from "./XProjectTypes";
import { activeRunConfiguration, getRunConfigurationSet } from "./XRunConfigurations";
import { validateRunSettings } from "./XRunValidation";
export { runSettingsKey } from "./XRunConfigurations";
export { validateRunSettings } from "./XRunValidation";
import type { RunSettings, RunTarget } from "./XRunTypes";

export function getRunSettings(preferences: ProjectPreferences, kitId: string, configuration = preferences.configuration): RunSettings {
    return validateRunSettings(activeRunConfiguration(getRunConfigurationSet(preferences, kitId, configuration)));
}

function resolvePath(value: string, plan: BuildPlan, executable?: string): string {
    let resolved = value.trim().replace(/^"(.*)"$/, "$1");
    const projectDirectory = path.dirname(plan.projectPath);
    resolved = resolved.replaceAll("${projectDir}", projectDirectory).replaceAll("${buildDir}", plan.buildDirectory);
    if (executable) {
        resolved = resolved.replaceAll("${executableDir}", path.dirname(executable)).replaceAll("%{RunConfig:Executable:Path}", path.dirname(executable));
    }
    return path.resolve(projectDirectory, resolved);
}

export function configuredExecutable(plan: BuildPlan, settings: RunSettings): string | undefined {
    return settings.executable ? resolvePath(settings.executable, plan) : undefined;
}

export function makeRunTarget(plan: BuildPlan, settings: RunSettings, executable: string): RunTarget {
    const workingDirectory = settings.workingDirectory ? resolvePath(settings.workingDirectory, plan, executable) : path.dirname(executable);
    if (!fs.existsSync(executable)) { throw new Error(`실행 파일을 찾을 수 없습니다: ${executable}. Run Settings에서 경로를 확인하세요.`); }
    if (!fs.statSync(executable).isFile()) { throw new Error(`실행 파일 경로가 파일이 아닙니다: ${executable}`); }
    if (!fs.existsSync(workingDirectory)) { throw new Error(`작업 폴더를 찾을 수 없습니다: ${workingDirectory}`); }
    if (!fs.statSync(workingDirectory).isDirectory()) { throw new Error(`작업 폴더 경로가 폴더가 아닙니다: ${workingDirectory}`); }
    const target: RunTarget = { executable, workingDirectory, argumentsList: parseRunArguments(settings.arguments) };
    if (settings.environment !== undefined) { target.environment = applyBuildEnvironment(plan.environment, settings.environment); }
    if (settings.startupCommands !== undefined) { target.startupCommands = settings.startupCommands.split(/\r?\n/).map(line => line.trim()).filter(Boolean); }
    if (settings.runInTerminal !== undefined) { target.runInTerminal = settings.runInTerminal; }
    return target;
}
