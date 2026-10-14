import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectPreferences } from "./XProjectTypes";

function settingsPath(storagePath: string, projectPath: string): string {
    const key = path.resolve(projectPath).toLowerCase();
    const id = crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
    return path.join(storagePath, "project-selections", `${id}.json`);
}

export function loadProjectPreferences(storagePath: string, projectPath: string): ProjectPreferences | undefined {
    const file = settingsPath(storagePath, projectPath);
    if (!fs.existsSync(file)) { return undefined; }
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.configuration !== "debug" && value.configuration !== "release") { throw new Error("개인 프로젝트 빌드 구성을 확인하세요."); }
    if (value.kitId !== undefined && typeof value.kitId !== "string") { throw new Error("개인 프로젝트 키트 식별자를 확인하세요."); }
    return { configuration: value.configuration, kitId: value.kitId };
}

export function saveProjectPreferences(storagePath: string, projectPath: string, preferences: ProjectPreferences): void {
    const file = settingsPath(storagePath, projectPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const value = { version: 1, projectPath, configuration: preferences.configuration, kitId: preferences.kitId };
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 4), "utf8");
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); }
    }
}
