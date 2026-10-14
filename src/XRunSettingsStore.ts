import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeRunConfigurationSet } from "./XRunConfigurations";
import type { RunConfigurationSet, StoredRunConfigurations } from "./XRunTypes";

function settingsPath(storagePath: string, projectPath: string): string {
    let identity = path.resolve(projectPath);
    if (process.platform === "win32") { identity = identity.toLowerCase(); }
    const digest = crypto.createHash("sha256").update(identity).digest("hex");
    return path.join(storagePath, "run-configurations", `${digest}.json`);
}

export function loadRunConfigurations(storagePath: string, projectPath: string): Record<string, RunConfigurationSet> | undefined {
    const filePath = settingsPath(storagePath, projectPath);
    if (!fs.existsSync(filePath)) { return undefined; }
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!stored.profiles || typeof stored.profiles !== "object") { throw new Error(`실행 설정 파일 형식이 잘못되었습니다: ${filePath}`); }
    const profiles: Record<string, RunConfigurationSet> = {};
    for (const [key, value] of Object.entries(stored.profiles)) { profiles[key] = normalizeRunConfigurationSet(value, path.basename(projectPath, ".pro")); }
    return profiles;
}

export function saveRunConfigurations(storagePath: string, projectPath: string, profiles: StoredRunConfigurations): void {
    const filePath = settingsPath(storagePath, projectPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify({ projectPath, profiles }, null, 4), "utf8");
        fs.renameSync(temporaryPath, filePath);
    } finally {
        if (fs.existsSync(temporaryPath)) { fs.unlinkSync(temporaryPath); }
    }
}
