import * as path from "node:path";
import * as vscode from "vscode";
import { bookmarkFileIdentity } from "./XBookmarkStore";
import type { Bookmark, BookmarkNode } from "./XBookmarkTypes";

export class TXBookmarkTree implements vscode.TreeDataProvider<BookmarkNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<BookmarkNode | undefined>();

    public readonly onDidChangeTreeData = this.changed.event;

    public constructor(private readonly bookmarks: () => Bookmark[]) {}

    public refresh(): void { this.changed.fire(undefined); }

    public getChildren(node?: BookmarkNode): BookmarkNode[] {
        if (!node) {
            const files = new Map(this.bookmarks().map(bookmark => [bookmarkFileIdentity(bookmark.filePath), bookmark.filePath]));
            return [...files.values()].sort((left, right) => left.localeCompare(right)).map(filePath => ({ kind: "file", filePath }));
        }
        if (node.kind === "bookmark") { return []; }
        return this.bookmarks().filter(bookmark => bookmarkFileIdentity(bookmark.filePath) === bookmarkFileIdentity(node.filePath)).sort((left, right) => left.line - right.line).map(bookmark => ({ kind: "bookmark", bookmark }));
    }

    public getParent(node: BookmarkNode): BookmarkNode | undefined {
        return node.kind === "bookmark" ? { kind: "file", filePath: node.bookmark.filePath } : undefined;
    }

    public getTreeItem(node: BookmarkNode): vscode.TreeItem {
        if (node.kind === "file") {
            const item = new vscode.TreeItem(path.basename(node.filePath), vscode.TreeItemCollapsibleState.Expanded);
            item.id = bookmarkFileIdentity(node.filePath);
            item.description = path.dirname(node.filePath);
            item.tooltip = node.filePath;
            item.resourceUri = vscode.Uri.file(node.filePath);
            item.contextValue = "qtProBookmarkFile";
            return item;
        }
        const bookmark = node.bookmark;
        const item = new vscode.TreeItem(bookmark.label || bookmark.text || "(빈 줄)");
        item.id = bookmark.id;
        item.description = `${bookmark.line + 1}행`;
        item.tooltip = `${bookmark.filePath}:${bookmark.line + 1}\n${bookmark.text}`;
        item.iconPath = new vscode.ThemeIcon("bookmark", new vscode.ThemeColor("charts.blue"));
        item.contextValue = "qtProBookmark";
        item.command = { command: "qtPro.openBookmark", title: "북마크로 이동", arguments: [node] };
        return item;
    }

    public dispose(): void { this.changed.dispose(); }
}
