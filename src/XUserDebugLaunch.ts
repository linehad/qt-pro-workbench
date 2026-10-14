import type * as vscode from "vscode";

interface UserLaunchSettings {
    configurations?: unknown[];
    [key: string]: unknown;
}

function isActiveProjectLaunch(value: unknown): boolean {
    if (!value || typeof value !== "object") { return false; }
    const configuration = value as vscode.DebugConfiguration;
    const isQtLaunch = configuration.type === "qt-pro" && configuration.request === "launch";
    return isQtLaunch && !configuration.qtProject;
}

export async function ensureUserDebugLaunch(settings: vscode.WorkspaceConfiguration): Promise<void> {
    // Register only an entry point; resolve the current project, kit and named Run on every launch.
    const existing = settings.inspect<UserLaunchSettings>("launch")?.globalValue;
    if (existing !== undefined && typeof existing !== "object") { throw new Error("사용자 launch 설정 형식을 확인하세요."); }
    const configurations = existing?.configurations ?? [];
    if (!Array.isArray(configurations)) { throw new Error("사용자 launch.configurations 설정은 배열이어야 합니다."); }
    if (configurations.some(isActiveProjectLaunch)) { return; }
    const names = new Set(configurations.map(value => (value as vscode.DebugConfiguration)?.name));
    const base = "Qt Pro: 활성 프로젝트";
    let name = base;
    let index = 2;
    while (names.has(name)) { name = `${base} (${index++})`; }
    const configuration = { type: "qt-pro", request: "launch", name };
    await settings.update("launch", { version: "0.2.0", ...existing, configurations: [...configurations, configuration] }, true);
}
