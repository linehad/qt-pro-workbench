export interface GitFileChange {
    filePath: string;
    previousPath?: string;
    change: string;
}

export interface GitCommit {
    hash: string;
    parents: string[];
    date: string;
    author: string;
    subject: string;
    filePath?: string;
    previousPath?: string;
    change?: string;
    changes?: GitFileChange[];
}

export interface GitHistoryPage {
    repositoryRoot: string;
    filePath?: string;
    directoryPath?: string;
    commits: GitCommit[];
    nextSkip: number;
    hasMore: boolean;
}

export interface GitRevision {
    repositoryRoot: string;
    hash: string;
    filePath: string;
    encoding: string;
    empty?: boolean;
}
import type { Uri } from "vscode";

export type GitHistoryAction = "previous" | "working" | "revision";


export interface GitHistoryViewInfo {
    extensionUri: Uri;
    file: string;
    repositoryRoot: string;
    isDirectory?: boolean;
    load: (skip: number) => Promise<GitHistoryPage>;
    message: (hash: string) => Promise<string>;
    open: (commit: GitCommit, action: GitHistoryAction) => Promise<unknown>;
    openLatest: (filePath?: string) => Promise<unknown>;
    onDispose: () => void;
}
