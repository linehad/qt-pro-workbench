const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = path.resolve(__dirname, "intellisense-results.json");
    const originalPick = vscode.window.showQuickPick;
    const errors = [];
    const results = [];
    let requestedKit;
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showErrorMessage = async message => { errors.push(message); return undefined; };
    vscode.window.showQuickPick = async items => (await Promise.resolve(items)).find(item => item.kit?.name === requestedKit);
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        assert(!vscode.workspace.workspaceFolders?.length);
        const { discoverKits } = require("../out/XKitStore");
        const projectPath = path.resolve(__dirname, "smoke source/smoke.pro");
        const sourcePath = path.resolve(__dirname, "smoke source/main.cpp");
        const before = fs.readdirSync(path.dirname(sourcePath));
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(projectPath));
        const source = await vscode.workspace.openTextDocument(sourcePath);
        for (const kit of discoverKits()) {
            requestedKit = kit.name;
            await vscode.commands.executeCommand("qtPro.selectKit");
            await vscode.window.showTextDocument(source);
            const expected = path.dirname(path.dirname(kit.qmakePath)).toLowerCase();
            let found;
            let diagnostics;
            for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", source.uri, new vscode.Position(0, 20));
                found = definitions?.map(item => (item.uri ?? item.targetUri)?.fsPath).find(file => file?.toLowerCase().startsWith(expected));
                diagnostics = vscode.languages.getDiagnostics(source.uri);
                if (found && !diagnostics.some(item => item.severity === vscode.DiagnosticSeverity.Error)) { break; }
            }
            const result = { kit: kit.name, resolvedHeader: found, diagnostics: diagnostics.map(item => item.message) };
            results.push(result);
            fs.writeFileSync(report, JSON.stringify({ passed: false, inProgress: true, results }, null, 4));
            assert(found, "Qt include must resolve to the selected kit: " + kit.name);
            assert(!diagnostics.some(item => item.severity === vscode.DiagnosticSeverity.Error), "Unexpected IntelliSense errors");
        }
        assert.deepEqual(fs.readdirSync(path.dirname(sourcePath)), before);
        assert.equal(errors.length, 0);
        fs.writeFileSync(report, JSON.stringify({ passed: true, folderless: true, results }, null, 4));
    } catch (error) {
        await vscode.commands.executeCommand("C_Cpp.LogDiagnostics");
        fs.writeFileSync(report, JSON.stringify({ passed: false, error: String(error), errors, results }, null, 4));
        throw error;
    } finally { vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError; }
};
