export type FileGroup = "Project Files" | "Headers" | "Sources" | "Forms" | "Resources" | "Translations" | "Other Files";

export interface ProjectPart {
    filePath: string;
    includes: string[];
    groups: Map<FileGroup, string[]>;
    fileActivity: Map<string, boolean>;
}

export interface ProjectData {
    projectPath: string;
    name: string;
    template: string;
    groups: Map<FileGroup, string[]>;
    parts: Map<string, ProjectPart>;
    children: string[];
    watchedPaths: string[];
    notes: string[];
    includePaths: string[];
    defines: string[];
    config: string[];
}

export interface QtKit {
    id: string;
    name: string;
    qmakePath: string;
    compilerDirectory: string;
    makePath: string;
    debuggerPath?: string;
    spec?: string;
    environment?: Record<string, string>;
    qmakeArguments?: string[];
    makeArguments?: string[];
    cmakePath?: string;
    cmakeGenerator?: string;
    cmakeMakePath?: string;
    cmakePlatform?: string;
    cmakeToolchainFile?: string;
    cCompilerPath?: string;
    cxxCompilerPath?: string;
    debuggerType?: "gdb" | "msvc";
}

export interface ProjectPreferences {
    buildSystem?: "qmake" | "cmake";
    kitId?: string;
    configuration: "debug" | "release";
    runExecutable?: string;
    runConfigurations?: StoredRunConfigurations;
    buildConfigurations?: Record<string, BuildSettings>;
    buildProfiles?: Record<string, BuildConfigurationSet>;
    deployConfigurations?: Record<string, DeployConfigurationSet>;
}

export interface BuildPlan {
    buildSystem?: "qmake" | "cmake";
    cmakePath?: string;
    projectPath: string;
    configuration: "debug" | "release";
    buildDirectory: string;
    outputDirectory: string;
    qmakeArguments: string[];
    makeArguments: string[];
    cleanArguments?: string[];
    needsQmake?: boolean;
    qmakeState?: { filePath: string; signature: string };
    environment: Record<string, string>;
    kit: QtKit;
}
import type { StoredRunConfigurations } from "./XRunTypes";
import type { BuildSettings } from "./XBuildSettingsTypes";
import type { BuildConfigurationSet, DeployConfigurationSet } from "./XConfigurationTypes";

export type BuildOperation = "clean" | "qmake" | "build" | "rebuild";

