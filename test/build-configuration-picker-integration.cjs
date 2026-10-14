const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const original = { pick: vscode.window.showQuickPick, status: vscode.window.createStatusBarItem, panel: vscode.window.createWebviewPanel, error: vscode.window.showErrorMessage };
    const report = { passed: false, errors: [], picks: [], transitions: [], panels: 0 };
    const statuses = new Map();
    const panels = [];
    let selectedId, cancel = false;
    const storage = path.join(__dirname, "vscode-build-picker-profile/User/globalStorage/ynlim.qt-pro-workbench");
    const { discoverKits } = require("../out/XKitStore");
    const { loadProjectPreferences } = require("../out/XProjectPreferencesStore");
    const { loadConfigurations, saveConfigurations } = require("../out/XConfigurationStore");
    const { getBuildConfigurations, validateBuildConfigurations } = require("../out/XConfigurations");
    const { getBuildSettings } = require("../out/XBuildSettings");
    const { loadRunConfigurations } = require("../out/XRunSettingsStore");
    const { getRunConfigurationSet } = require("../out/XRunConfigurations");
    const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
    assert(kit);
    const preferences = project => ({ configuration: "debug", ...loadProjectPreferences(storage, project), buildProfiles: loadConfigurations(storage, project, "build-profiles", validateBuildConfigurations), runConfigurations: loadRunConfigurations(storage, project) });
    vscode.window.createStatusBarItem = (...args) => { const status = original.status(...args); statuses.set(args[0], status); return status; };
    vscode.window.createWebviewPanel = (...args) => { const panel = original.panel(...args); panels.push(panel); report.panels++; return panel; };
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    vscode.window.showQuickPick = async choices => {
        const items = await Promise.resolve(choices);
        const kitChoice = items.find(item => item.kit?.id === kit.id);
        if (kitChoice) { return kitChoice; }
        report.picks.push(items.map(item => ({ id: item.id, label: item.label, current: item.description === "현재 선택" })));
        return cancel ? undefined : items.find(item => item.id === selectedId);
    };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const root = fs.mkdtempSync(path.join(__dirname, "build-picker-qa-"));
        report.fixture = root;
        const project = path.join(root, "first.pro");
        const other = path.join(root, "second.pro");
        fs.writeFileSync(project, "TEMPLATE = app\nTARGET = First\nQT = core\n");
        fs.writeFileSync(other, "TEMPLATE = app\nTARGET = Second\nQT = core\n");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        const configurationStatus = statuses.get("qtPro.buildConfiguration");
        const projectStatus = statuses.get("qtPro.activeProject");
        assert.equal(configurationStatus.command, "qtPro.selectConfiguration");
        assert.equal(projectStatus.command, "qtPro.selectActiveProject");
        const switchTo = async id => {
            selectedId = id;
            await vscode.commands.executeCommand(configurationStatus.command);
            report.transitions.push({ project: projectStatus.text, text: configurationStatus.text, mode: preferences(project).configuration });
        };
        cancel = true;
        await switchTo("release");
        assert.equal(preferences(project).configuration, "debug");
        assert.deepEqual(report.picks[0].map(item => item.label), ["Debug", "Release"]);
        cancel = false;
        await switchTo("release");
        assert.equal(preferences(project).configuration, "release");
        await vscode.commands.executeCommand("qtPro.selectKit");
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: "release-arguments", workingDirectory: "" });
        await switchTo("debug");
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: "debug-arguments", workingDirectory: "" });
        const builds = getBuildConfigurations(preferences(project), kit);
        builds.items.push({ id: "release-custom", name: "Release Custom", configuration: "release", settings: { ...builds.items.find(item => item.id === "release").settings, makeArguments: "-j3" } });
        saveConfigurations(storage, project, "build-profiles", { [kit.id]: builds });
        await switchTo("release-custom");
        assert.equal(configurationStatus.text, "Release Custom $(chevron-down)");
        assert.equal(getBuildConfigurations(preferences(project), kit).activeId, "release-custom");
        assert.equal(getBuildSettings(preferences(project), kit).makeArguments, "-j3");
        assert(report.picks.at(-1).some(item => item.id === "debug" && item.current));
        const runArguments = () => { const runs = getRunConfigurationSet(preferences(project), kit.id); return runs.items.find(item => item.id === runs.activeId).arguments; };
        assert.equal(runArguments(), "release-arguments");
        cancel = true;
        await switchTo("debug");
        assert.equal(getBuildConfigurations(preferences(project), kit).activeId, "release-custom");
        cancel = false;
        await switchTo("debug");
        assert.equal(runArguments(), "debug-arguments");
        await switchTo("release-custom");
        assert.equal(runArguments(), "release-arguments");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(other));
        await switchTo("debug");
        assert.equal(preferences(other).configuration, "debug");
        assert.equal(getBuildConfigurations(preferences(project), kit).activeId, "release-custom");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        assert.equal(configurationStatus.text, "Release Custom $(chevron-down)");
        assert.equal(report.panels, 0);
        await vscode.commands.executeCommand(projectStatus.command);
        assert.equal(report.panels, 1);
        assert.deepEqual(report.errors, []);
        assert(!fs.existsSync(path.join(root, ".vscode")));
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        for (const panel of panels) { panel.dispose(); }
        vscode.window.showQuickPick = original.pick; vscode.window.createStatusBarItem = original.status; vscode.window.createWebviewPanel = original.panel; vscode.window.showErrorMessage = original.error;
        fs.writeFileSync(path.join(__dirname, "build-configuration-picker-results.json"), JSON.stringify(report, null, 4));
    }
};
