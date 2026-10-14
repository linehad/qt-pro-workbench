import * as fs from "node:fs";
import * as vscode from "vscode";
import { controlBoolean, controlInteger, controlPath, controlString } from "./XControlValidation";
import { interruptDebugProcess } from "./XGdbInterrupt";

interface DebugState { session: vscode.DebugSession; state: "starting" | "running" | "paused" | "terminated"; stopId: number; threadId?: number; reason?: string; exitCode?: number; processId?: number; breakpoints: unknown[]; frames: Set<number>; variables: Set<number>; }

export class TXDebugControl implements vscode.Disposable {
    private readonly sessions = new Map<string, DebugState>();
    private readonly disposables: vscode.Disposable[];
    private readonly log: (source: string, text: string) => void;

    private isQtSession(session: vscode.DebugSession): boolean { return typeof session.configuration.qtProProject === "string"; }

    private track(session: vscode.DebugSession): DebugState {
        let state = this.sessions.get(session.id);
        if (!state) {
            state = { session, state: "starting", stopId: 0, breakpoints: [], frames: new Set(), variables: new Set() };
            this.sessions.set(session.id, state);
            const completed = [...this.sessions.values()].filter(item => item.state === "terminated");
            for (const item of completed.slice(0, Math.max(0, completed.length - 20))) { this.sessions.delete(item.session.id); }
        }
        return state;
    }

    private message(state: DebugState, message: any): void {
        if (message.event === "process") { state.processId = message.body.systemProcessId; this.log(`debug:${state.session.id}`, JSON.stringify({ event: "process", body: message.body })); }
        if (message.command === "launch" && message.success && state.state === "starting") { state.state = "running"; }
        if (message.event === "stopped") {
            state.frames.clear(); state.variables.clear();
            state.state = "paused"; state.stopId++; state.threadId = message.body.threadId; state.reason = message.body.reason;
        }
        if (message.event === "continued") { state.state = "running"; state.reason = undefined; state.frames.clear(); state.variables.clear(); }
        if (message.event === "terminated") { state.state = "terminated"; state.stopId++; }
        if (message.event === "exited") { state.exitCode = message.body.exitCode; }
        if (message.command === "setBreakpoints" && message.success) { state.breakpoints = message.body?.breakpoints ?? []; }
        const events = ["stopped", "continued", "terminated", "exited", "breakpoint"];
        if (events.includes(message.event)) { this.log(`debug:${state.session.id}`, JSON.stringify({ event: message.event, body: message.body, stopId: state.stopId })); }
        if (message.event === "output") { this.log(`debug:${state.session.id}`, String(message.body?.output ?? "")); }
        if (message.type === "response" && message.success === false) { this.log(`debug:${state.session.id}`, `${message.command}: ${message.message}`); }
    }

    private selected(args: Record<string, unknown>, requirePaused = false): DebugState {
        const state = this.sessions.get(controlString(args, "sessionId"));
        if (!state || state.state === "terminated") { throw new Error("이 창의 활성 Qt 디버그 세션을 지정하세요."); }
        if (requirePaused) {
            if (state.state !== "paused") { throw new Error("중단된 디버그 세션에서만 값을 확인할 수 있습니다."); }
            if (controlInteger(args, "stopId") !== state.stopId) { throw new Error("중단 위치가 변경되었습니다. 새 stopId와 프레임을 조회하세요."); }
        }
        return state;
    }

