import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { TXProjectParser } from "./XProjectParser";
import { isCMakeProject, isProjectFile, projectName } from "./XProjectIdentity";
import { parseCMakeProject } from "./XCMakeProject";
import { folderChildren, projectNodeId } from "./XProjectFolders";
import { partChildren } from "./XProjectNodes";
import { findProjectFile } from "./XProjectFileSearch";
import type { ProjectData, BuildPlan } from "./XProjectTypes";
import type { ProjectNode } from "./XProjectTreeTypes";

export class TXProjectTree implements vscode.TreeDataProvider<ProjectNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<ProjectNode | undefined>();
    private readonly cache = new Map<string, ProjectData>();
    private readonly cmakePlans = new Map<string, BuildPlan>();
    private readonly watches = new Map<string, () => void>();
    private readonly parents = new Map<string, ProjectNode | undefined>();
    private readonly decorations = vscode.window.registerFileDecorationProvider({
        provideFileDecoration: uri => uri.query === "qtProInactive=1" ? { color: new vscode.ThemeColor("disabledForeground"), tooltip: "이 .pri 조건에서 비활성인 파일" } : undefined
    });
    private roots: string[] = [];
    private timer: NodeJS.Timeout | undefined;
    private activePath: string | undefined;

    private watch(data: ProjectData): void {
        for (const filePath of data.watchedPaths) {
            if (this.watches.has(filePath)) { continue; }
            const listener = (): void => {
                if (this.timer) { clearTimeout(this.timer); }
                this.timer = setTimeout(() => this.refresh(), 350);
            };
            fs.watchFile(filePath, { interval: 1200, persistent: false }, listener);
            this.watches.set(filePath, listener);
        }
    }

    private clearWatches(): void {
        for (const [filePath, listener] of this.watches) { fs.unwatchFile(filePath, listener); }
        this.watches.clear();
    }

    private projectNode(projectPath: string, ancestors: string[] = []): ProjectNode {
        return { kind: "project", label: projectName(projectPath), projectPath, ancestors };
    }

    public readonly onDidChangeTreeData = this.changed.event;

    public constructor(projects: string[] = [], private readonly cmakePlan?: (project: string) => BuildPlan | undefined) {
        this.roots = [...projects];
    }

    public projects(): string[] { return [...this.roots]; }

    public getProject(projectPath: string): ProjectData {
        let data = this.cache.get(projectPath);
        if (!data) {
            const plan = isCMakeProject(projectPath) ? this.cmakePlan?.(projectPath) ?? this.cmakePlans.get(projectPath) : undefined;
            data = isCMakeProject(projectPath) ? parseCMakeProject(projectPath, plan) : new TXProjectParser().parse(projectPath);
            this.cache.set(projectPath, data); this.watch(data);
        }
        return data;
    }

    public setCMakePlan(plan: BuildPlan): void {
        if (plan.buildSystem !== "cmake") { return; }
        this.cmakePlans.set(plan.projectPath, plan);
        this.refresh();
    }

    public add(projectPath: string): void {
        if (!this.roots.includes(projectPath)) { this.roots.push(projectPath); }
        this.activePath = projectPath;
        this.changed.fire(undefined);
    }

    public remove(projectPath: string): void {
        this.roots = this.roots.filter(item => item !== projectPath);
        this.refresh();
    }

    public setActive(projectPath: string): void { this.activePath = projectPath; this.changed.fire(undefined); }

    public refresh(): void {
        this.cache.clear(); this.parents.clear(); this.clearWatches(); this.changed.fire(undefined);
    }

    public findFile(filePath: string, selected?: ProjectNode): ProjectNode | undefined {
        const preferred = selected ?? (this.activePath ? this.projectNode(this.activePath) : undefined);
        return findProjectFile(this.getChildren(), node => this.getChildren(node), filePath, preferred);
    }

    public getParent(node: ProjectNode): ProjectNode | undefined { return this.parents.get(projectNodeId(node)); }

    public getTreeItem(node: ProjectNode): vscode.TreeItem {
        if (node.kind === "file") {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.id = projectNodeId(node);
            const fileUri = vscode.Uri.file(node.filePath!);
            item.contextValue = "qtProSourceFile";
            if (node.filePath && isProjectFile(node.filePath)) { item.contextValue = "qtProProjectFile"; }
            item.resourceUri = node.isInactive ? fileUri.with({ query: "qtProInactive=1" }) : fileUri;
            item.tooltip = node.isInactive ? `${node.filePath}\n이 .pri 조건에서 비활성인 파일` : node.filePath;
            item.command = { command: "vscode.open", title: "Open", arguments: [fileUri] };
            item.iconPath = vscode.ThemeIcon.File;
            return item;
        }
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        if (node.kind === "project" && !node.ancestors?.length) { item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded; }
        item.id = projectNodeId(node);
        item.iconPath = new vscode.ThemeIcon(node.kind === "project" ? "project" : "folder");
        if (node.kind === "project") {
            item.contextValue = "qtProProject";
            item.tooltip = node.projectPath;
            item.description = node.projectPath === this.activePath ? "활성" : undefined;
        }
        if (node.kind === "include") {
            item.contextValue = "qtProInclude";
            item.iconPath = new vscode.ThemeIcon("library", new vscode.ThemeColor("charts.green"));
            item.tooltip = node.partPath;
        }
        if (node.kind === "folder") {
            item.contextValue = "qtProFolder";
            item.resourceUri = vscode.Uri.file(node.directoryPath!);
            item.tooltip = node.directoryPath;
        }
        return item;
    }

    public getChildren(node?: ProjectNode): ProjectNode[] {
        if (!node) {
            const roots = this.roots.map(projectPath => this.projectNode(projectPath));
            for (const root of roots) { this.parents.set(projectNodeId(root), undefined); }
            return roots;
        }
        if (node.kind === "file") { return []; }
        const isFolder = node.kind === "group" || node.kind === "folder";
        const children = isFolder ? folderChildren(node) : partChildren(node, this.getProject(node.projectPath));
        for (const child of children) { this.parents.set(projectNodeId(child), node); }
        return children;
    }

    public dispose(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.clearWatches(); this.changed.dispose(); this.decorations.dispose();
    }
}
