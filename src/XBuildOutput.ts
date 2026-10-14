import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildPlan } from "./XProjectTypes";
import { readCMakeModel } from "./XCMakeFileApi";

function makeValue(text: string, name: string, depth = 0): string {
    if (depth > 10) { return ""; }
    const raw = text.match(new RegExp(`^${name}\\s*[:?]?=\\s*(.*)$`, "m"))?.[1] ?? "";
    return raw.replace(/\s+#.*$/, "").trim().replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_match, first, second) => makeValue(text, first ?? second, depth + 1));
}

function makeText(makefilePath: string): string {
    return fs.readFileSync(makefilePath, "utf8").replace(/\\\r?\n/g, " ");
}

function filePath(value: string, directory: string): string {
    return path.resolve(directory, value.replace(/^"(.*)"$/, "$1").replace(/\\([ #])/g, "$1"));
}

export function executableFromMakefile(makefilePath: string, kitPath?: string): string | undefined {
    if (!fs.existsSync(makefilePath)) { return undefined; }
    const text = makeText(makefilePath);
    const directory = path.dirname(makefilePath);
    if (kitPath) {
        const qmake = makeValue(text, "QMAKE");
        if (!qmake) { return undefined; }
        if (filePath(qmake, directory).toLowerCase() !== path.resolve(kitPath).toLowerCase()) { return undefined; }
    }
    let target = makeValue(text, "DESTDIR_TARGET");
    if (!target) {
        const name = makeValue(text, "TARGET");
        if (!name) { return undefined; }
        target = path.join(makeValue(text, "DESTDIR"), name);
    }
    target = target.replace(/^"(.*)"$/, "$1");
    if (!target.toLowerCase().endsWith(".exe")) { return undefined; }
    if (/\$[({]/.test(target)) { return undefined; }
    return filePath(target, directory);
}

function childMakefiles(makefilePath: string): string[] {
    const text = makeText(makefilePath);
    const children: string[] = [];
    for (const target of makeValue(text, "SUBTARGETS").split(/\s+/).filter(Boolean)) {
        const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const prerequisites = text.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"))?.[1] ?? "";
        const expanded = prerequisites.replace(/\$\((\w+)\)|\$\{(\w+)\}/g, (_match, first, second) => makeValue(text, first ?? second));
        const child = expanded.match(/^(?:"[^"]+"|(?:\\ |[^\s])+)/)?.[0];
        if (child && child !== "FORCE") { children.push(filePath(child, path.dirname(makefilePath))); }
    }
    return children;
}

function configuredMakefile(makefilePath: string, configuration: BuildPlan["configuration"]): string {
    const suffix = configuration === "release" ? "Release" : "Debug";
    const configured = `${makefilePath}.${suffix}`;
    return fs.existsSync(configured) ? configured : makefilePath;
}

function collectExecutables(makefilePath: string, configuration: BuildPlan["configuration"], visited: Set<string>, kitPath?: string): string[] {
    const selected = configuredMakefile(makefilePath, configuration);
    const key = path.resolve(selected).toLowerCase();
    if (visited.has(key) || !fs.existsSync(selected)) { return []; }
    visited.add(key);
    const executable = executableFromMakefile(selected, kitPath);
    if (executable) { return [executable]; }
    // Follow qmake's actual SUBDIRS build graph, including custom child Makefile names.
    return childMakefiles(selected).flatMap(child => collectExecutables(child, configuration, visited, kitPath));
}

export function buildExecutables(plan: BuildPlan, includeProjectMakefile = false): string[] {
    if (plan.buildSystem === "cmake") {
        const model = readCMakeModel(plan.buildDirectory, plan.configuration, plan.projectPath);
        const files = model?.targets.filter(target => target.type === "EXECUTABLE").flatMap(target => (target.artifacts ?? []).filter(artifact => target.nameOnDisk ? path.basename(artifact.path) === target.nameOnDisk : artifact.path.toLowerCase().endsWith(".exe")).map(artifact => path.resolve(model.build, artifact.path))) ?? [];
        return [...new Map(files.map(file => [file.toLowerCase(), file])).values()];
    }
    const makefile = path.join(plan.buildDirectory, "Makefile");
    let executables = collectExecutables(makefile, plan.configuration, new Set());
    if (!executables.length && includeProjectMakefile) {
        const projectMakefile = path.join(path.dirname(plan.projectPath), "Makefile");
        executables = collectExecutables(projectMakefile, plan.configuration, new Set(), plan.kit.qmakePath);
    }
    const unique = new Map(executables.map(executable => [executable.toLowerCase(), executable]));
    return [...unique.values()];
}

export function defaultExecutable(plan: BuildPlan, includeProjectMakefile = false): string | undefined {
    const executables = buildExecutables(plan, includeProjectMakefile);
    return executables.length === 1 ? executables[0] : undefined;
}
