import * as path from "node:path";
import * as vscode from "vscode";
import type { TXProjectTree } from "./XProjectTree";
import type { ProjectNode } from "./XProjectTreeTypes";

export class TXProjectNavigation implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private timer: NodeJS.Timeout | undefined;
    private pending = Promise.resolve();
    private generation = 0;
    private isDisposed = false;

    private schedule(): void {
        ++this.generation;
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => { void this.reveal(false); }, 60);
    }

    private updateContext(): void {
        void vscode.commands.executeCommand("setContext", "qtPro.autoReveal", vscode.workspace.getConfiguration("qtPro").get("autoReveal", true));
    }

    public constructor(private readonly tree: TXProjectTree, private readonly view: vscode.TreeView<ProjectNode>, private readonly reportError: (error: unknown) => void) {
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.schedule()));
        this.disposables.push(tree.onDidChangeTreeData(() => this.schedule()));
        this.disposables.push(view.onDidChangeVisibility(event => { if (event.visible) { this.schedule(); } }));
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("qtPro.autoReveal")) { this.updateContext(); this.schedule(); }
        }));
        this.updateContext();
        this.schedule();
    }

    public async toggle(): Promise<void> {
        const settings = vscode.workspace.getConfiguration("qtPro");
        await settings.update("autoReveal", !settings.get("autoReveal", true), vscode.ConfigurationTarget.Global);
    }

    public reveal(force = true): Promise<void> {
        const generation = ++this.generation;
        this.pending = this.pending.then(async () => {
            if (this.isDisposed || generation !== this.generation) { return; }
            if (!force && !this.view.visible) { return; }
            if (!force && !vscode.workspace.getConfiguration("qtPro").get("autoReveal", true)) { return; }
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (uri?.scheme !== "file") { return; }
            const node = this.tree.findFile(path.resolve(uri.fsPath), this.view.selection[0]);
            if (node) { await this.view.reveal(node, { select: true, focus: false, expand: false }); }
        }).catch(this.reportError);
        return this.pending;
    }

    public dispose(): void {
        this.isDisposed = true;
        if (this.timer) { clearTimeout(this.timer); }
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
