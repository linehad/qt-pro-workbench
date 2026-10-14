import * as path from "node:path";
import * as vscode from "vscode";
import { isCMakeProject, projectName } from "./XProjectIdentity";
import type { BuildOperation } from "./XProjectTypes";

const BUILD_ACTIONS: { label: string; description: string; operation: BuildOperation | "deploy" }[] = [
    { label: "Build", description: "변경된 파일 빌드", operation: "build" },
    { label: "Run qmake", description: "Makefile 생성·갱신", operation: "qmake" },
    { label: "Clean", description: "Makefile 규칙에 따라 산출물 정리", operation: "clean" },
    { label: "Rebuild", description: "Clean → qmake → Build", operation: "rebuild" },
    { label: "Deploy", description: "Build → 선택한 배포 구성의 복사 단계", operation: "deploy" }
];

export class TXBuildActions implements vscode.Disposable {
    private readonly build = vscode.window.createStatusBarItem("qtPro.build", vscode.StatusBarAlignment.Left, 28);
    private readonly actions = vscode.window.createStatusBarItem("qtPro.buildActions", vscode.StatusBarAlignment.Left, 27);

    private actionsFor(projectPath: string): typeof BUILD_ACTIONS {
        if (!isCMakeProject(projectPath)) { return BUILD_ACTIONS; }
        return BUILD_ACTIONS.map(item => {
            if (item.operation === "qmake") { return { ...item, label: "CMake Configure", description: "CMake 빌드 시스템 생성·갱신" }; }
            if (item.operation === "rebuild") { return { ...item, description: "Configure → Clean → Build" }; }
            if (item.operation === "clean") { return { ...item, description: "CMake clean 대상 실행" }; }
            return item;
        });
    }

    public constructor() {
        this.build.name = "Qt Pro: Build";
        this.build.command = "qtPro.build";
        this.actions.name = "Qt Pro: Build Actions";
        this.actions.text = "$(chevron-down)";
        this.actions.command = "qtPro.buildActions";
    }

    public update(projectPath?: string, configuration?: string, kitName?: string): void {
        if (!projectPath) { this.build.hide(); this.actions.hide(); return; }
        const target = `${path.basename(projectPath)} · ${configuration} · ${kitName ?? "키트 미선택"}`;
        const label = isCMakeProject(projectPath) ? projectName(projectPath) : path.basename(projectPath);
        this.build.text = `$(tools) ${label} 빌드`;
        this.build.tooltip = `${label} 빌드`;
        this.actions.tooltip = `${target}\nBuild / Configure / Clean / Rebuild / Deploy`;
        this.build.show(); this.actions.show();
    }

    public async show(projectPath: string, configuration: string): Promise<boolean | undefined> {
        const choice = await vscode.window.showQuickPick(this.actionsFor(projectPath), { title: `${path.basename(projectPath)} · ${configuration}`, placeHolder: "빌드 작업 선택" });
        if (!choice) { return undefined; }
        return vscode.commands.executeCommand<boolean>(`qtPro.${choice.operation}`, vscode.Uri.file(projectPath));
    }

    public dispose(): void { this.build.dispose(); this.actions.dispose(); }
}
