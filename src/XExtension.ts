import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { isCMakeProject, isProjectFile, projectName } from "./XProjectIdentity";
import { TXReferences } from "./XReferences";
import { loadReferenceSession, saveReferenceSession, restoreReferenceDocuments } from "./XReferenceWorkspace";
import { TXProjectTree } from "./XProjectTree";
import { TXProjectNavigation } from "./XProjectNavigation";
import { TXBookmarks } from "./XBookmarks";
import { TXBuildController } from "./XBuildController";
import { TXBuildActions } from "./XBuildActions";
import { TXIntelliSense } from "./XIntelliSense";
import { TXIntelliSenseProjects } from "./XIntelliSenseProjects";
import { TXProjectActions } from "./XProjectActions";
import { TXWorkbenchControl } from "./XWorkbenchControl";
import { TXLocalControlServer } from "./XLocalControlServer";
import { installControlCli, installControlSkill } from "./XControlInstall";
import type { ControlRequest } from "./XControlTypes";
import { loadProjectPreferences, saveProjectPreferences } from "./XProjectPreferencesStore";
import { discoverKits, loadKits } from "./XKitStore";
import { importQtCreatorOnce } from "./XQtCreatorImport";
import { makeBuildPlan } from "./XBuildPlan";
import { buildExecutables, defaultExecutable } from "./XBuildOutput";
import { debuggerPathForKit, makeDebugConfiguration } from "./XDebugConfiguration";
import { installDebugRuntime } from "./XDebugRuntime";
import { configuredExecutable, getRunSettings, makeRunTarget, runSettingsKey } from "./XRunSettings";
import { activeRunConfiguration, changeRunConfiguration, getRunConfigurationSet } from "./XRunConfigurations";
import { loadRunConfigurations, saveRunConfigurations } from "./XRunSettingsStore";
import { projectPathForTarget, rootProjectForPath } from "./XProjectTarget";
import { importPublisherSettings } from "./XPublisherMigration";
import { ensureUserDebugLaunch } from "./XUserDebugLaunch";
import { openKitSettingsView } from "./XKitSettingsView";
import { openProjectSelectionView } from "./XProjectSelectionView";
import { TXProjectSettingsController } from "./XProjectSettingsController";
import { loadConfigurations, saveConfigurations } from "./XConfigurationStore";
import { getBuildConfigurations, getDeployConfigurations, validateBuildConfigurations, validateDeployConfigurations } from "./XConfigurations";
import { deployFiles } from "./XDeploy";
import { buildSettingsKey, loadBuildConfigurations, saveBuildConfiguration } from "./XBuildSettings";
import type { BuildSettings } from "./XBuildSettingsTypes";
import type { ProjectCommandTarget } from "./XProjectTreeTypes";
import type { BuildOperation, BuildPlan, ProjectPreferences, QtKit } from "./XProjectTypes";
import type { RunConfiguration, RunConfigurationChange, RunSettings } from "./XRunTypes";
import type { SettingsTab } from "./XProjectSelectionTypes";

class TXWorkbench {
    private readonly context: vscode.ExtensionContext;
    private readonly tree: TXProjectTree;
    private readonly navigation: TXProjectNavigation;
    private readonly intelliSense: TXIntelliSense;
    private readonly cppProjects: TXIntelliSenseProjects;
    private readonly builder = new TXBuildController((source, text) => this.control?.recordLog(source, text));
    private readonly control: TXWorkbenchControl;
    private readonly controlServer: TXLocalControlServer;
    private readonly buildActions = new TXBuildActions();
    private readonly projectActions = new TXProjectActions();
    private cppRefreshTimer: NodeJS.Timeout | undefined;
    private globalWrites = Promise.resolve();
    private readonly output = vscode.window.createOutputChannel("Qt Pro");
    private readonly configurationStatus = vscode.window.createStatusBarItem("qtPro.buildConfiguration", vscode.StatusBarAlignment.Left, 29);
    private readonly projectStatus = vscode.window.createStatusBarItem("qtPro.activeProject", vscode.StatusBarAlignment.Left, 31);
    private readonly storagePath: string;
    private readonly kitsPath: string;
    private activeProject: string | undefined;
    private kitSettingsView: vscode.WebviewPanel | undefined;
    private readonly projectSettingsViews = new Map<vscode.WebviewPanel, TXProjectSettingsController>();
    private readonly deploying = new Set<string>();
    private readonly references: TXReferences;

    private preferences(projectPath: string): ProjectPreferences {
        const legacy = this.context.globalState.get<ProjectPreferences>(`project:${projectPath}`) ?? { configuration: "debug" as const };
        const stored = loadProjectPreferences(this.storagePath, projectPath);
        if (!stored && legacy.kitId) { saveProjectPreferences(this.storagePath, projectPath, legacy); }
        const preferences = { ...legacy, ...stored };
        const runConfigurations = loadRunConfigurations(this.storagePath, projectPath) ?? preferences.runConfigurations;
        const buildConfigurations = loadBuildConfigurations(this.storagePath, projectPath) ?? preferences.buildConfigurations;
        const buildProfiles = loadConfigurations(this.storagePath, projectPath, "build-profiles", validateBuildConfigurations);
        const deployConfigurations = loadConfigurations(this.storagePath, projectPath, "deploy-configurations", validateDeployConfigurations);
        return { ...preferences, buildSystem: isCMakeProject(projectPath) ? "cmake" : "qmake", runConfigurations, buildConfigurations, buildProfiles, deployConfigurations };
    }

