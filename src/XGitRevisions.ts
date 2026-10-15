import * as path from "node:path";
import * as vscode from "vscode";
import type { TXGitRepository } from "./XGitRepository";
import type { GitRevision } from "./XGitTypes";

export class TXGitRevisions implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly registration: vscode.Disposable;

    public constructor(private readonly repository: TXGitRepository) { this.registration = vscode.workspace.registerTextDocumentContentProvider("qt-pro-git", this); }

    public uri(info: GitRevision): vscode.Uri {
        return vscode.Uri.from({ scheme: "qt-pro-git", path: "/" + path.basename(info.filePath), query: JSON.stringify(info) });
    }

    public provideTextDocumentContent(uri: vscode.Uri): Promise<string> { return this.repository.revision(JSON.parse(uri.query) as GitRevision); }

    public dispose(): void { this.registration.dispose(); }
}
