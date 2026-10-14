import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectData } from "./XProjectTypes";
import type { ReferenceProject } from "./XReferenceTypes";

export function sourceIdentity(file: string): string { return path.resolve(file).toLowerCase(); }

export function repositoryRoot(file: string): string {
    let directory = path.dirname(path.resolve(file));
    while (true) {
        if ([".git", ".svn", ".hg"].some(marker => fs.existsSync(path.join(directory, marker)))) { return directory; }
        const parent = path.dirname(directory);
        if (parent === directory) { return path.dirname(path.resolve(file)); }
        directory = parent;
    }
}

export function referenceProjects(roots: string[], getProject: (project: string) => ProjectData): ReferenceProject[] {
    const result: ReferenceProject[] = [];
    const visited = new Set<string>();
    const collect = (projectPath: string, root: string, openedProject: string): void => {
        const key = sourceIdentity(projectPath);
        if (visited.has(key)) { return; }
        visited.add(key);
        const project = getProject(projectPath);
        const files = [...new Set([...project.groups.values()].flat().filter(file => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl|ipp)$/i.test(file)).map(sourceIdentity))];
        result.push({ projectPath, openedProject, root, files });
        for (const child of project.children) { collect(child, root, openedProject); }
    };
    for (const project of roots) { collect(project, repositoryRoot(project), project); }
    return result;
}

export function referenceFiles(projects: ReferenceProject[], source?: string): Set<string> {
    if (!source) { return new Set(projects.flatMap(project => project.files)); }
    const key = sourceIdentity(source);
    const sourceRoot = sourceIdentity(repositoryRoot(source));
    const owners = projects.filter(project => project.files.includes(key));
    const root = owners.find(project => sourceIdentity(project.root) === sourceRoot)?.root;
    if (!root) { return new Set(); }
    const files = projects.filter(project => sourceIdentity(project.root) === sourceIdentity(root)).flatMap(project => project.files);
    return new Set(files.filter(file => {
        const relative = path.relative(root, file);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
    }));
}
