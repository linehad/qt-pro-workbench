import * as path from "node:path";
import type { ProjectNode } from "./XProjectTreeTypes";

function fileIdentity(filePath: string): string {
    const normalized = path.resolve(filePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function preference(node: ProjectNode, selected?: ProjectNode): number {
    if (!selected) { return 0; }
    const preferredRoot = selected.ancestors?.[0] ?? selected.projectPath;
    const isRoot = node.kind === "project" && !node.ancestors?.length;
    if (isRoot && node.projectPath === preferredRoot) { return 3; }
    if (node.projectPath === selected.projectPath) {
        if (node.partPath === selected.partPath) { return 2; }
        if (selected.includeAncestors?.includes(node.partPath ?? "")) { return 2; }
        return 1;
    }
    return selected.ancestors?.includes(node.projectPath) ? 1 : 0;
}

export function findProjectFile(roots: ProjectNode[], children: (node: ProjectNode) => ProjectNode[], filePath: string, selected?: ProjectNode): ProjectNode | undefined {
    const target = fileIdentity(filePath);
    const visit = (nodes: ProjectNode[]): ProjectNode | undefined => {
        const ordered = [...nodes].sort((left, right) => preference(right, selected) - preference(left, selected));
        for (const node of ordered) {
            if (node.kind === "file") {
                if (node.filePath && fileIdentity(node.filePath) === target) { return node; }
                continue;
            }
            // A group already knows all of its files; avoid expanding unrelated folders.
            if (node.files && !node.files.some(file => fileIdentity(file) === target)) { continue; }
            const found = visit(children(node));
            if (found) { return found; }
        }
        return undefined;
    };
    return visit(roots);
}
