import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BuildPlan, QtKit } from "./XProjectTypes";
import type { BuildSettings } from "./XBuildSettingsTypes";

export function qmakeState(storagePath: string, buildDirectory: string, kit: QtKit, settings: BuildSettings): NonNullable<BuildPlan["qmakeState"]> {
    const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
    const identity = process.platform === "win32" ? buildDirectory.toLowerCase() : buildDirectory;
    const signature = digest(JSON.stringify({ qmake: kit.qmakePath, compiler: kit.compilerDirectory, spec: kit.spec, arguments: settings.qmakeArguments, kitEnvironment: kit.environment, environment: settings.environment }));
    return { filePath: path.join(storagePath, "qmake-state", digest(identity) + ".json"), signature };
}

export function qmakeSettingsChanged(state: NonNullable<BuildPlan["qmakeState"]>): boolean {
    if (!fs.existsSync(state.filePath)) { return false; }
    try { return JSON.parse(fs.readFileSync(state.filePath, "utf8")).signature !== state.signature; }
    catch { return true; }
}

export function recordQmakeState(plan: BuildPlan): void {
    const state = plan.qmakeState;
    if (!state) { return; }
    fs.mkdirSync(path.dirname(state.filePath), { recursive: true });
    const temporary = `${state.filePath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify({ signature: state.signature }), "utf8");
        fs.renameSync(temporary, state.filePath);
    } finally { if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); } }
}
