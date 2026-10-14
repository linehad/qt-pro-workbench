import { parseRunArguments } from "./XRunArguments";
import { applyBuildEnvironment } from "./XBuildSettings";
import type { RunSettings } from "./XRunTypes";

export function validateRunSettings(value: unknown): RunSettings {
    if (!value || typeof value !== "object") { throw new Error("실행 설정을 확인하세요."); }
    const settings = value as RunSettings;
    for (const key of ["executable", "arguments", "workingDirectory"] as const) {
        if (typeof settings[key] !== "string") { throw new Error(`실행 설정의 ${key} 값은 문자열이어야 합니다.`); }
        if (settings[key].includes("\0")) { throw new Error("실행 설정에 NUL 문자를 넣을 수 없습니다."); }
    }
    parseRunArguments(settings.arguments);
    const result: RunSettings = { executable: settings.executable.trim(), arguments: settings.arguments, workingDirectory: settings.workingDirectory.trim() };
    for (const field of ["environment", "startupCommands"] as const) {
        if (settings[field] === undefined) { continue; }
        if (typeof settings[field] !== "string" || settings[field].includes("\0")) { throw new Error(`실행 설정의 ${field} 값을 확인하세요.`); }
        result[field] = settings[field];
    }
    applyBuildEnvironment({}, result.environment ?? "");
    if (settings.runInTerminal !== undefined) {
        if (typeof settings.runInTerminal !== "boolean") { throw new Error("Run in terminal 설정을 확인하세요."); }
        result.runInTerminal = settings.runInTerminal;
    }
    return result;
}
