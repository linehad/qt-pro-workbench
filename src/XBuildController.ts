import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { TXProcessTerminal } from "./XProcessTerminal";
import { selectedMakefile } from "./XExistingBuild";
import { recordQmakeState } from "./XQmakeState";
import { prepareCMakeQuery } from "./XCMakeFileApi";
import { validateCMakeCache } from "./XCMakePlan";
import type { BuildOperation, BuildPlan } from "./XProjectTypes";
import type { RunTarget } from "./XRunTypes";

export class TXBuildController {
    private readonly busy = new Set<string>();
    private readonly running = new Set<string>();
    private readonly onOutput?: (source: string, text: string) => void;

    private async runTask(executable: string, argumentsList: string[], plan: BuildPlan, name: string, showWindow = false, reveal = true): Promise<number> {
        const terminal = new TXProcessTerminal({ executable, argumentsList, workingDirectory: plan.buildDirectory, environment: plan.environment, showWindow });
        const output = terminal.onDidWrite(text => this.onOutput?.(name, text));
        const execution = new vscode.CustomExecution(async () => terminal);
        const id = crypto.createHash("sha256").update(`${plan.projectPath.toLowerCase()}\n${name}`).digest("hex");
        const task = new vscode.Task({ type: "qtPro", id }, vscode.TaskScope.Global, name, "Qt Pro", execution);
        task.presentationOptions = { reveal: reveal ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        let finishTask!: () => void;
        const ended = new Promise<void>(resolve => { finishTask = resolve; });
        const listener = vscode.tasks.onDidEndTask(event => { if (event.execution.task.definition.id === id) { finishTask(); } });
        try {
            await vscode.tasks.executeTask(task);
            const exitCode = await terminal.completion;
            await ended;
            return exitCode;
        } finally { listener.dispose(); output.dispose(); }
    }

    private async generateMakefile(plan: BuildPlan): Promise<boolean> {
        if (!fs.existsSync(plan.kit.qmakePath)) { throw new Error(`qmake를 찾을 수 없습니다: ${plan.kit.qmakePath}`); }
        fs.mkdirSync(plan.outputDirectory, { recursive: true });
        const exitCode = await this.runTask(plan.kit.qmakePath, plan.qmakeArguments, plan, `${path.basename(plan.projectPath)}: qmake`);
        if (exitCode !== 0) { vscode.window.showErrorMessage(`qmake 실패 (종료 코드 ${exitCode}). 터미널을 확인하세요.`); return false; }
        recordQmakeState(plan);
        return true;
    }

    private async makeStep(plan: BuildPlan, clean: boolean): Promise<boolean> {
        if (!fs.existsSync(plan.kit.makePath)) { throw new Error(`make를 찾을 수 없습니다: ${plan.kit.makePath}`); }
        const step = clean ? "clean" : "build";
        const makefile = selectedMakefile(plan.buildDirectory, plan.configuration);
        const argumentsList = ["-f", makefile, ...(clean ? plan.cleanArguments ?? ["clean"] : plan.makeArguments)];
        const exitCode = await this.runTask(plan.kit.makePath, argumentsList, plan, `${path.basename(plan.projectPath)}: ${step}`);
        if (exitCode !== 0) { vscode.window.showErrorMessage(`${step} 실패 (종료 코드 ${exitCode}). 터미널을 확인하세요.`); return false; }
        return true;
    }

    private async executeCMake(plan: BuildPlan, operation: BuildOperation): Promise<boolean> {
        if (!plan.cmakePath || !fs.existsSync(plan.cmakePath)) { throw new Error(`CMake를 찾을 수 없습니다: ${plan.cmakePath}`); }
        validateCMakeCache(plan);
        if (operation === "clean" && !fs.existsSync(path.join(plan.buildDirectory, "CMakeCache.txt"))) { return true; }
        const run = async (args: string[], step: string): Promise<boolean> => {
            const code = await this.runTask(plan.cmakePath!, args, plan, `${path.basename(path.dirname(plan.projectPath))}: ${step}`);
            if (code !== 0) { vscode.window.showErrorMessage(`CMake ${step} 실패 (종료 코드 ${code}). 터미널을 확인하세요.`); }
            return code === 0;
        };
        if (operation !== "clean") {
            prepareCMakeQuery(plan.buildDirectory);
            if (!await run(plan.qmakeArguments, "configure")) { return false; }
        }
        if (operation === "clean" || operation === "rebuild") {
            if (!await run(plan.cleanArguments ?? [], "clean")) { return false; }
        }
        if (operation === "build" || operation === "rebuild") {
            if (!await run(plan.makeArguments, "build")) { return false; }
        }
        vscode.window.showInformationMessage(`CMake ${operation === "qmake" ? "configure" : operation} 완료: ${path.basename(path.dirname(plan.projectPath))}`);
        return true;
    }

    public constructor(onOutput?: (source: string, text: string) => void) { this.onOutput = onOutput; }

    public async execute(plan: BuildPlan, operation: BuildOperation): Promise<boolean> {
        if (this.busy.has(plan.projectPath)) { vscode.window.showInformationMessage("이 프로젝트는 이미 빌드 작업 중입니다."); return false; }
        if (!vscode.workspace.isTrusted) { throw new Error("프로젝트를 신뢰한 후 빌드 작업을 실행하세요. 파일 목록은 신뢰하지 않아도 볼 수 있습니다."); }
        this.busy.add(plan.projectPath);
        try {
            if (plan.buildSystem === "cmake") { return await this.executeCMake(plan, operation); }
            const hasMakefile = fs.existsSync(path.join(plan.buildDirectory, selectedMakefile(plan.buildDirectory, plan.configuration)));
            if (operation === "clean" || operation === "rebuild") {
                if (hasMakefile) {
                    if (!await this.makeStep(plan, true)) { return false; }
                } else if (operation === "clean") {
                    vscode.window.showInformationMessage("이 구성에는 Makefile이 없어 정리할 빌드가 없습니다.");
                    return true;
                }
            }
            const needsQmake = operation === "qmake" || operation === "rebuild";
            const missingBuild = !hasMakefile || plan.needsQmake === true;
            const initializeBuild = operation === "build" && missingBuild;
            if (needsQmake || initializeBuild) {
                if (!await this.generateMakefile(plan)) { return false; }
            }
            if (operation === "build" || operation === "rebuild") {
                if (!await this.makeStep(plan, false)) { return false; }
                recordQmakeState(plan);
            }
            vscode.window.showInformationMessage(`${operation} 완료: ${path.basename(plan.projectPath)} · ${plan.kit.name}`);
            return true;
        } finally { this.busy.delete(plan.projectPath); }
    }

    public async build(plan: BuildPlan): Promise<boolean> { return this.execute(plan, "build"); }

    public async run(plan: BuildPlan, target: RunTarget): Promise<boolean> {
        if (!vscode.workspace.isTrusted) { throw new Error("프로젝트를 신뢰한 후 실행하세요."); }
        const { executable, argumentsList, workingDirectory } = target;
        if (!fs.existsSync(executable)) { throw new Error(`실행 파일을 찾을 수 없습니다: ${executable}`); }
        const key = path.resolve(executable).toLowerCase();
        if (this.running.has(key)) { vscode.window.showInformationMessage("이 프로그램은 이미 실행 중입니다. 실행 터미널에서 중지한 뒤 다시 실행하세요."); return false; }
        this.running.add(key);
        try {
            const exitCode = await this.runTask(executable, argumentsList, { ...plan, buildDirectory: workingDirectory, environment: target.environment ?? plan.environment }, `${path.basename(executable)}: run`, true, target.runInTerminal ?? true);
            if (exitCode !== 0) { vscode.window.showErrorMessage(`프로그램 종료 코드: ${exitCode}. 터미널을 확인하세요.`); }
            return exitCode === 0;
        } finally { this.running.delete(key); }
    }
}
