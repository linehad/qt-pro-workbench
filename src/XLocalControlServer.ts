import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { controlDirectory, controlPipe } from "./XLocalControlClient";
import type { ControlRequest, ControlDescriptor } from "./XControlTypes";

export class TXLocalControlServer {
    private readonly descriptor: ControlDescriptor;
    private readonly server: net.Server;
    private readonly sockets = new Set<net.Socket>();
    private readonly descriptorPath: string;
    private readonly execute: (request: ControlRequest) => Promise<unknown>;

    private accept(socket: net.Socket): void {
        this.sockets.add(socket);
        socket.setEncoding("utf8"); socket.setTimeout(20000, () => socket.destroy());
        socket.on("close", () => this.sockets.delete(socket));
        socket.on("error", () => socket.destroy());
        let buffer = "", dispatched = false;
        socket.on("data", text => {
            if (dispatched) { return; }
            buffer += text;
            if (Buffer.byteLength(buffer) > 1024 * 1024) { socket.destroy(); return; }
            if (!buffer.includes("\n")) { return; }
            dispatched = true;
            void this.respond(buffer.slice(0, buffer.indexOf("\n"))).then(response => socket.end(JSON.stringify(response) + "\n"));
        });
    }

    private async respond(text: string): Promise<unknown> {
        try {
            const request = JSON.parse(text);
            const supplied = typeof request.token === "string" ? Buffer.from(request.token) : Buffer.alloc(0);
            const expected = Buffer.from(this.descriptor.token);
            if (supplied.length !== expected.length) { throw new Error("Qt Pro 인증 실패"); }
            if (!timingSafeEqual(supplied, expected)) { throw new Error("Qt Pro 인증 실패"); }
            if (typeof request.operation !== "string") { throw new Error("잘못된 제어 요청입니다."); }
            if (!request.arguments || typeof request.arguments !== "object") { throw new Error("잘못된 제어 인수입니다."); }
            if (request.arguments.instanceId !== undefined && request.arguments.instanceId !== this.descriptor.id) { throw new Error("다른 VS Code 창의 요청입니다."); }
            return { ok: true, result: await this.execute(request) };
        } catch (error) { return { ok: false, error: (error as Error).message }; }
    }

    public constructor(execute: (request: ControlRequest) => Promise<unknown>) {
        const id = randomUUID();
        this.descriptor = { id, pipe: controlPipe(id), token: randomBytes(32).toString("hex"), pid: process.pid, createdAt: new Date().toISOString() };
        this.descriptorPath = path.join(controlDirectory(), `${id}.json`);
        this.execute = execute;
        this.server = net.createServer(socket => this.accept(socket));
    }

    public get instanceId(): string { return this.descriptor.id; }

    public async start(): Promise<void> {
        fs.mkdirSync(controlDirectory(), { recursive: true, mode: 0o700 });
        await new Promise<void>((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(this.descriptor.pipe, () => { this.server.removeListener("error", reject); resolve(); });
        });
        this.server.on("error", () => this.dispose());
        if (process.platform !== "win32") { fs.chmodSync(this.descriptor.pipe, 0o600); }
        fs.writeFileSync(this.descriptorPath, JSON.stringify(this.descriptor), { encoding: "utf8", mode: 0o600 });
    }

    public dispose(): void {
        for (const socket of this.sockets) { socket.destroy(); }
        this.server.close();
        if (fs.existsSync(this.descriptorPath)) { fs.unlinkSync(this.descriptorPath); }
        if (process.platform !== "win32" && fs.existsSync(this.descriptor.pipe)) { fs.unlinkSync(this.descriptor.pipe); }
    }
}
