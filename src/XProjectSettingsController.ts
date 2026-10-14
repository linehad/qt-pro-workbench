import * as path from "node:path";
import { isCMakeProject, projectName } from "./XProjectIdentity";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { loadKits } from "./XKitStore";
import { makeBuildPlan } from "./XBuildPlan";
import { defaultExecutable } from "./XBuildOutput";
import { debuggerPathForKit } from "./XDebugConfiguration";
import { getBuildSettings, validateBuildSettings, buildSettingsKey } from "./XBuildSettings";
import { changeConfiguration, configurationName, getBuildConfigurations, getDeployConfigurations, uniqueConfigurationName, validateBuildConfigurations, validateDeployConfigurations } from "./XConfigurations";
import { saveConfigurations } from "./XConfigurationStore";
import { changeRunConfiguration, getRunConfigurationSet, runSettingsKey } from "./XRunConfigurations";
import { validateRunSettings } from "./XRunValidation";
import { saveRunConfigurations } from "./XRunSettingsStore";
import type { ProjectPreferences, QtKit } from "./XProjectTypes";
import type { ConfigurationChange } from "./XConfigurationTypes";
import type { ProjectSelectionChange, ProjectSelectionState, ProjectSettingsDraft } from "./XProjectSelectionTypes";
import type { RunConfigurationChange } from "./XRunTypes";

interface ProjectSettingsControllerInfo {
    storagePath: string;
    kitsPath: string;
    projects: () => string[];
    activeProject: () => string | undefined;
    preferences: (project: string) => ProjectPreferences;
    savePreferences: (project: string, preferences: ProjectPreferences) => Promise<void>;
    activate: (project: string) => Promise<void>;
    refresh: () => Promise<void>;
    manageKits: () => void;
}

export class TXProjectSettingsController {
    private readonly info: ProjectSettingsControllerInfo;
    private projectPath: string | undefined;

    private kit(preferences: ProjectPreferences): QtKit {
        const kit = loadKits(this.info.kitsPath).find(item => item.id === preferences.kitId);
        if (!kit) { throw new Error("프로젝트의 키트를 선택하세요."); }
        return kit;
    }

    private async saveDraft(draft: ProjectSettingsDraft): Promise<void> {
        if (draft.projectPath !== this.projectPath) { throw new Error("설정 대상 프로젝트가 변경되었습니다. 다시 불러오세요."); }
        const preferences = this.info.preferences(draft.projectPath);
        if (draft.kitId !== preferences.kitId || draft.configuration !== preferences.configuration) { throw new Error("키트 또는 빌드 구성이 변경되었습니다. 다시 불러오세요."); }
        const kit = this.kit(preferences);
        const builds = getBuildConfigurations(preferences, kit);
        const deploys = getDeployConfigurations(preferences, kit.id);
        const runs = getRunConfigurationSet(preferences, kit.id, preferences.configuration, projectName(draft.projectPath));
        if (draft.buildId !== builds.activeId || draft.deployId !== deploys.activeId || draft.runId !== runs.activeId) { throw new Error("활성 구성이 변경되었습니다. 다시 불러오세요."); }
        const build = builds.items.find(item => item.id === draft.buildId)!;
        build.settings = validateBuildSettings(draft.build);
        const checkedBuilds = validateBuildConfigurations(builds);
        deploys.items.find(item => item.id === draft.deployId)!.steps = draft.deploy;
        const checkedDeploys = validateDeployConfigurations(deploys);
        const checkedRuns = changeRunConfiguration(runs, { action: "save", id: draft.runId, settings: validateRunSettings(draft.run) });
        // Validate all three drafts before persisting any of them.
        saveConfigurations(this.info.storagePath, draft.projectPath, "build-profiles", { ...preferences.buildProfiles, [kit.id]: checkedBuilds });
        saveConfigurations(this.info.storagePath, draft.projectPath, "deploy-configurations", { ...preferences.deployConfigurations, [buildSettingsKey(kit.id, draft.configuration)]: checkedDeploys });
        saveRunConfigurations(this.info.storagePath, draft.projectPath, { ...preferences.runConfigurations, [runSettingsKey(kit.id, draft.configuration)]: checkedRuns });
        await this.info.refresh();
    }

