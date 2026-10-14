import * as path from "node:path";

export function isCMakeProject(filePath: string): boolean {
    return path.basename(filePath).toLowerCase() === "cmakelists.txt";
}

export function isProjectFile(filePath: string): boolean {
    return isCMakeProject(filePath) || filePath.toLowerCase().endsWith(".pro");
}

export function projectName(filePath: string): string {
    return isCMakeProject(filePath) ? path.basename(path.dirname(filePath)) : path.basename(filePath, ".pro");
}
