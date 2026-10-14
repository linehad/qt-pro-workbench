export interface ReferenceProject { projectPath: string; openedProject: string; root: string; files: string[]; }

export interface ReferenceSession {
    version: 1;
    projects: string[];
    activeProject?: string;
    workspaceRoots?: string[];
    documents: { file: string; dirtyText?: string }[];
    reference?: { file: string; line: number; character: number };
}
