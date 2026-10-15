import * as vscode from "vscode";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { TXDebugControl } from "./XDebugControl";
import { controlBoolean, controlInteger, controlPath, controlString } from "./XControlValidation";
import { CONTROL_OPERATIONS, validateToolArguments } from "./XControlCatalog";
import type { ControlJob, ControlLog, ControlRequest, WorkbenchControlInfo } from "./XControlTypes";

export class TXWorkbenchControl implements vscode.Disposable {
    private readonly info: WorkbenchControlInfo;
    private readonly debug: TXDebugControl;
    private readonly jobs = new Map<string, ControlJob>();
    private readonly logs: ControlLog[] = [];
    private cursor = 0;
    private writes = Promise.resolve();

    private hasJob(): boolean { return [...this.jobs.values()].some(job => job.status === "running"); }

    private startJob(operation: string, execute: () => Promise<unknown>): ControlJob {
        if (this.hasJob()) { throw new Error("이 창의 작업이 진행 중입니다. qt_get_job으로 결과를 확인하세요."); }
        const job: ControlJob = { id: randomUUID(), operation, status: "running", startedAt: new Date().toISOString() };
        this.jobs.set(job.id, job);
        for (const id of [...this.jobs.keys()].slice(0, Math.max(0, this.jobs.size - 30))) { this.jobs.delete(id); }
        void Promise.resolve().then(execute).then(result => {
            job.result = result; job.status = result === false ? "failed" : "succeeded";
            if (result === false) { job.error = "작업 실패. qt_get_log에서 빌드 또는 디버그 오류를 확인하세요."; }
        }, error => { job.status = "failed"; job.error = String(error); }).finally(() => {
            job.finishedAt = new Date().toISOString(); this.recordLog("job", JSON.stringify(job));
        });
        return { ...job };
    }

    private state(): unknown {
        const state = this.info.state();
        const builds = state.builds ? { activeId: state.builds.activeId, items: state.builds.items.map(item => ({ id: item.id, name: item.name, configuration: item.configuration })) } : undefined;
        const runs = state.runs ? { activeId: state.runs.activeId, items: state.runs.items.map(item => ({ id: item.id, name: item.name, kind: item.kind, executable: item.executable })) } : undefined;
        return { buildSystem: state.buildSystem, buildDirectory: state.buildDirectory, automaticExecutable: state.automaticExecutable, projects: state.projects, activeProject: state.activeProject, kitId: state.kitId, kitName: state.kitName, kits: state.kits, configuration: state.configuration, builds, runs, debug: this.debug.state(), jobs: [...this.jobs.values()], workspace: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [], trusted: vscode.workspace.isTrusted };
    }

    private async dispatch(operation: string, args: Record<string, unknown>): Promise<unknown> {
        if (operation === "qt_get_state") { return this.state(); }
        if (operation.startsWith("qt_git_")) {
            if (!this.info.git) { throw new Error("이 창에서는 Git 이력 제어를 사용할 수 없습니다."); }
            return this.info.git(operation, args);
        }
        if (operation === "qt_get_job") {
            const job = this.jobs.get(controlString(args, "jobId"));
            if (!job) { throw new Error("이 창의 작업 ID를 지정하세요."); }
            return { ...job };
        }
        if (operation === "qt_get_log") {
            const after = args.afterCursor === undefined ? 0 : controlInteger(args, "afterCursor");
            const limit = args.limit === undefined ? 30 : controlInteger(args, "limit", 1, 100);
            const entries = this.logs.filter(item => item.cursor > after).slice(0, limit);
            return { entries, nextCursor: entries.at(-1)?.cursor ?? after, oldestCursor: this.logs[0]?.cursor ?? this.cursor, latestCursor: this.cursor };
        }
        if (operation.startsWith("qt_debug_") || operation.endsWith("breakpoints")) { return this.debug.execute(operation, args); }
        if (!vscode.workspace.isTrusted) { throw new Error("VS Code에서 프로젝트를 신뢰한 후 제어하세요."); }
        if (this.hasJob()) { throw new Error("빌드/디버그 시작 작업 중에는 선택을 변경할 수 없습니다."); }
        if (operation === "qt_select_project") {
            const project = controlPath(args, "projectPath");
            await this.info.openProject(project); return this.state();
        }
        const state = this.info.state();
        if (operation === "qt_close_project") {
            const requested = controlPath(args, "projectPath");
            const project = state.projects.find(item => path.resolve(item.projectPath).toLowerCase() === requested.toLowerCase());
            if (!project) { throw new Error("qt_get_state.projects에 있는 열린 프로젝트 경로를 지정하세요."); }
            if (!this.info.closeProject) { throw new Error("이 창에서는 프로젝트 닫기를 사용할 수 없습니다."); }
            await this.info.closeProject(project.projectPath);
            return this.state();
        }
        if (!state.activeProject) { throw new Error("qt_select_project로 프로젝트를 먼저 선택하세요."); }
        if (operation === "qt_select_kit") { await this.info.select({ field: "kit", value: controlString(args, "kitId") }); return this.state(); }
        if (!state.kitId) { throw new Error("qt_select_kit으로 키트를 먼저 선택하세요."); }
        if (operation === "qt_select_build_configuration" || operation === "qt_select_run_configuration") {
            const field = operation === "qt_select_build_configuration" ? "build" : "run";
            await this.info.select({ field, change: { action: "select", id: controlString(args, "configurationId") } }); return this.state();
        }
        if (operation === "qt_build") { return this.startJob(operation, () => this.info.build(state.activeProject!, controlString(args, "operation"))); }
        if (operation === "qt_start_debug") {
            if (this.debug.hasActiveSession()) { throw new Error("이 창의 Qt 디버그 세션을 종료한 뒤 새 세션을 시작하세요."); }
            return this.startJob(operation, () => this.info.debug(state.activeProject!, controlBoolean(args, "stopAtEntry", false)));
        }
        throw new Error("알 수 없는 Qt Pro 제어 도구입니다.");
    }

    public constructor(info: WorkbenchControlInfo) { this.info = info; this.debug = new TXDebugControl((source, text) => this.recordLog(source, text)); }

    public recordLog(source: string, text: string): void {
        this.logs.push({ cursor: ++this.cursor, time: new Date().toISOString(), source, text: text.slice(0, 8192) });
        if (this.logs.length > 300) { this.logs.shift(); }
    }

    public async execute(request: ControlRequest): Promise<unknown> {
        const tool = CONTROL_OPERATIONS.find(item => item.name === request.operation);
        if (!tool || tool.name === "qt_list_instances") { throw new Error("알 수 없는 Qt Pro 도구입니다."); }
        // The authenticated pipe supplies window identity; callers cannot execute arbitrary commands.
        validateToolArguments(tool.inputSchema, { instanceId: "local", ...request.arguments });
        const readOnly = tool.annotations.readOnlyHint;
        if (readOnly) { return this.dispatch(request.operation, request.arguments); }
        if (!vscode.workspace.isTrusted) { throw new Error("VS Code에서 프로젝트를 신뢰한 후 제어하세요."); }
        const next = this.writes.then(() => this.dispatch(request.operation, request.arguments));
        this.writes = next.then(() => undefined, () => undefined);
        return next;
    }

    public dispose(): void { this.debug.dispose(); }
}
