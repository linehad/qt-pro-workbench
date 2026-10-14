import * as path from "node:path";

export function controlString(args: Record<string, unknown>, name: string): string {
    const value = args[name];
    if (typeof value !== "string" || !value.trim()) { throw new Error(`${name}: 문자열을 지정하세요.`); }
    if (value.length > 8192 || value.includes("\0")) { throw new Error(`${name}: 잘못된 문자열입니다.`); }
    return value;
}

export function controlInteger(args: Record<string, unknown>, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
    const value = args[name];
    if (!Number.isSafeInteger(value)) { throw new Error(`${name}: 정수를 지정하세요.`); }
    if ((value as number) < minimum || (value as number) > maximum) { throw new Error(`${name}: 범위를 벗어났습니다.`); }
    return value as number;
}

export function controlPath(args: Record<string, unknown>, name: string): string {
    const value = controlString(args, name);
    if (!path.isAbsolute(value)) { throw new Error(`${name}: 절대 경로를 지정하세요.`); }
    return path.resolve(value);
}

export function controlBoolean(args: Record<string, unknown>, name: string, fallback: boolean): boolean {
    if (args[name] === undefined) { return fallback; }
    if (typeof args[name] !== "boolean") { throw new Error(`${name}: true 또는 false를 지정하세요.`); }
    return args[name] as boolean;
}
