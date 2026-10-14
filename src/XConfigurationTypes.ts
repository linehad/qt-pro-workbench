import type { BuildSettings } from "./XBuildSettingsTypes";

export interface BuildConfiguration {
    id: string;
    name: string;
    configuration: "debug" | "release";
    settings: BuildSettings;
}

export interface NamedConfigurationSet<T> {
    activeId: string;
    items: T[];
}

export interface DeployStep {
    id: string;
    source: string;
    destination: string;
}

export interface DeployConfiguration {
    id: string;
    name: string;
    steps: DeployStep[];
}

export type BuildConfigurationSet = NamedConfigurationSet<BuildConfiguration>;
export type DeployConfigurationSet = NamedConfigurationSet<DeployConfiguration>;
export type ConfigurationChange =
    | { action: "select" | "remove"; id: string }
    | { action: "rename" | "clone"; id: string; name: string };
