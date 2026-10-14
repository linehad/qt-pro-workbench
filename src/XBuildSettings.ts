import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { parseRunArguments, formatRunArguments } from "./XRunArguments";
import type { BuildSettings } from "./XBuildSettingsTypes";
import type { ProjectPreferences, QtKit } from "./XProjectTypes";

function profilePath(storagePath: string, projectPath: string): string {
    const identity = path.resolve(projectPath).toLowerCase();
    return path.join(storagePath, "build-configurations", crypto.createHash("sha256").update(identity).digest("hex") + ".json");
}

export function buildSettingsKey(kitId: string, configuration: "debug" | "release"): string {
    return JSON.stringify([kitId, configuration]);
}

export function getBuildSettings(preferences: ProjectPreferences, kit: QtKit): BuildSettings {
    const profiles = preferences.buildProfiles?.[kit.id];
    const active = profiles?.items.find(item => item.id === profiles.activeId && item.configuration === preferences.configuration) ?? profiles?.items.find(item => item.configuration === preferences.configuration);
    if (active) { return validateBuildSettings(active.settings); }
    const saved = preferences.buildConfigurations?.[buildSettingsKey(kit.id, preferences.configuration)];
    if (saved) { return validateBuildSettings(saved); }
    if (preferences.buildSystem === "cmake") {
        return { shadowBuild: false, buildDirectory: "", qmakeArguments: "", makeArguments: `--parallel ${os.availableParallelism()}`, cleanArguments: "", environment: "" };
    }
    return { shadowBuild: false, buildDirectory: "", qmakeArguments: formatRunArguments(kit.qmakeArguments ?? []), makeArguments: kit.makeArguments ? formatRunArguments(kit.makeArguments) : `-j${os.availableParallelism()}`, cleanArguments: `clean -j${os.availableParallelism()}`, environment: "" };
}

export function validateBuildSettings(value: unknown): BuildSettings {
    if (!value || typeof value !== "object") { throw new Error("빌드 설정 형식을 확인하세요."); }
    const data = value as Record<string, unknown>;
    if (typeof data.shadowBuild !== "boolean") { throw new Error("Shadow build 설정을 확인하세요."); }
    const fields = ["buildDirectory", "qmakeArguments", "makeArguments", "cleanArguments", "environment"];
    if (fields.some(field => typeof data[field] !== "string" || (data[field] as string).includes("\0"))) { throw new Error("빌드 설정은 NUL 없는 문자열이어야 합니다."); }
    const result = Object.fromEntries(fields.map(field => [field, data[field]])) as unknown as BuildSettings;
    result.shadowBuild = data.shadowBuild;
    result.buildDirectory = result.buildDirectory.trim();
    if (result.shadowBuild && !result.buildDirectory) { throw new Error("Shadow build 폴더를 지정하세요."); }
    for (const field of ["qmakeArguments", "makeArguments", "cleanArguments"] as const) { parseRunArguments(result[field]); }
    applyBuildEnvironment({}, result.environment);
    return result;
}

export function applyBuildEnvironment(base: Record<string, string>, text: string): Record<string, string> {
    const environment = { ...base };
    for (const line of text.split(/\r?\n/).filter(value => value.trim())) {
        const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!pair) { throw new Error("환경변수는 한 줄에 NAME=value 하나씩 입력하세요."); }
        const key = Object.keys(environment).find(item => item.toUpperCase() === pair[1].toUpperCase()) ?? pair[1];
        environment[key] = pair[2];
    }
    return environment;
}

export function loadBuildConfigurations(storagePath: string, projectPath: string): Record<string, BuildSettings> | undefined {
    const filePath = profilePath(storagePath, projectPath);
    if (!fs.existsSync(filePath)) { return undefined; }
    const profiles = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, validateBuildSettings(value)]));
}

export function saveBuildConfiguration(storagePath: string, projectPath: string, key: string, settings: BuildSettings): void {
    const profiles = loadBuildConfigurations(storagePath, projectPath) ?? {};
    profiles[key] = validateBuildSettings(settings);
    const filePath = profilePath(storagePath, projectPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(profiles, null, 4), "utf8");
        fs.renameSync(temporary, filePath);
    } finally { if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); } }
}