    private async request(state: DebugState, command: string, args: Record<string, unknown>): Promise<any> {
        let timeout: NodeJS.Timeout | undefined;
        const stopId = state.stopId;
        const isInspection = ["stackTrace", "scopes", "variables", "evaluate"].includes(command);
        if ((command === "scopes" || command === "evaluate") && !state.frames.has(args.frameId as number)) { throw new Error("qt_debug_stack으로 현재 프레임을 먼저 조회하세요."); }
        if (command === "variables" && !state.variables.has(args.variablesReference as number)) { throw new Error("현재 중단 위치의 범위 또는 변수 참조를 조회하세요."); }
        try {
            const result = await Promise.race([state.session.customRequest(command, args), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`디버거 응답 시간 초과: ${command}`)), 10000); })]);
            if (isInspection && state.stopId !== stopId) { throw new Error("응답 중 중단 위치가 변경되었습니다. 다시 조회하세요."); }
            if (isInspection && state.state !== "paused") { throw new Error("응답 중 실행이 재개되었습니다. 중단된 후 다시 조회하세요."); }
            if (command === "stackTrace") { for (const frame of result.stackFrames ?? []) { state.frames.add(frame.id); } }
            if (command === "scopes") { for (const scope of result.scopes ?? []) { state.variables.add(scope.variablesReference); } }
            if (command === "variables") { for (const variable of result.variables ?? []) { if (variable.variablesReference > 0) { state.variables.add(variable.variablesReference); } } }
            if (command === "evaluate" && result.variablesReference > 0) { state.variables.add(result.variablesReference); }
            return result;
        } finally { if (timeout) { clearTimeout(timeout); } }
    }

    private breakpoints(): unknown[] {
        return vscode.debug.breakpoints.filter(item => item instanceof vscode.SourceBreakpoint).map(item => {
            const source = item as vscode.SourceBreakpoint;
            return { id: source.id, file: source.location.uri.fsPath, line: source.location.range.start.line + 1, column: source.location.range.start.character + 1, enabled: source.enabled, condition: source.condition, hitCondition: source.hitCondition, logMessage: source.logMessage };
        });
    }

    private setBreakpoints(args: Record<string, unknown>): unknown[] {
        const items = args.breakpoints;
        if (!Array.isArray(items) || !items.length || items.length > 100) { throw new Error("중단점을 1~100개 지정하세요."); }
        const additions = items.map(item => {
            const file = controlPath(item, "file");
            if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { throw new Error(`소스 파일이 없습니다: ${file}`); }
            const line = controlInteger(item, "line", 1);
            const column = item.column === undefined ? 1 : controlInteger(item, "column", 1);
            const optionalText = (name: string): string | undefined => item[name] === undefined ? undefined : controlString(item, name);
            return new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(file), new vscode.Position(line - 1, column - 1)), controlBoolean(item, "enabled", true), optionalText("condition"), optionalText("hitCondition"), optionalText("logMessage"));
        });
        const key = (item: vscode.SourceBreakpoint): string => `${item.location.uri.toString().toLowerCase()}:${item.location.range.start.line}:${item.location.range.start.character}`;
        const keys = new Set(additions.map(key));
        if (keys.size !== additions.length) { throw new Error("중단점 위치가 중복되었습니다."); }
        const replaced = vscode.debug.breakpoints.filter(item => item instanceof vscode.SourceBreakpoint && keys.has(key(item)));
        vscode.debug.removeBreakpoints(replaced); vscode.debug.addBreakpoints(additions);
        return this.breakpoints();
    }

    private async control(args: Record<string, unknown>): Promise<unknown> {
        const action = controlString(args, "action");
        const isStep = ["continue", "next", "stepIn", "stepOut"].includes(action);
        if (!isStep && !["pause", "stop"].includes(action)) { throw new Error("잘못된 디버그 제어 명령입니다."); }
        const state = this.selected(args, isStep);
        const isLegacyWindows = process.platform === "win32" && Boolean(state.session.configuration.pipeTransport);
        if (action === "stop") {
            if (isLegacyWindows && state.state === "running") { await this.interrupt(state); }
            await vscode.debug.stopDebugging(state.session); return this.state();
        }
        if (action === "pause" && state.state !== "running") { throw new Error("실행 중인 세션만 일시 중지할 수 있습니다."); }
        if (action === "pause" && isLegacyWindows) { await this.interrupt(state); return this.state(); }
        let threadId = args.threadId === undefined ? state.threadId : controlInteger(args, "threadId", 1);
        if (!threadId) {
            const threads = await this.request(state, "threads", {});
            threadId = threads.threads?.[0]?.id;
        }
        if (!threadId) { throw new Error("디버그 스레드를 찾을 수 없습니다."); }
        const previousState = state.state;
        const previousStop = state.stopId;
        if (isStep) { state.state = "running"; state.stopId++; }
        try { await this.request(state, action, { threadId }); }
        catch (error) { if (state.stopId === previousStop + 1) { state.state = previousState; } throw error; }
        return this.state();
    }

    private async interrupt(state: DebugState): Promise<void> {
        if (!state.processId) { throw new Error("디버거가 대상 프로세스 ID를 제공하지 않았습니다."); }
        await interruptDebugProcess(state.processId, state.session.configuration.program);
    }

    public constructor(log: (source: string, text: string) => void) {
        this.log = log;
        this.disposables = [
            ...["cppdbg", "cppvsdbg"].map(type => vscode.debug.registerDebugAdapterTrackerFactory(type, { createDebugAdapterTracker: session => {
                if (!this.isQtSession(session)) { return undefined; }
                const state = this.track(session);
                return { onDidSendMessage: message => this.message(state, message) };
            } })),
            vscode.debug.onDidTerminateDebugSession(session => {
                const state = this.sessions.get(session.id);
                if (state) { state.state = "terminated"; state.stopId++; }
            })
        ];
    }

    public state(): unknown[] {
        return [...this.sessions.values()].map(state => ({ sessionId: state.session.id, name: state.session.name, projectPath: state.session.configuration.qtProProject, state: state.state, stopId: state.stopId, threadId: state.threadId, reason: state.reason, exitCode: state.exitCode, processId: state.processId, verifiedBreakpoints: state.breakpoints }));
    }

    public hasActiveSession(): boolean { return [...this.sessions.values()].some(state => state.state !== "terminated"); }

    public async execute(operation: string, args: Record<string, unknown>): Promise<unknown> {
        if (operation === "qt_list_breakpoints") { return this.breakpoints(); }
        if (operation === "qt_set_breakpoints") { return this.setBreakpoints(args); }
        if (operation === "qt_remove_breakpoints") {
            const ids = args.ids;
            if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) { throw new Error("중단점 ID 목록을 지정하세요."); }
            const selected = vscode.debug.breakpoints.filter(item => ids.includes(item.id));
            if (selected.length !== new Set(ids).size) { throw new Error("중단점 목록이 변경되었습니다. 다시 조회하세요."); }
            vscode.debug.removeBreakpoints(selected); return this.breakpoints();
        }
        if (operation === "qt_debug_control") { return this.control(args); }
        const state = this.selected(args, true);
        switch (operation) {
            case "qt_debug_stack": {
                const threadId = args.threadId === undefined ? state.threadId : controlInteger(args, "threadId", 1);
                if (!threadId) { throw new Error("스레드를 지정하세요."); }
                return this.request(state, "stackTrace", { threadId, startFrame: args.startFrame === undefined ? 0 : controlInteger(args, "startFrame"), levels: args.levels === undefined ? 20 : controlInteger(args, "levels", 1, 200) });
            }
            case "qt_debug_scopes": return this.request(state, "scopes", { frameId: controlInteger(args, "frameId") });
            case "qt_debug_variables": {
                const count = args.count === undefined ? 100 : controlInteger(args, "count", 1, 200);
                const result = await this.request(state, "variables", { variablesReference: controlInteger(args, "variablesReference"), start: args.start === undefined ? 0 : controlInteger(args, "start"), count });
                return { ...result, variables: result.variables?.slice(0, count), truncated: result.variables?.length > count };
            }
            case "qt_debug_evaluate": return this.request(state, "evaluate", { frameId: controlInteger(args, "frameId"), expression: controlString(args, "expression"), context: "watch" });
            default: throw new Error("잘못된 디버그 도구입니다.");
        }
    }

    public dispose(): void { for (const disposable of this.disposables) { disposable.dispose(); } }
}
