import * as path from "node:path";
import type { ProjectData } from "./XProjectTypes";
import type { ProjectNode } from "./XProjectTreeTypes";
import { projectName } from "./XProjectIdentity";

export function partChildren(node: ProjectNode, data: ProjectData): ProjectNode[] {
    const partPath = node.partPath ?? data.projectPath;
    const part = data.parts.get(partPath);
    if (!part) { return []; }
    const includeAncestors = [...(node.includeAncestors ?? []), partPath];
    const ancestors = node.ancestors ?? [];
    const shared = { projectPath: node.projectPath, ancestors, partPath, includeAncestors };
    const nodes: ProjectNode[] = [{ ...shared, kind: "file", label: path.basename(partPath), filePath: partPath }];
    const includes = part.includes.filter(file => !includeAncestors.includes(file)).sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { numeric: true }));
    for (const filePath of includes) {
        nodes.push({ ...shared, kind: "include", label: path.basename(filePath, path.extname(filePath)), partPath: filePath });
    }
    if (node.kind === "project") {
        const projectAncestors = [...ancestors, node.projectPath];
        const children = data.children.filter(child => !projectAncestors.includes(child));
        nodes.push(...children.map(projectPath => ({ kind: "project" as const, label: projectName(projectPath), projectPath, ancestors: projectAncestors })));
    }
    for (const [group, files] of part.groups) {
        if (!files.length) { continue; }
        const inactiveFiles = new Set(files.filter(file => part.fileActivity.get(file) === false));
        nodes.push({ ...shared, kind: "group", label: group, groupName: group, directoryPath: path.dirname(partPath), files, inactiveFiles });
    }
    return nodes;
}
