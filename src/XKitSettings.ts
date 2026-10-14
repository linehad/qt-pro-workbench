import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { QtKit } from "./XProjectTypes";
import { parseRunArguments } from "./XRunArguments";

function textField(value: Record<string, unknown>, field: string): string {
    const text = value[field] ?? "";
    if (typeof text !== "string") { throw new Error(`${field} 값은 문자열이어야 합니다.`); }
    if (/[\r\n\0]/.test(text)) { throw new Error(`${field} 값에 줄바꿈을 넣을 수 없습니다.`); }
    return text.trim();
}

function toolPath(value: string, label: string, directory = false): string {
    if (!path.isAbsolute(value)) { throw new Error(`${label}: 전체 경로를 지정하세요.`); }
    if (!fs.existsSync(value)) { throw new Error(`${label}: 경로를 찾을 수 없습니다. ${value}`); }
    const entry = fs.statSync(value);
    const valid = directory ? entry.isDirectory() : entry.isFile();
    if (!valid) { throw new Error(`${label}: ${directory ? "폴더" : "파일"}를 선택하세요.`); }
    return path.normalize(value);
}

function argumentsField(value: unknown, field: string): string[] | undefined {
    if (value === undefined) { return undefined; }
    if (field === "make 인수" && typeof value === "string") {
        if (value.includes("\0")) { throw new Error("make 인수에 NUL 문자를 넣을 수 없습니다."); }
        return value.trim() ? parseRunArguments(value) : undefined;
    }
    if (!Array.isArray(value)) { throw new Error(`${field} 형식이 잘못되었습니다.`); }
    if (value.some(item => typeof item !== "string" || /[\r\n\0]/.test(item))) { throw new Error(`${field}: 인수를 한 줄씩 입력하세요.`); }
    return value;
}

function environmentField(value: unknown): Record<string, string> | undefined {
    if (value === undefined) { return undefined; }
    if (!value || typeof value !== "object") { throw new Error("환경변수 형식이 잘못되었습니다."); }
    if (Array.isArray(value)) { throw new Error("환경변수 형식이 잘못되었습니다."); }
    const result: Record<string, string> = Object.create(null);
    const keys = new Set<string>();
    for (const [key, item] of Object.entries(value)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { throw new Error(`환경변수 이름을 확인하세요: ${key}`); }
        if (typeof item !== "string" || /[\r\n\0]/.test(item)) { throw new Error(`환경변수 값을 확인하세요: ${key}`); }
        if (keys.has(key.toUpperCase())) { throw new Error(`환경변수가 중복됩니다: ${key}`); }
        keys.add(key.toUpperCase());
        result[key] = item;
    }
    return result;
}

export function validateKits(value: unknown): QtKit[] {
    if (!Array.isArray(value)) { throw new Error("키트 목록 형식이 잘못되었습니다."); }
    const ids = new Set<string>();
    return value.map((item: unknown) => {
        if (!item || typeof item !== "object") { throw new Error("키트 형식이 잘못되었습니다."); }
        const data = item as Record<string, unknown>;
        const id = textField(data, "id");
        const name = textField(data, "name");
        if (!id || !name) { throw new Error("키트 이름을 입력하세요."); }
        if (ids.has(id)) { throw new Error(`키트 ID가 중복됩니다: ${name}`); }
        ids.add(id);
        try {
            const qmakeText = textField(data, "qmakePath");
            const cmakeText = textField(data, "cmakePath");
            if (!qmakeText && !cmakeText) { throw new Error("qmake 또는 CMake 경로를 지정하세요."); }
            const qmakePath = qmakeText ? toolPath(qmakeText, "qmake") : "";
            const compilerDirectory = toolPath(textField(data, "compilerDirectory"), "컴파일러 bin 폴더", true);
            const cxxCompilerPath = textField(data, "cxxCompilerPath");
            const cCompilerPath = textField(data, "cCompilerPath");
            const cmakeToolchainFile = textField(data, "cmakeToolchainFile");
            if (cxxCompilerPath) { toolPath(cxxCompilerPath, "C++ 컴파일러"); }
            else if (!cmakeToolchainFile && !textField(data, "cmakeGenerator").startsWith("Visual Studio")) { toolPath(path.join(compilerDirectory, "g++.exe"), "C++ 컴파일러"); }
            if (cCompilerPath) { toolPath(cCompilerPath, "C 컴파일러"); }
            if (cmakeToolchainFile) { toolPath(cmakeToolchainFile, "CMake toolchain 파일"); }
            const makeText = textField(data, "makePath");
            const makePath = makeText ? toolPath(makeText, "빌드 도구") : "";
            if (qmakePath && !makePath) { throw new Error("qmake 키트의 make 경로를 지정하세요."); }
            const cmakeMakeText = textField(data, "cmakeMakePath");
            const debuggerType = textField(data, "debuggerType") || "gdb";
            if (debuggerType !== "gdb" && debuggerType !== "msvc") { throw new Error("GDB 또는 MSVC 디버거를 선택하세요."); }
            const debuggerPath = textField(data, "debuggerPath");
            if (debuggerPath) { toolPath(debuggerPath, "디버거"); }
            return { id, name, qmakePath, compilerDirectory, makePath, debuggerPath: debuggerPath || undefined, spec: textField(data, "spec") || undefined, qmakeArguments: argumentsField(data.qmakeArguments, "qmake 인수"), makeArguments: argumentsField(data.makeArguments, "make 인수"), environment: environmentField(data.environment),
                cmakePath: cmakeText ? toolPath(cmakeText, "CMake") : undefined, cmakeGenerator: textField(data, "cmakeGenerator") || undefined, cmakeMakePath: cmakeMakeText ? toolPath(cmakeMakeText, "CMake 빌드 도구") : undefined,
                cmakePlatform: textField(data, "cmakePlatform") || undefined, cmakeToolchainFile: cmakeToolchainFile || undefined, cCompilerPath: cCompilerPath || undefined, cxxCompilerPath: cxxCompilerPath || undefined, debuggerType };
        } catch (error) { throw new Error(`${name}: ${(error as Error).message}`); }
    });
}

export function saveKits(filePath: string, value: unknown, previousContents: string): QtKit[] {
    const kits = validateKits(value);
    if (fs.readFileSync(filePath, "utf8") !== previousContents) { throw new Error("다른 곳에서 키트 설정이 변경되었습니다. 다시 불러온 뒤 수정하세요."); }
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(kits, null, 4), "utf8");
        fs.renameSync(temporary, filePath);
    } finally {
        if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); }
    }
    return kits;
}
