export interface RunSettings {
    executable: string;
    arguments: string;
    workingDirectory: string;
    environment?: string;
    startupCommands?: string;
    runInTerminal?: boolean;
}

export interface RunTarget {
    executable: string;
    argumentsList: string[];
    workingDirectory: string;
    environment?: Record<string, string>;
    startupCommands?: string[];
    runInTerminal?: boolean;
}

export interface RunConfiguration extends RunSettings {
    id: string;
    name: string;
    kind: "project" | "custom";
}

export interface RunConfigurationSet {
    activeId: string;
    items: RunConfiguration[];
}

export type StoredRunConfigurations = Record<string, RunSettings | RunConfigurationSet>;

export type RunConfigurationChange =
    | { action: "save"; id: string; settings: RunSettings }
    | { action: "select"; id: string }
    | { action: "add"; kind: RunConfiguration["kind"]; name: string }
    | { action: "clone" | "rename"; id: string; name: string }
    | { action: "remove"; id: string };
