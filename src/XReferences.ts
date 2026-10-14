import * as fs from "node:fs";
import * as vscode from "vscode";
import { referenceFiles, referenceProjects, sourceIdentity } from "./XReferenceScope";
import { prepareReferenceWorkspace } from "./XReferenceWorkspace";
import { TXReferenceTree } from "./XReferenceTree";
import type { ProjectData } from "./XProjectTypes";

interface ReferencesInfo {
    storage: string;
    projects: () => string[];
    getProject: (project: string) => ProjectData;
    activeProject: () => string | undefined;
}

export class TXReferences implements vscode.Disposable {
    private readonly tree = new TXReferenceTree();
    private previous: { file: vscode.Uri; position: vscode.Position } | undefined;

    private async find(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> {
        const projects = referenceProjects(this.info.projects(), this.info.getProject);
        const files = referenceFiles(projects, uri.fsPath);
        if (!files.size) { throw new Error("현재 파일이 포함된 .pro 또는 CMake 프로젝트를 Qt Projects에서 열어 주세요."); }
        const reference = { file: uri.fsPath, line: position.line, character: position.character };
        if (await prepareReferenceWorkspace(this.info.storage, projects, this.info.activeProject(), reference)) { return []; }
        const locations = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", uri, position) ?? [];
        // Exact project membership and repository identity exclude closed projects and duplicate roots.
        const result = locations.filter(location => files.has(sourceIdentity(location.uri.fsPath)));
        const unique = new Map(result.map(location => [JSON.stringify([sourceIdentity(location.uri.fsPath), location.range.start.line, location.range.start.character]), location]));
        const references = [...unique.values()];
        await this.tree.show(references, "참조: 열린 프로젝트");
        return references;
    }

    public constructor(private readonly info: ReferencesInfo) {}

    public async findReferences(uri?: vscode.Uri, position?: vscode.Position): Promise<vscode.Location[]> {
        const editor = vscode.window.activeTextEditor;
        const file = uri ?? editor?.document.uri;
        const location = position ?? editor?.selection.active;
        if (!file || !location) { return []; }
        this.previous = { file, position: location };
        return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "열린 프로젝트의 참조 검색" }, () => this.find(file, location));
    }

    public async refresh(): Promise<vscode.Location[]> { return this.previous ? this.findReferences(this.previous.file, this.previous.position) : []; }

    public async findName(requested?: string): Promise<vscode.Location[]> {
        const editor = vscode.window.activeTextEditor;
        const range = editor?.document.getWordRangeAtPosition(editor.selection.active);
        const name = requested ?? await vscode.window.showInputBox({ title: "열린 프로젝트에서 이름 검색", value: range ? editor!.document.getText(range) : "" });
        if (!name?.trim()) { return []; }
        const files = referenceFiles(referenceProjects(this.info.projects(), this.info.getProject));
        const locations: vscode.Location[] = [];
        for (const file of files) {
            if (!fs.existsSync(file)) { continue; }
            const document = vscode.workspace.textDocuments.find(item => sourceIdentity(item.fileName) === file);
            const text = document?.getText() ?? fs.readFileSync(file, "utf8");
            const uri = vscode.Uri.file(file);
            const positionAt = (offset: number): vscode.Position => {
                const lines = text.slice(0, offset).split("\n");
                return new vscode.Position(lines.length - 1, lines.at(-1)!.length);
            };
            let offset = text.indexOf(name);
            while (offset >= 0) {
                locations.push(new vscode.Location(uri, new vscode.Range(positionAt(offset), positionAt(offset + name.length))));
                offset = text.indexOf(name, offset + name.length);
            }
        }
        await this.tree.show(locations, `이름 검색: ${name}`);
        return locations;
    }

    public dispose(): void { this.tree.dispose(); }
}
