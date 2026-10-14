import * as path from "node:path";
import * as vscode from "vscode";

interface ReferenceNode { file: vscode.Uri; locations: vscode.Location[]; location?: vscode.Location; }

export class TXReferenceTree implements vscode.TreeDataProvider<ReferenceNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<ReferenceNode | undefined>();
    private readonly view: vscode.TreeView<ReferenceNode>;
    private locations: vscode.Location[] = [];

    public readonly onDidChangeTreeData = this.changed.event;
    public constructor() { this.view = vscode.window.createTreeView("qtProReferences", { treeDataProvider: this }); }

    public async show(locations: vscode.Location[], title: string): Promise<void> {
        this.locations = locations;
        const files = new Set(locations.map(location => location.uri.toString()));
        this.view.title = title;
        this.view.message = `${files.size}개 파일에서 ${locations.length}개 결과`;
        this.changed.fire(undefined);
        await vscode.commands.executeCommand("setContext", "qtPro.hasReferences", true);
        await vscode.commands.executeCommand("qtProReferences.focus");
    }

    public getChildren(node?: ReferenceNode): ReferenceNode[] {
        if (node?.location) { return []; }
        if (node) { return node.locations.map(location => ({ file: node.file, locations: [], location })); }
        const groups = new Map<string, ReferenceNode>();
        for (const location of this.locations) {
            const key = location.uri.toString();
            const group = groups.get(key) ?? { file: location.uri, locations: [] };
            group.locations.push(location); groups.set(key, group);
        }
        return [...groups.values()];
    }

    public async getTreeItem(node: ReferenceNode): Promise<vscode.TreeItem> {
        if (!node.location) {
            const item = new vscode.TreeItem(path.basename(node.file.fsPath), vscode.TreeItemCollapsibleState.Expanded);
            item.resourceUri = node.file; item.description = `${node.locations.length} · ${path.dirname(node.file.fsPath)}`; item.tooltip = node.file.fsPath;
            return item;
        }
        const document = await vscode.workspace.openTextDocument(node.file);
        const line = document.lineAt(node.location.range.start.line).text.trim();
        const item = new vscode.TreeItem(line, vscode.TreeItemCollapsibleState.None);
        item.description = `${node.location.range.start.line + 1}`;
        item.command = { command: "vscode.open", title: "Open Reference", arguments: [node.file, { selection: node.location.range }] };
        return item;
    }

    public dispose(): void { this.changed.dispose(); this.view.dispose(); }
}
