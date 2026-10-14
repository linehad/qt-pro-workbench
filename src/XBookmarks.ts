import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { TXBookmarkTree } from "./XBookmarkTree";
import { bookmarkFileIdentity, loadBookmarks, saveBookmarks } from "./XBookmarkStore";
import { moveBookmarks } from "./XBookmarkPositions";
import type { Bookmark, BookmarkNode } from "./XBookmarkTypes";

export class TXBookmarks implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly tree: TXBookmarkTree;
    private readonly decoration: vscode.TextEditorDecorationType;
    private readonly dirtyFiles = new Set<string>();
    private bookmarks: Bookmark[];
    private timer: NodeJS.Timeout | undefined;

    private register(command: string, action: (...args: any[]) => unknown): void {
        this.disposables.push(vscode.commands.registerCommand(command, async (...args: any[]) => {
            try { return await action(...args); }
            catch (error) { void vscode.window.showErrorMessage(`Qt Pro: ${String(error)}`); }
        }));
    }

    private changed(filePath: string): void {
        this.dirtyFiles.add(bookmarkFileIdentity(filePath));
        this.tree.refresh();
        this.decorate();
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => this.flush(), 200);
    }

    private flush(): void {
        if (!this.dirtyFiles.size) { return; }
        try {
            // Keep bookmarks edited in another VS Code window for unrelated files.
            const others = loadBookmarks(this.storagePath).filter(item => !this.dirtyFiles.has(bookmarkFileIdentity(item.filePath)));
            const updated = this.bookmarks.filter(item => this.dirtyFiles.has(bookmarkFileIdentity(item.filePath)));
            this.bookmarks = [...others, ...updated];
            saveBookmarks(this.storagePath, this.bookmarks);
            this.dirtyFiles.clear();
        } catch (error) { void vscode.window.showErrorMessage(`Qt Pro: 북마크 저장 실패: ${String(error)}`); }
    }

    private decorate(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.scheme !== "file") { editor.setDecorations(this.decoration, []); continue; }
            const key = bookmarkFileIdentity(editor.document.uri.fsPath);
            const rows = this.bookmarks.filter(item => bookmarkFileIdentity(item.filePath) === key);
            const valid = rows.filter(item => item.line < editor.document.lineCount);
            editor.setDecorations(this.decoration, valid.map(item => ({ range: new vscode.Range(item.line, 0, item.line, 0), hoverMessage: `북마크 · ${item.label || item.text}` })));
        }
    }

    private editDocument(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.uri.scheme !== "file") { return; }
        if (!event.contentChanges.length) { return; }
        const filePath = event.document.uri.fsPath;
        const key = bookmarkFileIdentity(filePath);
        const rows = this.bookmarks.filter(item => bookmarkFileIdentity(item.filePath) === key);
        if (!rows.length) { return; }
        const moved = moveBookmarks(rows, event.contentChanges);
        for (const item of moved) { item.text = event.document.lineAt(Math.min(item.line, event.document.lineCount - 1)).text.trim().slice(0, 160); }
        this.bookmarks = this.bookmarks.filter(item => bookmarkFileIdentity(item.filePath) !== key).concat(moved);
        this.changed(filePath);
    }

    private async toggle(target?: vscode.Uri | { uri: vscode.Uri; lineNumber: number }): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        const isMargin = target !== undefined && "lineNumber" in target;
        const uri = isMargin ? target.uri : target ?? editor?.document.uri;
        if (uri?.scheme !== "file") { throw new Error("북마크를 찍을 로컬 파일을 열어 주세요."); }
        const document = await vscode.workspace.openTextDocument(uri);
        const line = isMargin ? target.lineNumber - 1 : editor?.selection.active.line ?? 0;
        if (!Number.isInteger(line) || line < 0) { throw new Error("북마크 줄 번호를 확인하세요."); }
        if (line >= document.lineCount) { throw new Error("파일의 줄 번호 범위를 벗어났습니다."); }
        const filePath = uri.fsPath;
        const key = bookmarkFileIdentity(filePath);
        const found = this.bookmarks.find(item => bookmarkFileIdentity(item.filePath) === key && item.line === line);
        if (found) { this.bookmarks = this.bookmarks.filter(item => item.id !== found.id); }
        else { this.bookmarks.push({ id: crypto.randomUUID(), filePath, line, text: document.lineAt(line).text.trim().slice(0, 160) }); }
        this.changed(filePath);
        this.flush();
    }

    private async open(node: BookmarkNode): Promise<void> {
        if (node.kind !== "bookmark") { return; }
        const item = this.bookmarks.find(bookmark => bookmark.id === node.bookmark.id);
        if (!item) { return; }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.filePath));
        const line = Math.min(item.line, document.lineCount - 1);
        const editor = await vscode.window.showTextDocument(document, { preview: false, selection: new vscode.Range(line, 0, line, 0) });
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private async navigate(direction: number): Promise<void> {
        const ordered = [...this.bookmarks].sort((left, right) => bookmarkFileIdentity(left.filePath).localeCompare(bookmarkFileIdentity(right.filePath)) || left.line - right.line);
        if (!ordered.length) { return; }
        const editor = vscode.window.activeTextEditor;
        const file = editor ? bookmarkFileIdentity(editor.document.uri.fsPath) : "";
        const line = editor?.selection.active.line ?? -1;
        const candidates = direction > 0 ? ordered : [...ordered].reverse();
        const next = candidates.find(item => {
            const comparison = bookmarkFileIdentity(item.filePath).localeCompare(file);
            return comparison === 0 ? (item.line - line) * direction > 0 : comparison * direction > 0;
        }) ?? candidates[0];
        await this.open({ kind: "bookmark", bookmark: next });
    }

    private remove(node: BookmarkNode): void {
        const filePath = node.kind === "bookmark" ? node.bookmark.filePath : node.filePath;
        if (node.kind === "bookmark") { this.bookmarks = this.bookmarks.filter(item => item.id !== node.bookmark.id); }
        else { this.bookmarks = this.bookmarks.filter(item => bookmarkFileIdentity(item.filePath) !== bookmarkFileIdentity(filePath)); }
        this.changed(filePath);
        this.flush();
    }

    private async rename(node: BookmarkNode): Promise<void> {
        if (node.kind !== "bookmark") { return; }
        const item = this.bookmarks.find(bookmark => bookmark.id === node.bookmark.id);
        if (!item) { return; }
        const label = await vscode.window.showInputBox({ title: "북마크 이름", value: item.label ?? "", prompt: "비우면 해당 줄의 코드를 표시합니다." });
        if (label === undefined) { return; }
        item.label = label.trim() || undefined;
        this.changed(item.filePath);
        this.flush();
    }

    private renameFiles(event: vscode.FileRenameEvent): void {
        for (const file of event.files) {
            for (const item of this.bookmarks) {
                const relative = path.relative(file.oldUri.fsPath, item.filePath);
                const outside = relative === ".." || relative.startsWith(`..${path.sep}`);
                if (outside || path.isAbsolute(relative)) { continue; }
                this.dirtyFiles.add(bookmarkFileIdentity(item.filePath));
                item.filePath = path.resolve(file.newUri.fsPath, relative);
                this.changed(item.filePath);
            }
        }
        this.flush();
    }

    public constructor(private readonly storagePath: string, extensionUri: vscode.Uri) {
        this.bookmarks = loadBookmarks(storagePath);
        this.tree = new TXBookmarkTree(() => this.bookmarks);
        this.decoration = vscode.window.createTextEditorDecorationType({ gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", "bookmark.svg"), gutterIconSize: "contain", overviewRulerColor: new vscode.ThemeColor("charts.blue"), overviewRulerLane: vscode.OverviewRulerLane.Right, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed });
        const view = vscode.window.createTreeView("qtProBookmarks", { treeDataProvider: this.tree, showCollapseAll: true });
        this.disposables.push(view, this.tree, this.decoration);
        this.disposables.push(vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()));
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => this.editDocument(event)));
        this.disposables.push(vscode.workspace.onDidRenameFiles(event => this.renameFiles(event)));
        this.register("qtPro.toggleBookmark", target => this.toggle(target));
        this.register("qtPro.openBookmark", node => this.open(node));
        this.register("qtPro.nextBookmark", () => this.navigate(1));
        this.register("qtPro.previousBookmark", () => this.navigate(-1));
        this.register("qtPro.removeBookmark", node => this.remove(node));
        this.register("qtPro.renameBookmark", node => this.rename(node));
        this.decorate();
    }

    public dispose(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.flush();
        for (const disposable of this.disposables) { disposable.dispose(); }
    }
}
