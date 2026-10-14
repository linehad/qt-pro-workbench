import type { BuildConfigurationSet, DeployConfigurationSet, ConfigurationChange } from "./XConfigurationTypes";
import type { BuildSettings } from "./XBuildSettingsTypes";
import type { RunConfigurationSet, RunConfigurationChange, RunSettings } from "./XRunTypes";

export type SettingsTab = "build" | "deploy" | "run";

export interface ProjectSelectionState {
    buildSystem?: "qmake" | "cmake";
    cmakePath?: string;
    projects: { projectPath: string; name: string }[];
    projectPath?: string;
    activeProject?: string;
    configuration: "debug" | "release";
    kits: { id: string; name: string }[];
    kitId?: string;
    kitName: string;
    builds?: BuildConfigurationSet;
    deploys?: DeployConfigurationSet;
    runs?: RunConfigurationSet;
    automaticExecutable: string;
    buildDirectory: string;
    qmakePath: string;
    makePath: string;
    debuggerPath: string;
}

export interface ProjectSettingsDraft {
    projectPath: string;
    kitId: string;
    configuration: "debug" | "release";
    buildId: string;
    deployId: string;
    runId: string;
    build: BuildSettings;
    deploy: DeployConfigurationSet["items"][number]["steps"];
    run: RunSettings;
}

export interface ProjectSelectionChange {
    field: "project" | "kit" | "manageKits" | "save" | "build" | "deploy" | "run";
    value?: string;
    draft?: ProjectSettingsDraft;
    change?: ConfigurationChange | RunConfigurationChange | { action: "add"; name: string; configuration?: "debug" | "release" };
}
