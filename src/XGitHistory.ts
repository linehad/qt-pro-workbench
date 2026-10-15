import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { TXGitRepository, gitRelativePath } from "./XGitRepository";
import { TXGitRevisions } from "./XGitRevisions";
import { TXGitHistoryView } from "./XGitHistoryView";
import { detectGitEncoding } from "./XGitEncoding";
import { controlInteger, controlPath, controlString } from "./XControlValidation";
import type { GitCommit, GitRevision } from "./XGitTypes";
import type { ProjectCommandTarget } from "./XProjectTreeTypes";

interface CommitViewRequest { file: string; repositoryRoot: string; commit: GitCommit; action: string; viewColumn?: vscode.ViewColumn; }

export class TXGitHistory implements vscode.Disposable {
    private readonly repository: TXGitRepository;
    private readonly revisions: TXGitRevisions;
    private readonly views = new Map<string, TXGitHistoryView>();

    private target(target: ProjectCommandTarget | undefined, fallback?: string): string {
        if (target && "scheme" in target) {
            if (target.scheme !== "file") { throw new Error("로컬 파일을 선택하세요."); }
            return target.fsPath;
        }
        const file = target ? target.directoryPath ?? target.filePath ?? target.partPath ?? target.projectPath : fallback;
        if (!file) { throw new Error("Git 이력을 볼 프로젝트 또는 소스 파일을 선택하세요."); }
        return path.resolve(file);
    }

    private requireTrust(): void { if (!vscode.workspace.isTrusted) { throw new Error("VS Code에서 프로젝트를 신뢰한 후 Git 이력을 확인하세요."); } }

    private historyTarget(target?: ProjectCommandTarget): string {
        if (target && "kind" in target) {
            if (target.kind === "project") { return path.dirname(target.projectPath); }
            if (target.kind === "include" && target.partPath) { return path.dirname(target.partPath); }
        }
        return this.target(target, vscode.window.activeTextEditor?.document.uri.scheme === "file" ? vscode.window.activeTextEditor.document.uri.fsPath : undefined);
    }

    private async encoding(file: string): Promise<string> {
        const uri = vscode.Uri.file(file);
        const document = vscode.workspace.textDocuments.find(item => item.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase());
        const preferred = document?.encoding || vscode.workspace.getConfiguration("files", uri).get<string>("encoding", "utf8");
        try { return detectGitEncoding(await fs.promises.readFile(file), preferred); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
            return preferred;
        }
    }

    private async workingUri(file: string, encoding: string): Promise<vscode.Uri> {
        const uri = vscode.Uri.file(file);
        const document = vscode.workspace.textDocuments.find(item => item.uri.fsPath.toLowerCase() === uri.fsPath.toLowerCase());
        // Reopening with an encoding can discard dirty text; only reload clean documents.
        if (document?.isDirty) { return uri; }
        if (document?.encoding !== encoding) { await vscode.workspace.openTextDocument(uri, { encoding }); }
        return uri;
    }

    private async viewCommit(request: CommitViewRequest): Promise<{ left?: string; right: string }> {
        this.requireTrust();
        const { file, repositoryRoot, commit, action } = request;
        const info: GitRevision = { repositoryRoot, hash: commit.hash, filePath: commit.filePath!, encoding: await this.encoding(file), empty: commit.change === "D" };
        const current = this.revisions.uri(info);
        if (action === "revision") { await vscode.window.showTextDocument(current, { preview: true, viewColumn: request.viewColumn }); return { right: current.toString() }; }
        const previous = this.revisions.uri({ ...info, hash: commit.parents[0] ?? commit.hash, filePath: commit.previousPath!, empty: commit.change === "A" || !commit.parents.length });
        const left = action === "working" ? current : previous;
        const right = action === "working" ? await this.workingUri(file, info.encoding) : current;
        const before = commit.change === "A" || !commit.parents.length ? "없음" : commit.parents[0].slice(0, 8);
        const label = action === "working" ? `${path.basename(file)} (${commit.hash.slice(0, 8)}) ↔ 현재 파일` : `${path.basename(file)} · 수정 전 (${before}) ↔ 수정 후 (${commit.hash.slice(0, 8)})`;
        await vscode.commands.executeCommand("vscode.diff", left, right, label, { preview: true, viewColumn: request.viewColumn ?? vscode.ViewColumn.Active });
        return { left: left.toString(), right: right.toString() };
    }

    public constructor(private readonly extensionUri: vscode.Uri) {
        const configured = vscode.workspace.getConfiguration("git").get<string | string[]>("path");
        const executable = Array.isArray(configured) ? configured.find(file => fs.existsSync(file)) : configured;
        this.repository = new TXGitRepository(executable || "git");
        this.revisions = new TXGitRevisions(this.repository);
    }

    public async showGraph(target?: ProjectCommandTarget, fallback?: string): Promise<{ repositoryRoot: string }> {
        this.requireTrust();
        const repositoryRoot = await this.repository.root(this.target(target, fallback));
        const graph = vscode.extensions.getExtension("mhutchie.git-graph");
        if (!graph) { throw new Error("Git Graph 확장을 설치한 후 Git Graph 보기를 실행하세요."); }
        await graph.activate();
        // The SCM root argument registers the repository even in a folderless window.
        await vscode.commands.executeCommand("git-graph.view", { rootUri: vscode.Uri.file(repositoryRoot) });
        return { repositoryRoot };
    }