    public constructor(info: ProjectSettingsControllerInfo, projectPath?: string) { this.info = info; this.projectPath = projectPath ?? info.activeProject(); }

    public state(): ProjectSelectionState {
        const projectPath = this.projectPath ?? this.info.activeProject();
        const projects = this.info.projects();
        if (projectPath && !projects.includes(projectPath)) { projects.push(projectPath); }
        const preferences = projectPath ? this.info.preferences(projectPath) : { configuration: "debug" as const };
        const kits = loadKits(this.info.kitsPath).filter(item => !projectPath || isCMakeProject(projectPath) || item.qmakePath);
        const kit = kits.find(item => item.id === preferences.kitId);
        const plan = projectPath && kit ? makeBuildPlan(projectPath, kit, preferences, this.info.storagePath) : undefined;
        return {
            projects: projects.map(project => ({ projectPath: project, name: projectName(project) })),
            buildSystem: projectPath && isCMakeProject(projectPath) ? "cmake" : "qmake", cmakePath: plan?.cmakePath ?? "",
            projectPath, activeProject: this.info.activeProject(), configuration: preferences.configuration,
            kits: kits.map(item => ({ id: item.id, name: item.name })), kitId: kit?.id, kitName: kit?.name ?? "키트를 선택하세요",
            builds: kit ? getBuildConfigurations(preferences, kit) : undefined,
            deploys: kit ? getDeployConfigurations(preferences, kit.id) : undefined,
            runs: kit ? getRunConfigurationSet(preferences, kit.id, preferences.configuration, projectName(projectPath!)) : undefined,
            automaticExecutable: plan ? defaultExecutable(plan, true) ?? "" : "",
            buildDirectory: plan?.buildDirectory ?? "", qmakePath: kit?.qmakePath ?? "", makePath: kit?.makePath ?? "", debuggerPath: kit ? debuggerPathForKit(kit) : ""
        };
    }