    private writeGlobalState(key: string, value: unknown): Promise<void> {
        const next = this.globalWrites.then(() => this.context.globalState.update(key, value));
        this.globalWrites = next.catch(error => this.output.appendLine(String(error)));
        return next;
    }

    private async savePreferences(projectPath: string, preferences: ProjectPreferences): Promise<void> {
        saveProjectPreferences(this.storagePath, projectPath, preferences);
        await this.writeGlobalState(`project:${projectPath}`, preferences);
        if (isCMakeProject(projectPath)) { this.tree.refresh(); }
        this.updateStatus();
        await this.updateIntelliSense();
    }

    private async updateIntelliSense(plan?: ReturnType<typeof makeBuildPlan>): Promise<void> {
        this.cppProjects.refresh(plan);
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme !== "file") { continue; }
            if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(document.fileName)) { this.cppProjects.configurationFor(document.fileName); }
        }
        await this.intelliSense.configure();
    }

    private scheduleIntelliSense(): void {
        if (this.cppRefreshTimer) { clearTimeout(this.cppRefreshTimer); }
        this.cppRefreshTimer = setTimeout(() => { void this.updateIntelliSense().catch(error => this.output.appendLine(String(error))); }, 150);
    }

    private async persistProjects(): Promise<void> {
        await this.context.workspaceState.update("projects", this.tree.projects());
        await this.context.workspaceState.update("activeProject", this.activeProject);
        saveReferenceSession(this.storagePath, this.tree.projects(), this.activeProject);
    }

    private updateStatus(): void {
        void vscode.commands.executeCommand("setContext", "qtPro.hasActiveProject", Boolean(this.activeProject));
        if (!this.activeProject) { this.configurationStatus.hide(); this.projectStatus.hide(); this.buildActions.update(); this.projectActions.update(); return; }
        const preferences = this.preferences(this.activeProject);
        let kit: QtKit | undefined;
        try { kit = loadKits(this.kitsPath).find(item => item.id === preferences.kitId); } catch { /* 개인 키트 편집 중에는 선택 상태만 표시한다. */ }
        let configurationName = preferences.configuration === "debug" ? "Debug" : "Release";
        if (kit) {
            const builds = getBuildConfigurations(preferences, kit);
            configurationName = builds.items.find(item => item.id === builds.activeId)!.name;
        }
        this.configurationStatus.text = `${configurationName} $(chevron-down)`;
        const label = isCMakeProject(this.activeProject) ? projectName(this.activeProject) : path.basename(this.activeProject);
        this.projectStatus.text = `$(project) ${label} $(chevron-down)`;
        this.projectStatus.tooltip = `활성 프로젝트: ${this.activeProject}`;
        this.buildActions.update(this.activeProject, configurationName, kit?.name);
        this.projectActions.update(this.activeProject);
        this.configurationStatus.show(); this.projectStatus.show();
    }

    private async activateProject(projectPath: string): Promise<void> {
        this.activeProject = projectPath;
        this.tree.setActive(projectPath);
        this.updateStatus();
        await this.persistProjects();
        await this.updateIntelliSense();
    }

    private async chooseProject(node?: ProjectCommandTarget): Promise<string | undefined> {
        const projectPath = projectPathForTarget(node);
        if (projectPath) {
            if (!fs.existsSync(projectPath)) { throw new Error(`파일을 찾을 수 없습니다: ${projectPath}`); }
            if (!fs.statSync(projectPath).isFile()) { throw new Error(`프로젝트 파일(.pro 또는 CMakeLists.txt)을 선택하세요: ${projectPath}`); }
            return projectPath;
        }
        if (this.activeProject) { return this.activeProject; }
        await this.openProject();
        return this.activeProject;
    }

    private async chooseRunProject(node?: ProjectCommandTarget): Promise<string | undefined> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath || node) { return projectPath; }
        return rootProjectForPath(projectPath, this.tree.projects(), project => this.tree.getProject(project).children);
    }

    private async openProject(uri?: vscode.Uri, shouldFocus = true, shouldActivate = true): Promise<void> {
        let projectUri = uri;
        if (!projectUri) {
            const choices = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { "Qt / CMake project": ["pro", "txt"] }, title: "Qt 프로젝트 열기" });
            projectUri = choices?.[0];
        }
        if (!projectUri) { return; }
        if (projectUri.scheme !== "file") { throw new Error("로컬 .pro 또는 CMakeLists.txt 파일을 선택하세요."); }
        const projectPath = path.resolve(projectUri.fsPath);
        if (!isProjectFile(projectPath)) { throw new Error("프로젝트 파일(.pro 또는 CMakeLists.txt)을 선택하세요."); }
        if (!fs.existsSync(projectPath)) { throw new Error(`파일을 찾을 수 없습니다: ${projectPath}`); }
        const root = rootProjectForPath(projectPath, this.tree.projects(), project => this.tree.getProject(project).children);
        if (root === projectPath) { this.tree.add(projectPath); }
        if (shouldActivate || !this.activeProject) { await this.activateProject(root); }
        else { this.tree.setActive(this.activeProject); await this.persistProjects(); }
        const recent = this.context.globalState.get<string[]>("recentProjects") ?? [];
        await this.writeGlobalState("recentProjects", [projectPath, ...recent.filter(item => item !== projectPath)].slice(0, 30));
        if (shouldFocus) { await vscode.commands.executeCommand("qtProProjects.focus"); }
    }

    private projectSettingsController(projectPath?: string): TXProjectSettingsController {
        return new TXProjectSettingsController({
            storagePath: this.storagePath, kitsPath: this.kitsPath,
            projects: () => this.tree.projects().filter(project => rootProjectForPath(project, this.tree.projects(), file => this.tree.getProject(file).children) === project),
            activeProject: () => this.activeProject, preferences: project => this.preferences(project),
            savePreferences: (project, preferences) => this.savePreferences(project, preferences),
            activate: project => this.activateProject(project), manageKits: () => this.editKits(),
            refresh: async () => { this.updateStatus(); await this.updateIntelliSense(); }
        }, projectPath);
    }

    private openProjectSettings(projectPath?: string, tab: SettingsTab = "build"): void {
        // A context-menu target can be a child .pro; editing it does not activate it.
        const target = projectPath ?? this.activeProject;
        for (const [panel, controller] of this.projectSettingsViews) {
            if (controller.state().projectPath !== target) { continue; }
            panel.reveal(); void panel.webview.postMessage({ type: "tab", tab }); return;
        }
        const controller = this.projectSettingsController(projectPath);
        const panel = openProjectSelectionView({ extensionUri: this.context.extensionUri, tab, state: () => controller.state(), select: change => controller.select(change) });
        this.projectSettingsViews.set(panel, controller);
        panel.onDidDispose(() => { this.projectSettingsViews.delete(panel); });
        this.context.subscriptions.push(panel);
    }

    private async selectActiveProject(node?: ProjectCommandTarget): Promise<void> {
        if (node) {
            const projectPath = await this.chooseProject(node);
            if (projectPath) {
                const root = rootProjectForPath(projectPath, this.tree.projects(), project => this.tree.getProject(project).children);
                await this.openProject(vscode.Uri.file(root), false);
            }
            return;
        }
        this.openProjectSettings();
    }

    private async openRecent(): Promise<void> {
        const recent = this.context.globalState.get<string[]>("recentProjects") ?? [];
        const choice = await vscode.window.showQuickPick(recent.map(projectPath => ({ label: path.basename(projectPath), description: projectPath })), { title: "최근 Qt 프로젝트" });
        if (choice) { await this.openProject(vscode.Uri.file(choice.description)); }
    }

    private async selectKit(node?: ProjectCommandTarget): Promise<QtKit | undefined> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return undefined; }
        const kits = loadKits(this.kitsPath).filter(kit => isCMakeProject(projectPath) || kit.qmakePath);
        const choices: (vscode.QuickPickItem & { kit?: QtKit })[] = kits.map(kit => ({ label: kit.name, description: isCMakeProject(projectPath) ? kit.cmakePath ?? "CMake" : kit.qmakePath, detail: `Compiler: ${kit.compilerDirectory}`, kit }));
        choices.push({ label: "$(settings-gear) 키트 설정…", description: "Qt / 컴파일러 키트 추가·수정" });
        const choice = await vscode.window.showQuickPick(choices, { title: `${path.basename(projectPath)} — Qt / Compiler Kit`, placeHolder: "Qt와 컴파일러가 일치하는 키트를 선택하세요" });
        if (!choice) { return undefined; }
        if (!choice.kit) { this.editKits(); return undefined; }
        await this.savePreferences(projectPath, { ...this.preferences(projectPath), kitId: choice.kit.id, runExecutable: undefined });
        return choice.kit;
    }

    private editKits(): void {
        if (this.kitSettingsView) { this.kitSettingsView.reveal(); return; }
        const selectedKitId = this.activeProject ? this.preferences(this.activeProject).kitId : undefined;
        const onSaved = async (): Promise<void> => {
            this.updateStatus();
            await this.updateIntelliSense().catch(error => this.output.appendLine(String(error)));
        };
        this.kitSettingsView = openKitSettingsView({ extensionUri: this.context.extensionUri, kitsPath: this.kitsPath, selectedKitId, onSaved });
        this.kitSettingsView.onDidDispose(() => { this.kitSettingsView = undefined; });
        this.context.subscriptions.push(this.kitSettingsView);
    }

    private async selectConfiguration(node?: ProjectCommandTarget): Promise<void> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return; }
        const preferences = this.preferences(projectPath);
        const kit = loadKits(this.kitsPath).find(item => item.id === preferences.kitId);
        const builds = kit ? getBuildConfigurations(preferences, kit) : {
            activeId: preferences.configuration,
            items: (["debug", "release"] as const).map(configuration => ({ id: configuration, name: configuration === "debug" ? "Debug" : "Release", configuration }))
        };
        const choices = builds.items.map(item => ({ label: item.name, description: item.id === builds.activeId ? "현재 선택" : undefined, id: item.id, configuration: item.configuration }));
        const choice = await vscode.window.showQuickPick(choices, { title: `${path.basename(projectPath)} · 빌드 구성`, placeHolder: "빌드 구성 선택" });
        if (!choice) { return; }
        const current = this.preferences(projectPath);
        if (current.kitId !== preferences.kitId) { throw new Error("프로젝트 키트가 변경되었습니다. 빌드 구성을 다시 선택하세요."); }
        if (kit) {
            await this.projectSettingsController(projectPath).select({ field: "build", change: { action: "select", id: choice.id } });
        } else {
            await this.savePreferences(projectPath, { ...current, configuration: choice.configuration, runExecutable: undefined });
        }
        for (const [panel, controller] of this.projectSettingsViews) {
            const state = controller.state();
            if (state.projectPath === projectPath) { await panel.webview.postMessage({ type: "state", state }); }
        }
    }

    private async kitForProject(projectPath: string): Promise<QtKit | undefined> {
        const id = this.preferences(projectPath).kitId;
        const kit = loadKits(this.kitsPath).find(item => item.id === id);
        if (kit) { return kit; }
        return this.selectKit({ kind: "project", label: "", projectPath });
    }

    private async changeRunConfigurations(projectPath: string, kit: QtKit, configuration: "debug" | "release", changes: RunConfigurationChange[]): Promise<void> {
        const preferences = this.preferences(projectPath);
        let configurations = getRunConfigurationSet(preferences, kit.id, configuration, projectName(projectPath));
        for (const change of changes) { configurations = changeRunConfiguration(configurations, change); }
        const profiles = { ...preferences.runConfigurations, [runSettingsKey(kit.id, configuration)]: configurations };
        saveRunConfigurations(this.storagePath, projectPath, profiles);
    }

    private async saveRunSettings(projectPath: string, kit: QtKit, configuration: "debug" | "release", settings: RunSettings, id?: string): Promise<void> {
        const configurations = getRunConfigurationSet(this.preferences(projectPath), kit.id, configuration);
        await this.changeRunConfigurations(projectPath, kit, configuration, [{ action: "save", id: id ?? configurations.activeId, settings }]);
    }

    private async configureRun(node?: ProjectCommandTarget, settings?: RunSettings): Promise<void> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return; }
        const kit = await this.kitForProject(projectPath);
        if (!kit) { return; }
        const preferences = this.preferences(projectPath);
        if (settings !== undefined) { await this.saveRunSettings(projectPath, kit, preferences.configuration, settings); return; }
        this.openProjectSettings(projectPath, "run");
    }

    private async configureBuild(node?: ProjectCommandTarget, settings?: BuildSettings): Promise<void> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return; }
        const kit = await this.kitForProject(projectPath);
        if (!kit) { return; }
        const preferences = this.preferences(projectPath);
        const save = async (value: BuildSettings): Promise<void> => {
            saveBuildConfiguration(this.storagePath, projectPath, buildSettingsKey(kit.id, preferences.configuration), value);
            if (preferences.buildProfiles?.[kit.id]) {
                const builds = getBuildConfigurations(preferences, kit);
                builds.items.find(item => item.id === builds.activeId)!.settings = value;
                saveConfigurations(this.storagePath, projectPath, "build-profiles", { ...preferences.buildProfiles, [kit.id]: validateBuildConfigurations(builds) });
            }
            await this.updateIntelliSense();
        };
        if (settings !== undefined) { await save(settings); return; }
        this.openProjectSettings(projectPath, "build");
    }

    private async configureDeploy(node?: ProjectCommandTarget): Promise<void> {
        const project = await this.chooseProject(node);
        if (project) { this.openProjectSettings(project, "deploy"); }
    }

    private async executeDeploy(plan: BuildPlan): Promise<void> {
        const configurations = getDeployConfigurations(this.preferences(plan.projectPath), plan.kit.id);
        const selected = configurations.items.find(item => item.id === configurations.activeId)!;
        if (!selected.steps.length) { return; }
        if (this.deploying.has(plan.projectPath)) { throw new Error("이 프로젝트는 이미 배포 중입니다."); }
        this.deploying.add(plan.projectPath);
        try {
            const result = await deployFiles(selected.steps, plan, defaultExecutable(plan, true), message => this.output.appendLine(message));
            this.output.appendLine(`Deploy: ${selected.name} · 복사 ${result.copied}, 변경 없음 ${result.unchanged}`);
        } finally { this.deploying.delete(plan.projectPath); }
    }

    private async deploy(node?: ProjectCommandTarget): Promise<boolean> {
        const project = await this.chooseProject(node);
        if (!project) { return false; }
        const kit = await this.kitForProject(project);
        if (!kit) { return false; }
        const plan = makeBuildPlan(project, kit, this.preferences(project), this.storagePath);
        if (!await this.executeBuild(plan, "build")) { return false; }
        await this.executeDeploy(plan);
        vscode.window.showInformationMessage(`Deploy 완료: ${path.basename(project)}`);
        return true;
    }

    private async selectRunTarget(projectPath: string, configuration = this.preferences(projectPath).configuration): Promise<string | undefined> {
        const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Executable: ["exe"] }, title: "이 프로젝트의 실행 파일 선택" });
        if (!chosen?.[0]) { return undefined; }
        const kit = await this.kitForProject(projectPath);
        if (!kit) { return undefined; }
        const settings = getRunSettings(this.preferences(projectPath), kit.id, configuration);
        await this.saveRunSettings(projectPath, kit, configuration, { ...settings, executable: chosen[0].fsPath });
        return chosen[0].fsPath;
    }

    private async runExecutable(plan: BuildPlan, settings: RunConfiguration, interactive = true): Promise<string | undefined> {
        if (settings.kind === "custom" && !settings.executable) { throw new Error(`${settings.name}: Run Settings에서 Executable을 지정하세요.`); }
        const configured = configuredExecutable(plan, settings);
        if (configured) { return configured; }
        const executables = buildExecutables(plan);
        if (executables.length === 1) { return executables[0]; }
        if (executables.length > 1) {
            if (!interactive) { throw new Error("실행 파일이 여러 개입니다. Run Settings에 EXE를 지정하고 실행 구성을 선택하세요."); }
            const choices = executables.map(executable => ({ label: path.basename(executable), description: executable, executable }));
            const chosen = await vscode.window.showQuickPick(choices, { title: `${path.basename(plan.projectPath)} — 실행할 프로그램 선택` });
            if (chosen) { await this.saveRunSettings(plan.projectPath, plan.kit, plan.configuration, { ...settings, executable: chosen.executable }, settings.id); }
            return chosen?.executable;
        }
        throw new Error(`${path.basename(plan.projectPath)}: 빌드 대상에 실행 가능한 EXE가 없습니다. 실행 대상이 있는 프로젝트를 선택하거나 Run Settings에서 Executable을 지정하세요.`);
    }

    private async executeBuild(plan: BuildPlan, operation: BuildOperation): Promise<boolean> {
        if (!await vscode.workspace.saveAll(false)) { return false; }
        this.output.appendLine(`Project: ${plan.projectPath}\nKit: ${plan.kit.name}\nConfiguration: ${plan.configuration}\nBuild: ${plan.buildDirectory}\nOperation: ${operation}`);
        const succeeded = await this.builder.execute(plan, operation);
        if (!succeeded) { return false; }
        this.tree.setCMakePlan(plan);
        await this.updateIntelliSense(plan);
        return true;
    }

    private async build(node?: ProjectCommandTarget, shouldRun = false, operation: BuildOperation = "build"): Promise<boolean> {
        const projectPath = shouldRun ? await this.chooseRunProject(node) : await this.chooseProject(node);
        if (!projectPath) { return false; }
        const kit = await this.kitForProject(projectPath);
        if (!kit) { return false; }
        const preferences = this.preferences(projectPath);
        const settings = activeRunConfiguration(getRunConfigurationSet(preferences, kit.id));
        const plan = makeBuildPlan(projectPath, kit, preferences, this.storagePath);
        const succeeded = await this.executeBuild(plan, operation);
        if (!succeeded) { return false; }
        if (!shouldRun) { return true; }
        await this.executeDeploy(plan);
        const executable = await this.runExecutable(plan, settings);
        if (executable) { return this.builder.run(plan, makeRunTarget(plan, settings, executable)); }
        return false;
    }

    private async resolveDebugConfiguration(configuration: vscode.DebugConfiguration, token?: vscode.CancellationToken): Promise<vscode.DebugConfiguration | undefined> {
        if (token?.isCancellationRequested) { return undefined; }
        if (!vscode.workspace.isTrusted) { throw new Error("프로젝트를 신뢰한 후 디버깅하세요."); }
        const editorUri = vscode.window.activeTextEditor?.document.uri;
        const isProjectEditor = editorUri ? isProjectFile(editorUri.fsPath) : false;
        const requested = configuration.qtProject ?? (!this.activeProject && isProjectEditor ? editorUri?.fsPath : undefined);
        if (requested) { await this.openProject(vscode.Uri.file(requested), false, false); }
        const projectPath = requested ? await this.chooseProject(vscode.Uri.file(requested)) : await this.chooseRunProject();
        if (!projectPath) { return undefined; }
        const kit = configuration.qtControl ? loadKits(this.kitsPath).find(item => item.id === this.preferences(projectPath).kitId) : await this.kitForProject(projectPath);
        if (!kit) { throw new Error("디버그할 프로젝트의 키트를 먼저 선택하세요."); }
        const debuggerPath = debuggerPathForKit(kit);
        if (kit.debuggerType !== "msvc" && !fs.existsSync(debuggerPath)) { throw new Error(`이 키트의 GDB를 찾을 수 없습니다: ${debuggerPath}. Kit Settings의 디버거 항목에서 지정하세요.`); }
        const cppExtension = vscode.extensions.getExtension("ms-vscode.cpptools");
        if (!cppExtension) { throw new Error("Microsoft C/C++ 확장이 필요합니다."); }
        await cppExtension.activate();
        const preferences = this.preferences(projectPath);
        const plan = makeBuildPlan(projectPath, kit, preferences, this.storagePath);
        const settings = activeRunConfiguration(getRunConfigurationSet(preferences, kit.id));
        const succeeded = await this.executeBuild(plan, "build");
        if (!succeeded) { return undefined; }
        if (token?.isCancellationRequested) { return undefined; }
        await this.executeDeploy(plan);
        const executable = await this.runExecutable(plan, settings, !configuration.qtControl);
        if (!executable) { return undefined; }
        const result = makeDebugConfiguration(plan, makeRunTarget(plan, settings, executable)) as vscode.DebugConfiguration;
        result.stopAtEntry = configuration.stopAtEntry ?? false;
        result.noDebug = configuration.noDebug ?? false;
        result.qtProProject = projectPath;
        return result;
    }

    private async debug(node?: ProjectCommandTarget): Promise<boolean> {
        const projectPath = await this.chooseRunProject(node);
        if (!projectPath) { return false; }
        return vscode.debug.startDebugging(undefined, { type: "qt-pro", request: "launch", name: "Qt Pro", qtProject: projectPath });
    }

    private registerDebugger(): void {
        this.context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("qt-pro", {
            provideDebugConfigurations: () => [{ type: "qt-pro", request: "launch", name: "Qt Pro: 선택한 프로젝트 디버그" }],
            resolveDebugConfiguration: async (_folder, configuration, token) => {
                try { return await this.resolveDebugConfiguration(configuration, token); }
                catch (error) { this.control.recordLog("debug-launch", String(error)); vscode.window.showErrorMessage(`Qt Pro: ${String(error)}`); return undefined; }
            }
        }));
    }

    private async openBuildFolder(node?: ProjectCommandTarget): Promise<void> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return; }
        const kit = await this.kitForProject(projectPath);
        if (!kit) { return; }
        const plan = makeBuildPlan(projectPath, kit, this.preferences(projectPath), this.storagePath);
        fs.mkdirSync(plan.buildDirectory, { recursive: true });
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(plan.buildDirectory));
    }

    private async closeProject(node?: ProjectCommandTarget): Promise<void> {
        const projectPath = await this.chooseProject(node);
        if (!projectPath) { return; }
        this.tree.remove(projectPath);
        this.activeProject = this.tree.projects()[0];
        if (this.activeProject) { this.tree.setActive(this.activeProject); }
        await this.persistProjects();
        this.updateStatus();
        await this.updateIntelliSense();
    }

    private showDiagnostics(): void {
        if (!this.activeProject) { return; }
        const data = this.tree.getProject(this.activeProject);
        const description = isCMakeProject(data.projectPath) ? "Configure 전에는 소스 폴더, 이후에는 CMake File API의 대상 정보를 표시합니다." : "파일 트리는 조건별 선언을 합쳐 보여줍니다. 실제 빌드는 선택한 키트의 qmake가 해석합니다.";
        this.output.appendLine(`\n${data.projectPath}\n${description}`);
        for (const note of data.notes) { this.output.appendLine(note); }
        if (!data.notes.length) { this.output.appendLine("파일 목록 해석 중 추가 참고 사항이 없습니다."); }
        this.output.show();
    }

    private register(command: string, action: (...args: any[]) => unknown): void {
        const disposable = vscode.commands.registerCommand(command, async (...args: any[]) => {
            try { return await action(...args); } catch (error) { vscode.window.showErrorMessage(`Qt Pro: ${String(error)}`); }
        });
        this.context.subscriptions.push(disposable);
    }

    private controlRequest(request: ControlRequest): Promise<unknown> {
        const instanceId = request.arguments?.instanceId;
        if (instanceId !== undefined && instanceId !== this.controlServer.instanceId) { return Promise.reject(new Error("다른 VS Code 창의 요청입니다.")); }
        return this.control.execute(request);
    }

    private registerCommands(): void {
        this.context.subscriptions.push(vscode.commands.registerCommand("qtPro.control", (request: ControlRequest) => this.controlRequest(request)));
        this.register("qtPro.showControlGuide", () => vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.joinPath(this.context.extensionUri, "CODEX-CONTROL.md")));
        this.register("qtPro.addProject", () => this.openProject());
        this.register("qtPro.openProject", (uri?: vscode.Uri) => this.openProject(uri));
        this.register("qtPro.openRecent", () => this.openRecent());
        this.register("qtPro.selectActiveProject", (node?: ProjectCommandTarget) => this.selectActiveProject(node));
        this.register("qtPro.selectKit", (node?: ProjectCommandTarget) => this.selectKit(node));
        this.register("qtPro.selectConfiguration", (node?: ProjectCommandTarget) => this.selectConfiguration(node));
        this.register("qtPro.configureRun", (node?: ProjectCommandTarget, settings?: RunSettings) => this.configureRun(node, settings));
        this.register("qtPro.configureBuild", (node?: ProjectCommandTarget, settings?: BuildSettings) => this.configureBuild(node, settings));
        this.register("qtPro.configureDeploy", (node?: ProjectCommandTarget) => this.configureDeploy(node));
        this.register("qtPro.deploy", (node?: ProjectCommandTarget) => this.deploy(node));
        this.register("qtPro.build", (node?: ProjectCommandTarget) => this.build(node));
        this.register("qtPro.buildActions", async () => {
            const projectPath = await this.chooseProject();
            if (!projectPath) { return undefined; }
            return this.buildActions.show(projectPath, this.preferences(projectPath).configuration);
        });
        this.register("qtPro.configure", (node?: ProjectCommandTarget) => this.build(node, false, "qmake"));
        this.register("qtPro.qmake", (node?: ProjectCommandTarget) => this.build(node, false, "qmake"));
        this.register("qtPro.clean", (node?: ProjectCommandTarget) => this.build(node, false, "clean"));
        this.register("qtPro.rebuild", (node?: ProjectCommandTarget) => this.build(node, false, "rebuild"));
        this.register("qtPro.run", (node?: ProjectCommandTarget) => this.build(node, true));
        this.register("qtPro.debug", (node?: ProjectCommandTarget) => this.debug(node));
        this.register("qtPro.findReferences", (uri?: vscode.Uri, position?: vscode.Position) => this.references.findReferences(uri, position));
        this.register("qtPro.refreshReferences", () => this.references.refresh());
        this.register("qtPro.findName", (name?: string) => this.references.findName(name));
        this.register("qtPro.refresh", () => this.tree.refresh());
        this.register("qtPro.revealActiveFile", () => this.navigation.reveal());
        this.register("qtPro.toggleAutoReveal", () => this.navigation.toggle());
        this.register("qtPro.closeProject", (node?: ProjectCommandTarget) => this.closeProject(node));
        this.register("qtPro.openBuildFolder", (node?: ProjectCommandTarget) => this.openBuildFolder(node));
        this.register("qtPro.showDiagnostics", () => this.showDiagnostics());
        this.register("qtPro.editKits", () => this.editKits());
        this.register("qtPro.restoreCppProvider", async () => {
            if (!this.context.globalState.get("cppProviderBackupSaved")) { return; }
            const previous = this.context.globalState.get<string>("previousCppProvider");
            await vscode.workspace.getConfiguration("C_Cpp").update("default.configurationProvider", previous, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage("이전 C/C++ 구성 공급자를 복원했습니다. Qt 키트를 다시 선택하면 Qt Pro가 다시 적용됩니다.");
        });
        this.register("qtPro.showGuide", () => vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.joinPath(this.context.extensionUri, "README.md")));
        this.register("qtPro.selectRunTarget", async (node?: ProjectCommandTarget) => {
            const projectPath = await this.chooseProject(node);
            if (projectPath) { await this.selectRunTarget(projectPath); }
        });
    }

    public constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.storagePath = context.globalStorageUri.fsPath;
        this.kitsPath = path.join(this.storagePath, "kits.json");
        fs.mkdirSync(this.storagePath, { recursive: true });
        const newKits = !fs.existsSync(this.kitsPath);
        if (newKits) {
            const additional = vscode.workspace.getConfiguration("qt-core").get<{ path: string }[]>("additionalQtPaths") ?? [];
            fs.writeFileSync(this.kitsPath, JSON.stringify(discoverKits(additional.map(item => item.path)), null, 4), "utf8");
        }
        try {
            const imported = importQtCreatorOnce(context.extensionPath, this.kitsPath, undefined, newKits);
            if (imported) { this.output.appendLine(`Qt Creator 최초 가져오기: 추가 ${imported.added}, 기본값 보완 ${imported.updated}. ${imported.skipped.join("; ")}`); }
        } catch (error) { this.output.appendLine(`Qt Creator 최초 가져오기 실패: ${String(error)}`); }
        const referenceSession = loadReferenceSession(this.storagePath);
        const saved = referenceSession?.projects ?? context.workspaceState.get<string[]>("projects") ?? [];
        this.tree = new TXProjectTree(saved.filter(project => fs.existsSync(project)), project => {
            const preferences = this.preferences(project);
            const kit = loadKits(this.kitsPath).find(item => item.id === preferences.kitId);
            if (!kit) { return undefined; }
            try { return makeBuildPlan(project, kit, preferences, this.storagePath); }
            catch { return undefined; }
        });
        this.activeProject = referenceSession?.activeProject ?? context.workspaceState.get<string>("activeProject");
        if (this.activeProject && !fs.existsSync(this.activeProject)) { this.activeProject = undefined; }
        if (this.activeProject) { this.activeProject = rootProjectForPath(this.activeProject, this.tree.projects(), project => this.tree.getProject(project).children); }
        if (this.activeProject) { this.tree.setActive(this.activeProject); }
        this.cppProjects = new TXIntelliSenseProjects({
            projects: () => this.tree.projects(), getProject: projectPath => this.tree.getProject(projectPath),
            preferences: projectPath => this.preferences(projectPath), kits: () => loadKits(this.kitsPath),
            activeProject: () => this.activeProject, storagePath: this.storagePath,
            reportError: error => this.output.appendLine(`C/C++ 분석 설정: ${String(error)}`)
        });
        this.intelliSense = new TXIntelliSense(context, this.cppProjects, (key, value) => this.writeGlobalState(key, value));
        const view = vscode.window.createTreeView("qtProProjects", { treeDataProvider: this.tree, showCollapseAll: true });
        this.navigation = new TXProjectNavigation(this.tree, view, error => this.output.appendLine(`파일 트리 선택: ${String(error)}`));
        context.subscriptions.push(this.navigation, new TXBookmarks(this.storagePath, context.extensionUri));
        this.configurationStatus.name = "Qt Pro: Build Configuration";
        this.configurationStatus.tooltip = "빌드 구성 선택";
        this.configurationStatus.command = "qtPro.selectConfiguration";
        this.projectStatus.name = "Qt Pro: Active Project";
        this.projectStatus.command = "qtPro.selectActiveProject";
        this.references = new TXReferences({ storage: this.storagePath, projects: () => this.tree.projects(), getProject: project => this.tree.getProject(project), activeProject: () => this.activeProject });
        context.subscriptions.push(this.references);
        this.registerCommands();
        this.registerDebugger();
        this.control = new TXWorkbenchControl({
            state: () => this.projectSettingsController().state(),
            openProject: project => this.openProject(vscode.Uri.file(project), false),
            select: async change => {
                await this.projectSettingsController().select(change);
                for (const [panel, controller] of this.projectSettingsViews) { await panel.webview.postMessage({ type: "state", state: controller.state() }); }
            },
            build: (project, operation) => operation === "deploy" ? this.deploy(vscode.Uri.file(project)) : this.build(vscode.Uri.file(project), false, (operation === "configure" ? "qmake" : operation) as BuildOperation),
            debug: async (project, stopAtEntry) => vscode.debug.startDebugging(undefined, { type: "qt-pro", request: "launch", name: "Qt Pro", qtProject: project, qtControl: true, stopAtEntry })
        });
        this.controlServer = new TXLocalControlServer(request => this.controlRequest(request));
        context.subscriptions.push(this.control, this.controlServer);
        this.updateStatus();
        context.subscriptions.push(this.tree, view, this.output, this.configurationStatus, this.projectStatus, this.buildActions, this.projectActions, this.intelliSense);
        context.subscriptions.push(this.tree.onDidChangeTreeData(() => this.scheduleIntelliSense()));
        context.subscriptions.push({ dispose: () => { if (this.cppRefreshTimer) { clearTimeout(this.cppRefreshTimer); } } });
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => this.onOpenDocument(document)));
        context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
            if (state.focused) { this.tree.refresh(); this.updateStatus(); }
        }));
        for (const document of vscode.workspace.textDocuments) {
            const isStandalone = !vscode.workspace.workspaceFolders?.length;
            const isActiveDocument = document === vscode.window.activeTextEditor?.document;
            this.onOpenDocument(document, isStandalone && isActiveDocument);
        }
    }

    public async initializeIntelliSense(): Promise<void> { await this.updateIntelliSense(); }

    public async resumeReferences(): Promise<void> {
        if (loadReferenceSession(this.storagePath)) { await this.persistProjects(); }
        const reference = await restoreReferenceDocuments(this.storagePath);
        if (!reference) { return; }
        await this.updateIntelliSense();
        await this.references.findReferences(vscode.Uri.file(reference.file), new vscode.Position(reference.line, reference.character));
    }

    public async initializeControl(): Promise<void> {
        const debugStorage = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "QtProWorkbench") : this.storagePath;
        installDebugRuntime(this.context.extensionPath, debugStorage);
        installControlCli(this.context.extensionPath);
        await this.controlServer.start();
        try { installControlSkill(this.context.extensionPath); }
        catch (error) { this.output.appendLine(`Codex 제어 스킬: ${String(error)}`); }
    }

    public controlApi(): { version: number; instanceId: string; execute: (request: ControlRequest) => Promise<unknown> } { return { version: 1, instanceId: this.controlServer.instanceId, execute: request => this.controlRequest(request) }; }

    public onOpenDocument(document: vscode.TextDocument, shouldFocus = true): void {
        if (document.uri.scheme !== "file") { return; }
        if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(document.fileName)) { this.scheduleIntelliSense(); return; }
        if (!isProjectFile(document.fileName)) { return; }
        if (!vscode.workspace.getConfiguration("qtPro").get<boolean>("autoOpenPro", true)) { return; }
        void this.openProject(document.uri, shouldFocus, false).catch(error => this.output.appendLine(String(error)));
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<ReturnType<TXWorkbench["controlApi"]>> {
    await importPublisherSettings(context);
    const cppSettings = vscode.workspace.getConfiguration("C_Cpp");
    if (cppSettings.get("default.configurationProvider") === "personal.qt-pro-workbench") {
        await cppSettings.update("default.configurationProvider", "ynlim.qt-pro-workbench", vscode.ConfigurationTarget.Global);
    }
    const workbench = new TXWorkbench(context);
    try { await workbench.initializeIntelliSense(); }
    catch (error) { void vscode.window.showErrorMessage(`Qt Pro: C/C++ 분석 설정 초기화 실패: ${String(error)}`); }
    try { await ensureUserDebugLaunch(vscode.workspace.getConfiguration()); }
    catch (error) { void vscode.window.showErrorMessage(`Qt Pro: 기본 실행 및 디버그 연결 실패: ${String(error)}`); }
    try { await workbench.initializeControl(); }
    catch (error) { void vscode.window.showErrorMessage(`Qt Pro: Codex 제어 연결 실패: ${String(error)}`); }
    void workbench.resumeReferences().catch(error => vscode.window.showErrorMessage(`Qt Pro: ${String(error)}`));
    return workbench.controlApi();
}
