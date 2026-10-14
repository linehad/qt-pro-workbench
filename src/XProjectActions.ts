import * as vscode from "vscode";

export class TXProjectActions implements vscode.Disposable {
    private readonly run = vscode.window.createStatusBarItem("qtPro.run", vscode.StatusBarAlignment.Left, 26);
    private readonly debug = vscode.window.createStatusBarItem("qtPro.debug", vscode.StatusBarAlignment.Left, 25);

    public constructor() {
        this.run.name = "Qt Pro: Run";
        this.run.text = "$(play)";
        this.run.tooltip = "실행(CTRL + F5)";
        this.run.command = "qtPro.run";
        this.debug.name = "Qt Pro: Debug";
        this.debug.text = "$(debug-alt)";
        this.debug.tooltip = "디버그 실행(F5)";
        this.debug.command = "qtPro.debug";
    }

    public update(projectPath?: string): void {
        if (!projectPath) { this.run.hide(); this.debug.hide(); return; }
        this.run.show(); this.debug.show();
    }

    public dispose(): void { this.run.dispose(); this.debug.dispose(); }
}
