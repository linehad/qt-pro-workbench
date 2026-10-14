import * as fs from "node:fs";
import * as path from "node:path";
import { makeBuildPlan } from "./XBuildPlan";
import { makeCppConfiguration } from "./XIntelliSenseConfiguration";
import { cmakeConfigurations } from "./XCMakeIntelliSense";
import { isProjectFile } from "./XProjectIdentity";
import { repositoryRoot } from "./XReferenceScope";
import type { CppBrowseConfiguration, CppConfiguration, IntelliSenseProjectsInfo } from "./XIntelliSenseTypes";
import type { BuildPlan, ProjectPreferences } from "./XProjectTypes";

interface ProjectContext {
    projectPath: string;
    preferences?: ProjectPreferences;
    parentPlan?: BuildPlan;
    openedRoot?: string;
}

function fileIdentity(filePath: string): string {
    return path.resolve(filePath).toLowerCase();
}

export class TXIntelliSenseProjects {
    private readonly configurations = new Map<string, CppConfiguration>();
    private readonly visited = new Set<string>();
    private readonly missing = new Set<string>();
    private readonly indexedFiles = new Map<string, string>();

    private collect(context: ProjectContext, override?: BuildPlan): void {
        const key = fileIdentity(context.projectPath);
        if (this.visited.has(key)) { return; }
        this.visited.add(key);
        try {
            const project = this.info.getProject(context.projectPath);
            if (context.openedRoot) {
                for (const file of [...project.groups.values()].flat()) {
                    if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|inl|ipp)$/i.test(file)) { this.indexedFiles.set(fileIdentity(file), context.openedRoot); }
                }
            }
            const saved = this.info.preferences(context.projectPath);
            const preferences = saved.kitId ? saved : context.preferences ?? saved;
            const kit = this.info.kits().find(item => item.id === preferences.kitId);
            let plan: BuildPlan | undefined;
            if (kit) {
                plan = makeBuildPlan(context.projectPath, kit, preferences, this.info.storagePath);
                const parent = context.parentPlan;
                if (parent && !saved.kitId && parent.buildSystem !== "cmake") {
                    const relative = path.relative(path.dirname(parent.projectPath), path.dirname(context.projectPath));
                    plan.buildDirectory = path.resolve(parent.buildDirectory, relative);
                }
                if (override && fileIdentity(override.projectPath) === key) { plan = override; }
                const cmake = plan.buildSystem === "cmake" ? cmakeConfigurations(plan) : new Map<string, CppConfiguration>();
                for (const [file, configuration] of cmake) {
                    if (!this.configurations.has(file)) { this.configurations.set(file, configuration); }
                }
                const configuration = makeCppConfiguration(project, plan);
                for (const files of project.groups.values()) {
                    for (const file of files) {
                        const fileKey = fileIdentity(file);
                        // The active root is visited first for files shared by multiple projects.
                        if (!this.configurations.has(fileKey)) { this.configurations.set(fileKey, configuration); }
                    }
                }
            }
            for (const child of project.children) {
                this.collect({ projectPath: child, preferences, parentPlan: plan, openedRoot: context.openedRoot }, override);
            }
        } catch (error) { this.info.reportError(error); }
    }

    private discover(filePath: string): void {
        let directory = path.dirname(filePath);
        while (true) {
            try {
                const candidates = fs.readdirSync(directory).filter(name => isProjectFile(name));
                for (const name of candidates) {
                    const projectPath = path.join(directory, name);
                    const project = this.info.getProject(projectPath);
                    const ownsFile = [...project.groups.values()].flat().some(file => fileIdentity(file) === fileIdentity(filePath));
                    if (ownsFile) { this.collect({ projectPath }); }
                }
            } catch (error) { this.info.reportError(error); }
            if (this.configurations.has(fileIdentity(filePath))) { return; }
            const parent = path.dirname(directory);
            if (parent === directory) { return; }
            directory = parent;
        }
    }

    public constructor(private readonly info: IntelliSenseProjectsInfo) {}

    public refresh(override?: BuildPlan): void {
        this.configurations.clear(); this.visited.clear(); this.missing.clear(); this.indexedFiles.clear();
        const roots = this.info.projects();
        const active = this.info.activeProject();
        roots.sort((left, right) => Number(right === active) - Number(left === active));
        for (const projectPath of roots) { this.collect({ projectPath, openedRoot: repositoryRoot(projectPath) }, override); }
        if (override) { this.collect({ projectPath: override.projectPath }, override); }
    }

    public configurationFor(filePath: string): CppConfiguration | undefined {
        const key = fileIdentity(filePath);
        if (this.configurations.has(key)) { return this.configurations.get(key); }
        if (this.missing.has(key)) { return undefined; }
        this.discover(filePath);
        if (!this.configurations.has(key)) { this.missing.add(key); }
        return this.configurations.get(key);
    }

    public browseConfiguration(folder?: string): CppBrowseConfiguration {
        const root = folder ? fileIdentity(repositoryRoot(path.join(folder, "_qt_pro_index_"))) : undefined;
        const files = [...this.indexedFiles].filter(([, projectRoot]) => {
            if (!folder || fileIdentity(projectRoot) === root) { return true; }
            const relative = path.relative(folder, projectRoot);
            return !relative.startsWith("..") && !path.isAbsolute(relative);
        }).map(([file]) => file);
        const configurations = files.map(file => this.configurations.get(file)).filter((configuration): configuration is CppConfiguration => Boolean(configuration));
        const primary = configurations[0];
        const directories = configurations.flatMap(configuration => configuration.includePath.map(directory => path.join(directory, "*")));
        return { browsePath: [...new Set([...files, ...directories])], compilerPath: primary?.compilerPath, compilerArgs: primary?.compilerArgs, standard: primary?.standard };
    }
}
