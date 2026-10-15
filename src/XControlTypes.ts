import type { ProjectSelectionState, ProjectSelectionChange } from "./XProjectSelectionTypes";

export interface ControlDescriptor { id: string; pipe: string; token: string; pid: number; createdAt: string; }
export interface ControlRequest { operation: string; arguments: Record<string, unknown>; }
export interface WorkbenchControlInfo {
    state: () => ProjectSelectionState;
    openProject: (projectPath: string) => Promise<void>;
    closeProject?: (projectPath: string) => Promise<void>;
    select: (change: ProjectSelectionChange) => Promise<void>;
    build: (projectPath: string, operation: string) => Promise<boolean>;
    debug: (projectPath: string, stopAtEntry: boolean) => Promise<boolean>;
    git?: (operation: string, args: Record<string, unknown>) => Promise<unknown>;
}
export interface ControlLog { cursor: number; time: string; source: string; text: string; }
export interface ControlJob { id: string; operation: string; status: "running" | "succeeded" | "failed"; startedAt: string; finishedAt?: string; result?: unknown; error?: string; }
