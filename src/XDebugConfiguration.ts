import * as fs from "node:fs";
import * as path from "node:path";
import { qtDebugSetupCommands } from "./XQtDebugPrinters";
import { debugPipePath } from "./XDebugRuntime";
import type { BuildPlan } from "./XProjectTypes";
import type { RunTarget } from "./XRunTypes";

export function debuggerPathForKit(kit: BuildPlan["kit"]): string {
    if (kit.debuggerType === "msvc") { return "Visual Studio C++ debugger"; }
    if (kit.debuggerPath) { return kit.debuggerPath; }
    const qtVersion = path.basename(path.dirname(path.dirname(path.dirname(kit.qmakePath))));
    if (qtVersion === "4.8.1") {
        return path.resolve(kit.compilerDirectory, "../../pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe");
    }
    return path.join(kit.compilerDirectory, "gdb.exe");
}

function executableArchitecture(executable: string): string {
    const descriptor = fs.openSync(executable, "r");
    try {
        const header = Buffer.alloc(64);
        if (fs.readSync(descriptor, header, 0, 64, 0) !== 64) { throw new Error("실행 파일 헤더를 읽을 수 없습니다."); }
        if (header.toString("ascii", 0, 2) !== "MZ") { throw new Error("Windows 실행 파일을 선택하세요."); }
        const signature = Buffer.alloc(6);
        fs.readSync(descriptor, signature, 0, 6, header.readUInt32LE(60));
        if (signature.readUInt32LE(0) !== 0x4550) { throw new Error("Windows PE 헤더를 찾을 수 없습니다."); }
        const machine = signature.readUInt16LE(4);
        if (machine === 0x14c) { return "x86"; }
        if (machine === 0x8664) { return "x64"; }
        throw new Error("현재 디버거는 Windows x86/x64 MinGW 실행 파일을 지원합니다.");
    } finally { fs.closeSync(descriptor); }
}

export function makeDebugConfiguration(plan: BuildPlan, target: RunTarget): Record<string, unknown> {
    const { executable, argumentsList, workingDirectory } = target;
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === "PATH") ?? "Path";
    if (plan.kit.debuggerType === "msvc") {
        if (target.startupCommands?.length) { throw new Error("MSVC 디버거는 GDB 시작 명령을 지원하지 않습니다."); }
        return { type: "cppvsdbg", request: "launch", name: `Qt Pro: ${path.basename(plan.projectPath)}`, program: executable, cwd: workingDirectory, args: argumentsList,
            environment: Object.entries(target.environment ?? plan.environment).map(([name, value]) => ({ name: name === "PATH" ? pathKey : name, value })), console: target.runInTerminal ? "externalTerminal" : "internalConsole" };
    }
    const result: Record<string, unknown> = {
        type: "cppdbg", request: "launch", name: `Qt Pro: ${path.basename(plan.projectPath)}`,
        program: executable, cwd: workingDirectory, args: argumentsList,
        MIMode: "gdb", miDebuggerPath: debuggerPathForKit(plan.kit),
        targetArchitecture: executableArchitecture(executable),
        environment: Object.entries(target.environment ?? plan.environment).map(([name, value]) => ({ name: name === "PATH" ? pathKey : name, value })),
        externalConsole: target.runInTerminal ?? false, avoidWindowsConsoleRedirection: true,
        setupCommands: [...qtDebugSetupCommands(plan.kit), { description: "Enable GDB pretty printing", text: "-enable-pretty-printing", ignoreFailures: true }, ...(target.startupCommands ?? []).map(text => ({ text, ignoreFailures: false }))]
    };
    const qtVersion = path.basename(path.dirname(path.dirname(path.dirname(plan.kit.qmakePath))));
    if (process.platform === "win32" && qtVersion === "4.8.1") {
        result.pipeTransport = {
            pipeProgram: process.execPath, pipeArgs: [debugPipePath(), debuggerPathForKit(plan.kit)],
            pipeCwd: workingDirectory, debuggerPath: debuggerPathForKit(plan.kit),
            pipeEnv: { ...(target.environment ?? plan.environment), ELECTRON_RUN_AS_NODE: "1" }, quoteArgs: true
        };
    }
    return result;
}
