import * as fs from "node:fs";
import * as path from "node:path";
import { projectName } from "./XProjectIdentity";
import { readCMakeModel } from "./XCMakeFileApi";
import type { BuildPlan, FileGroup, ProjectData } from "./XProjectTypes";

function groupFor(file: string): FileGroup {
    if (/cmakelists\.txt$|\.cmake$/i.test(file)) { return "Project Files"; }
    if (/\.(?:h|hh|hpp|hxx)$/i.test(file)) { return "Headers"; }
    if (/\.(?:c|cc|cpp|cxx)$/i.test(file)) { return "Sources"; }
    if (/\.ui$/i.test(file)) { return "Forms"; }
    if (/\.qrc$/i.test(file)) { return "Resources"; }
    return "Other Files";
}

export function parseCMakeProject(projectPath: string, plan?: BuildPlan): ProjectData {
    const source = path.dirname(projectPath);
    const text = fs.readFileSync(projectPath, "utf8");
    const groups = new Map<FileGroup, string[]>();
    const children: string[] = [];
    const files = new Set<string>();
    const scripts = new Set<string>([projectPath]);
    let count = 0;
    const scan = (directory: string, depth: number): void => {
        if (depth > 16 || count > 10000) { return; }
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (++count > 10000) { return; }
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && !/^(?:\.|build(?:[-_].*)?$|cmake-build.*$|CMakeFiles$|node_modules$|out$|debug$|release$)/i.test(entry.name)) {
                if (!fs.existsSync(path.join(file, "CMakeCache.txt"))) { scan(file, depth + 1); }
            } else if (entry.isFile() && /cmakelists\.txt$|\.(?:cmake|c|cc|cpp|cxx|h|hh|hpp|hxx|ui|qrc|ts)$/i.test(entry.name)) { files.add(file); }
        }
    };
    scan(source, 0);
    // Opening a project only reads files; CMake commands run after an explicit build/configure.
    for (const match of text.replace(/#[^\n]*/g, "").matchAll(/add_subdirectory\s*\(\s*(?:"([^"]+)"|([^\s)]+))/gi)) {
        const value = match[1] ?? match[2];
        if (/[$<>]/.test(value)) { continue; }
        const file = path.resolve(source, value, "CMakeLists.txt");
        if (fs.existsSync(file)) { children.push(file); }
    }
    const model = plan ? readCMakeModel(plan.buildDirectory, plan.configuration, projectPath) : undefined;
    if (model) {
        files.clear();
        for (const target of model.targets) {
            for (const entry of target.sources ?? []) { files.add(path.resolve(entry.isGenerated ? model.build : model.source, entry.path)); }
        }
        for (const input of model.inputs) {
            scripts.add(input);
            const relative = path.relative(path.dirname(source), input);
            if (!relative.startsWith("..") && !path.isAbsolute(relative)) { files.add(input); }
        }
    }
    for (const file of files) {
        if (file === projectPath) { continue; }
        const group = groupFor(file);
        const values = groups.get(group) ?? []; values.push(file); groups.set(group, values);
    }
    return { projectPath, name: projectName(projectPath), template: "cmake", groups,
        parts: new Map([[projectPath, { filePath: projectPath, includes: [], groups, fileActivity: new Map() }]]),
        children: [...new Set(children)], watchedPaths: [...scripts, ...files].filter(file => /cmakelists\.txt$|\.cmake$/i.test(file)),
        notes: model ? [] : ["Configure 전에는 소스 폴더의 파일을 표시합니다. Configure 후 CMake File API의 실제 대상 정보를 사용합니다."], includePaths: [], defines: [], config: [] };
}
