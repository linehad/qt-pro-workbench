import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function settingsPath(storagePath: string, projectPath: string, category: string): string {
    let identity = path.resolve(projectPath);
    if (process.platform === "win32") { identity = identity.toLowerCase(); }
    return path.join(storagePath, category, createHash("sha256").update(identity).digest("hex") + ".json");
}

export function loadConfigurations<T>(storagePath: string, projectPath: string, category: string, validate: (value: unknown) => T): Record<string, T> | undefined {
    const file = settingsPath(storagePath, projectPath, category);
    if (!fs.existsSync(file)) { return undefined; }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) { throw new Error(`설정 파일 형식을 확인하세요: ${file}`); }
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, validate(value)]));
}

export function saveConfigurations<T>(storagePath: string, projectPath: string, category: string, configurations: Record<string, T>): void {
    const file = settingsPath(storagePath, projectPath, category);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(configurations, null, 4), "utf8");
        fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); } }
}
