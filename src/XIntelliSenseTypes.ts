import type * as vscode from "vscode";
import type { BuildPlan, ProjectData, ProjectPreferences, QtKit } from "./XProjectTypes";

export interface CppConfiguration {
    includePath: string[];
    defines: string[];
    compilerPath: string;
    compilerArgs: string[];
    intelliSenseMode: string;
    standard: string;
}

export interface CppBrowseConfiguration {
    browsePath: string[];
    compilerPath?: string;
    compilerArgs?: string[];
    standard?: string;
}

export interface IntelliSenseProjectsInfo {
    projects: () => string[];
    getProject: (projectPath: string) => ProjectData;
    preferences: (projectPath: string) => ProjectPreferences;
    kits: () => QtKit[];
    activeProject: () => string | undefined;
    storagePath: string;
    reportError: (error: unknown) => void;
}

export interface CppProvider extends vscode.Disposable {
    name: string;
    extensionId: string;
    canProvideConfiguration(uri: vscode.Uri): Promise<boolean>;
    provideConfigurations(uris: vscode.Uri[]): Promise<{ uri: vscode.Uri; configuration: CppConfiguration }[]>;
    canProvideBrowseConfiguration(): Promise<boolean>;
    provideBrowseConfiguration(): Promise<CppBrowseConfiguration | null>;
    canProvideBrowseConfigurationsPerFolder(): Promise<boolean>;
    provideFolderBrowseConfiguration(uri: vscode.Uri): Promise<CppBrowseConfiguration | null>;
}

export interface CppApi extends vscode.Disposable {
    registerCustomConfigurationProvider(provider: CppProvider): void;
    notifyReady(provider: CppProvider): void;
    didChangeCustomConfiguration(provider: CppProvider): void;
    didChangeCustomBrowseConfiguration(provider: CppProvider): void;
}
