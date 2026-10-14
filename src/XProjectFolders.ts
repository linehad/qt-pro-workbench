import * as path from "node:path";
import type { ProjectNode } from "./XProjectTreeTypes";

function childDirectory(baseDirectory: string, filePath: string): string | undefined {
    const relative = path.relative(baseDirectory, filePath);
    if (path.isAbsolute(relative)) { return path.parse(filePath).root; }
    const parts = relative.split(path.sep);
    if (parts.length === 1) { return undefined; }
    return path.resolve(baseDirectory, parts[0]);
}

function compactFolder(folder: ProjectNode, baseDirectory: string): ProjectNode {
    let directoryPath = folder.directoryPath!;
    const visited = new Set<string>();
    while (!visited.has(directoryPath)) {
        visited.add(directoryPath);
        const children = new Set((folder.files ?? []).map(file => childDirectory(directoryPath, file)));
        if (children.has(undefined) || children.size !== 1) { break; }
        directoryPath = children.values().next().value!;
    }
    return { ...folder, directoryPath, label: path.relative(baseDirectory, directoryPath) };
}

export function folderChildren(node: ProjectNode): ProjectNode[] {
    const baseDirectory = node.directoryPath ?? path.dirname(node.projectPath);
    const folders = new Map<string, ProjectNode>();
    const files: ProjectNode[] = [];
    const groupName = node.groupName ?? node.label;
    const shared = { projectPath: node.projectPath, groupName, ancestors: node.ancestors, partPath: node.partPath, includeAncestors: node.includeAncestors, inactiveFiles: node.inactiveFiles };
    for (const filePath of node.files ?? []) {
        const directoryPath = childDirectory(baseDirectory, filePath);
        if (!directoryPath) {
            files.push({ ...shared, kind: "file", label: path.basename(filePath), filePath, isInactive: node.inactiveFiles?.has(filePath) });
            continue;
        }
        const key = process.platform === "win32" ? directoryPath.toLowerCase() : directoryPath;
        let folder = folders.get(key);
        if (!folder) {
            folder = { ...shared, kind: "folder", label: path.relative(baseDirectory, directoryPath), directoryPath, files: [] };
            folders.set(key, folder);
        }
        folder.files!.push(filePath);
    }
    const byName = (left: ProjectNode, right: ProjectNode) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
    return [...folders.values()].map(folder => compactFolder(folder, baseDirectory)).sort(byName).concat(files.sort(byName));
}

export function projectNodeId(node: ProjectNode): string {
    return JSON.stringify([node.ancestors ?? [], node.projectPath, node.includeAncestors ?? [], node.partPath ?? "", node.kind, node.groupName ?? "", node.directoryPath ?? node.filePath ?? node.label]);
}
