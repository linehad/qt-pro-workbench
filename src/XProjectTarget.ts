import * as path from "node:path";
import type { ProjectCommandTarget } from "./XProjectTreeTypes";
import { isProjectFile } from "./XProjectIdentity";

export function projectPathForTarget(target?: ProjectCommandTarget): string | undefined {
    if (!target) { return undefined; }
    let projectPath: string;
    if ("scheme" in target) {
        if (target.scheme !== "file") { throw new Error("로컬 .pro 또는 CMakeLists.txt 파일을 선택하세요."); }
        projectPath = target.fsPath;
    } else {
        projectPath = target.projectPath;
        if (target.kind === "file" && target.filePath) { projectPath = target.filePath; }
    }
    if (!isProjectFile(projectPath)) { throw new Error("빌드할 .pro 또는 CMakeLists.txt 파일을 선택하세요."); }
    return path.resolve(projectPath);
}

export function rootProjectForPath(projectPath: string, roots: string[], childrenForProject: (project: string) => string[]): string {
    const target = path.resolve(projectPath).toLowerCase();
    for (const root of roots) {
        if (path.resolve(root).toLowerCase() === target) { continue; }
        const pending = [root];
        const visited = new Set<string>();
        while (pending.length) {
            const current = pending.pop()!;
            const key = path.resolve(current).toLowerCase();
            if (key === target) { return root; }
            if (visited.has(key)) { continue; }
            visited.add(key);
            pending.push(...childrenForProject(current));
        }
    }
    return projectPath;
}