    public async showFileHistory(target?: ProjectCommandTarget): Promise<{ file: string; repositoryRoot: string; opened: boolean }> {
        this.requireTrust();
        const file = this.historyTarget(target);
        const repositoryRoot = await this.repository.root(file);
        const isDirectory = fs.existsSync(file) && fs.statSync(file).isDirectory();
        const key = path.resolve(file).toLowerCase();
        const existing = this.views.get(key);
        if (existing) { existing.reveal(); return { file, repositoryRoot, opened: true }; }
        let view: TXGitHistoryView;
        view = new TXGitHistoryView({
            extensionUri: this.extensionUri, file, repositoryRoot, isDirectory,
            load: async skip => { this.requireTrust(); return this.repository.history(file, true, skip); },
            message: async hash => { this.requireTrust(); return this.repository.message(repositoryRoot, hash); },
            open: (commit, action) => this.viewCommit({ file: isDirectory ? path.resolve(repositoryRoot, commit.filePath!) : file, repositoryRoot, commit, action, viewColumn: view.viewColumn }),
            openLatest: filePath => this.showLatestDiff(vscode.Uri.file(isDirectory ? path.resolve(repositoryRoot, filePath!) : file), view.viewColumn),
            onDispose: () => this.views.delete(key)
        });
        this.views.set(key, view);
        return { file, repositoryRoot, opened: true };
    }

    public async showLatestDiff(target?: ProjectCommandTarget, viewColumn?: vscode.ViewColumn): Promise<{ repositoryRoot: string; file: string; revision: string; left: string; right: string; opened: boolean }> {
        this.requireTrust();
        const file = this.target(target, vscode.window.activeTextEditor?.document.uri.scheme === "file" ? vscode.window.activeTextEditor.document.uri.fsPath : undefined);
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) { throw new Error("최신 커밋과 비교할 파일을 선택하세요."); }
        const info = await this.repository.latest(file, await this.encoding(file));
        const left = this.revisions.uri(info);
        const right = await this.workingUri(file, info.encoding);
        await vscode.commands.executeCommand("vscode.diff", left, right, `${path.basename(file)} · 최신 커밋 (${info.hash.slice(0, 8)}) ↔ 현재 파일`, { preview: true, viewColumn: viewColumn ?? vscode.ViewColumn.Active });
        return { repositoryRoot: info.repositoryRoot, file, revision: info.hash, left: left.toString(), right: right.toString(), opened: true };
    }

    public async control(operation: string, args: Record<string, unknown>, activeProject?: string): Promise<unknown> {
        this.requireTrust();
        if (operation === "qt_git_show_graph") { return this.showGraph(undefined, args.projectPath === undefined ? activeProject : controlPath(args, "projectPath")); }
        const file = args.file === undefined ? (args.projectPath === undefined ? activeProject : controlPath(args, "projectPath")) : controlPath(args, "file");
        if (!file) { throw new Error("Git 이력을 볼 file 또는 projectPath를 지정하세요."); }
        if (operation === "qt_git_compare_latest") { return this.showLatestDiff(vscode.Uri.file(file)); }
        if (operation === "qt_git_show_file_history") {
            return this.showFileHistory(vscode.Uri.file(file));
        }
        if (operation === "qt_git_history") { return this.repository.history(file, args.file !== undefined, args.skip === undefined ? 0 : controlInteger(args, "skip"), args.limit === undefined ? 100 : controlInteger(args, "limit", 1, 200)); }
        if (operation === "qt_git_open_diff") {
            const selected = await this.repository.commit(file, controlString(args, "revision"), args.historicalPath === undefined ? undefined : controlString(args, "historicalPath"));
            const comparison = await this.viewCommit({ file, repositoryRoot: selected.repositoryRoot, commit: selected.commit, action: args.comparison === undefined ? "previous" : controlString(args, "comparison") });
            return { repositoryRoot: selected.repositoryRoot, file, revision: selected.commit.hash, ...comparison, opened: true };
        }
        const canReadRevision = operation === "qt_git_read_revision" || operation === "qt_git_open_revision";
        if (!canReadRevision) { throw new Error("알 수 없는 Git 이력 작업입니다."); }
        const repositoryRoot = await this.repository.root(file);
        const relative = args.historicalPath === undefined ? gitRelativePath(repositoryRoot, file) : controlString(args, "historicalPath");
        if (path.isAbsolute(relative)) { throw new Error("historicalPath는 저장소 기준 상대 경로를 지정하세요."); }
        const info: GitRevision = { repositoryRoot, filePath: relative, hash: controlString(args, "revision"), encoding: await this.encoding(file) };
        if (operation === "qt_git_open_revision") {
            const uri = this.revisions.uri(info);
            await vscode.window.showTextDocument(uri, { preview: true });
            return { repositoryRoot, filePath: relative, revision: info.hash, uri: uri.toString(), opened: true };
        }
        return { repositoryRoot, filePath: relative, revision: info.hash, text: await this.repository.revision(info) };
    }

    public dispose(): void { for (const view of this.views.values()) { view.dispose(); } this.revisions.dispose(); }
}
