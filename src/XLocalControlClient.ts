import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import type { ControlDescriptor, ControlRequest } from "./XControlTypes";

export function controlDirectory(): string {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
    return path.join(base, "QtProWorkbench", "control");
}

export function controlPipe(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) { throw new Error("잘못된 VS Code 창 ID입니다."); }
    return process.platform === "win32" ? `\\\\.\\pipe\\qt-pro-workbench-${id}` : path.join(controlDirectory(), `${id}.sock`);
}

export function readControlDescriptor(id: string): ControlDescriptor {
    const pipe = controlPipe(id);
    const value = JSON.parse(fs.readFileSync(path.join(controlDirectory(), `${id}.json`), "utf8")) as ControlDescriptor;
    if (value.id !== id || value.pipe !== pipe) { throw new Error("잘못된 Qt Pro 연결 정보입니다."); }
    if (!/^[a-f0-9]{64}$/.test(value.token)) { throw new Error("잘못된 Qt Pro 연결 토큰입니다."); }
    return value;
}

export function callLocalControl(descriptor: ControlDescriptor, request: ControlRequest, timeout = 15000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(descriptor.pipe);
        let buffer = "", completed = false;
        const finish = (error?: Error, value?: unknown): void => {
            if (completed) { return; }
            completed = true; socket.destroy();
            if (error) { reject(error); } else { resolve(value); }
        };
        socket.setEncoding("utf8"); socket.setTimeout(timeout);
        socket.on("connect", () => socket.write(JSON.stringify({ ...request, token: descriptor.token }) + "\n"));
        socket.on("timeout", () => finish(new Error("Qt Pro 연결 시간이 초과되었습니다.")));
        socket.on("error", error => finish(error));
        socket.on("close", () => finish(new Error("Qt Pro 연결이 종료되었습니다.")));
        socket.on("data", text => {
            buffer += text;
            if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { finish(new Error("Qt Pro 응답이 너무 큽니다.")); return; }
            if (!buffer.includes("\n")) { return; }
            try {
                const response = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
                if (!response.ok) { finish(new Error(response.error ?? "Qt Pro 호출 실패")); return; }
                finish(undefined, response.result);
            } catch (error) { finish(error as Error); }
        });
    });
}

export async function listControlInstances(): Promise<unknown[]> {
    if (!fs.existsSync(controlDirectory())) { return []; }
    const files = fs.readdirSync(controlDirectory()).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
    const results = await Promise.all(files.map(async file => {
        try {
            const descriptor = readControlDescriptor(file.slice(0, -5));
            const state = await callLocalControl(descriptor, { operation: "qt_get_state", arguments: {} }, 1500);
            return { instanceId: descriptor.id, pid: descriptor.pid, createdAt: descriptor.createdAt, state };
        } catch { return undefined; }
    }));
    return results.filter(value => value !== undefined);
}
