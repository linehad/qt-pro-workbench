import type { Uri } from "vscode";

export type ProjectCommandTarget = ProjectNode | Uri;

export interface ProjectNode {
    kind: "project" | "include" | "group" | "folder" | "file";
    label: string;
    projectPath: string;
    filePath?: string;
    directoryPath?: string;
    groupName?: string;
    partPath?: string;
    includeAncestors?: string[];
    inactiveFiles?: Set<string>;
    isInactive?: boolean;
    files?: string[];
    ancestors?: string[];
}