    public async select(change: ProjectSelectionChange): Promise<void> {
        if (change.draft) { await this.saveDraft(change.draft); }
        if (change.field === "save") { return; }
        if (change.field === "manageKits") { this.info.manageKits(); return; }
        if (change.field === "project") {
            const selected = this.state().projects.find(item => item.projectPath === change.value);
            if (!selected) { throw new Error("열려 있는 프로젝트를 선택하세요."); }
            this.projectPath = selected.projectPath;
            if (this.info.projects().includes(selected.projectPath)) { await this.info.activate(selected.projectPath); }
            return;
        }
        if (!this.projectPath) { throw new Error("Qt 프로젝트를 먼저 열어 주세요."); }
        const project = this.projectPath;
        const preferences = this.info.preferences(project);
        if (change.field === "kit") {
            const kit = loadKits(this.info.kitsPath).find(item => item.id === change.value);
            if (!kit) { throw new Error("사용할 키트를 선택하세요."); }
            if (!isCMakeProject(project) && !kit.qmakePath) { throw new Error("qmake 프로젝트에는 Qt · qmake 키트를 선택하세요."); }
            await this.info.savePreferences(project, { ...preferences, kitId: kit.id }); return;
        }
        const kit = this.kit(preferences);
        const action = change.change?.action;
        if (!action || !["add", "select", "remove", "rename", "clone"].includes(action)) { throw new Error("구성 작업을 확인하세요."); }
        if (change.field === "build" || change.field === "deploy") {
            const isBuild = change.field === "build";
            let configurations = isBuild ? getBuildConfigurations(preferences, kit) : getDeployConfigurations(preferences, kit.id);
            if (action === "add") {
                const mode = isBuild ? await vscode.window.showQuickPick(["debug", "release"], { title: "새 빌드 구성 종류" }) : undefined;
                if (isBuild && !mode) { return; }
                const proposed = isBuild ? (mode === "debug" ? "Debug" : "Release") : "Deploy Configuration";
                const name = await vscode.window.showInputBox({ title: "새 구성 이름", value: uniqueConfigurationName(configurations.items, proposed), validateInput: value => value.trim() ? undefined : "이름을 입력하세요." });
                if (name === undefined) { return; }
                const id = randomUUID();
                if (isBuild) {
                    const builds = validateBuildConfigurations(configurations);
                    builds.items.push({ id, name: configurationName(name), configuration: mode as "debug" | "release", settings: getBuildSettings({ ...preferences, configuration: mode as "debug" | "release", buildProfiles: undefined }, kit) });
                    configurations = builds;
                } else {
                    const deploys = validateDeployConfigurations(configurations);
                    deploys.items.push({ id, name: configurationName(name), steps: [] });
                    configurations = deploys;
                }
                configurations.activeId = id;
            } else {
                const operation = change.change as ConfigurationChange;
                if (action === "rename" || action === "clone") {
                    const current = configurations.items.find(item => item.id === operation.id);
                    if (!current) { throw new Error("구성이 목록에 없습니다."); }
                    const proposed = action === "clone" ? uniqueConfigurationName(configurations.items, `${current.name} (복사)`) : current.name;
                    const name = await vscode.window.showInputBox({ title: action === "clone" ? "복제 구성 이름" : "구성 이름 변경", value: proposed });
                    if (name === undefined) { return; }
                    (operation as { name: string }).name = name;
                }
                configurations = isBuild ? changeConfiguration(getBuildConfigurations(preferences, kit), operation) : changeConfiguration(getDeployConfigurations(preferences, kit.id), operation);
            }
            if (isBuild) {
                const checked = validateBuildConfigurations(configurations);
                saveConfigurations(this.info.storagePath, project, "build-profiles", { ...preferences.buildProfiles, [kit.id]: checked });
                const configuration = checked.items.find(item => item.id === checked.activeId)!.configuration;
                const runExecutable = configuration === preferences.configuration ? preferences.runExecutable : undefined;
                await this.info.savePreferences(project, { ...this.info.preferences(project), configuration, runExecutable });
            } else {
                const checked = validateDeployConfigurations(configurations);
                saveConfigurations(this.info.storagePath, project, "deploy-configurations", { ...preferences.deployConfigurations, [buildSettingsKey(kit.id, preferences.configuration)]: checked });
            }
            return;
        }
        if (change.field !== "run") { throw new Error("설정 항목을 확인하세요."); }
        const runs = getRunConfigurationSet(preferences, kit.id, preferences.configuration, projectName(project));
        let operation = change.change as RunConfigurationChange;
        if (action === "add") {
            const kind = await vscode.window.showQuickPick([{ label: "Custom Executable", runKind: "custom" as const }, { label: "프로젝트 빌드 결과", runKind: "project" as const }], { title: "실행 구성 추가" });
            if (!kind) { return; }
            const name = await vscode.window.showInputBox({ title: "실행 구성 이름", value: kind.label });
            if (name === undefined) { return; }
            operation = { action: "add", kind: kind.runKind, name };
        } else if (action === "rename" || action === "clone") {
            const item = runs.items.find(entry => entry.id === (operation as { id: string }).id);
            if (!item) { throw new Error("실행 구성이 목록에 없습니다."); }
            const name = await vscode.window.showInputBox({ title: action === "clone" ? "실행 구성 복제" : "실행 구성 이름 변경", value: action === "clone" ? `${item.name} (복사)` : item.name });
            if (name === undefined) { return; }
            operation = { action, id: item.id, name };
        }
        saveRunConfigurations(this.info.storagePath, project, { ...preferences.runConfigurations, [runSettingsKey(kit.id, preferences.configuration)]: changeRunConfiguration(runs, operation) });
    }
}
