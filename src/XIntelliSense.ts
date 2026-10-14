import * as vscode from "vscode";
import type { TXIntelliSenseProjects } from "./XIntelliSenseProjects";
import type { CppApi, CppBrowseConfiguration, CppConfiguration, CppProvider } from "./XIntelliSenseTypes";

export class TXIntelliSense implements CppProvider {
    private api: CppApi | undefined;
    private initializing: Promise<void> | undefined;
    private readonly context: vscode.ExtensionContext;

    private async initialize(): Promise<void> {
        const extension = vscode.extensions.getExtension<{ getApi(version: number): CppApi }>("ms-vscode.cpptools");
        if (!extension) { return; }
        const exports = await extension.activate();
        this.api = exports.getApi(5);
        this.api.registerCustomConfigurationProvider(this);
        const settings = vscode.workspace.getConfiguration("C_Cpp", null);
        const settingName = "default.configurationProvider";
        if (settings.get<string>(settingName) !== this.extensionId) {
            if (!this.context.globalState.get("cppProviderBackupSaved")) {
                await this.writeState("previousCppProvider", settings.inspect(settingName)?.globalValue);
                await this.writeState("cppProviderBackupSaved", true);
            }
            await settings.update(settingName, this.extensionId, vscode.ConfigurationTarget.Global);
        }
        this.api.notifyReady(this);
    }

    public readonly name = "Qt Pro Workbench";
    public readonly extensionId = "ynlim.qt-pro-workbench";

    public constructor(context: vscode.ExtensionContext, private readonly projects: TXIntelliSenseProjects, private readonly writeState: (key: string, value: unknown) => Promise<void>) { this.context = context; }

    public async configure(): Promise<void> {
        this.initializing ??= this.initialize();
        await this.initializing;
        this.api?.didChangeCustomConfiguration(this);
        this.api?.didChangeCustomBrowseConfiguration(this);
    }

    public async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
        if (uri.scheme !== "file") { return false; }
        return Boolean(this.projects.configurationFor(uri.fsPath));
    }

    public async provideConfigurations(uris: vscode.Uri[]): Promise<{ uri: vscode.Uri; configuration: CppConfiguration }[]> {
        const results: { uri: vscode.Uri; configuration: CppConfiguration }[] = [];
        for (const uri of uris) {
            if (uri.scheme !== "file") { continue; }
            const configuration = this.projects.configurationFor(uri.fsPath);
            if (configuration) { results.push({ uri, configuration }); }
        }
        return results;
    }

    public async canProvideBrowseConfiguration(): Promise<boolean> { return this.projects.browseConfiguration().browsePath.length > 0; }
    public async provideBrowseConfiguration(): Promise<CppBrowseConfiguration> { return this.projects.browseConfiguration(); }
    public async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> { return true; }
    public async provideFolderBrowseConfiguration(uri: vscode.Uri): Promise<CppBrowseConfiguration | null> {
        const configuration = this.projects.browseConfiguration(uri.fsPath);
        return configuration.browsePath.length ? configuration : null;
    }
    public dispose(): void {
        const api = this.api;
        this.api = undefined;
        api?.dispose();
    }
}
