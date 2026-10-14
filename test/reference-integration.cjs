const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [] };
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    try {
        const api = await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const call = (operation, args = {}) => api.execute({ operation, arguments: args });
        const project = "F:/1.4.13_Work/HydraX_Driver/XPlcDriver/Omron/Cs/OriaCs.pro";
        const source = "F:/1.4.13_Work/HydraX_Driver/XPlcProtocol/Master/HostLink/Fins/Fins.cpp";
        await call("qt_select_project", { projectPath: project });
        const state = await call("qt_get_state");
        const kit = state.kits.find(item => /\b4\.8\.1\b/.test(item.name));
        await call("qt_select_kit", { kitId: kit.id });
        const document = await vscode.workspace.openTextDocument(source);
        const text = document.getText();
        const offset = text.indexOf("TFins::ExecuteCpuUnitDataReadSerial") + "TFins::".length;
        const position = document.positionAt(offset);
        await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
        const until = Date.now() + 90000;
        let locations = [];
        while (Date.now() < until) {
            locations = await vscode.commands.executeCommand("qtPro.findReferences", document.uri, position);
            report.locations = locations.map(item => ({ file: item.uri.fsPath, line: item.range.start.line + 1 }));
            if (report.locations.some(item => item.file.endsWith("FinsOriaCs.cpp") && item.line === 32)) { break; }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        assert(report.locations.some(item => item.file.endsWith("FinsOriaCs.cpp") && item.line === 32), JSON.stringify(report.locations));
        assert(report.locations.some(item => item.file.endsWith("Fins.cpp") && item.line === 586));
        assert(report.locations.every(item => item.file.toLowerCase().startsWith("f:\\1.4.13_work\\")));
        const namePrompt = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => "ExecuteCpuUnitDataReadSerial";
        try { report.names = (await vscode.commands.executeCommand("qtPro.findName")).map(item => ({ file: item.uri.fsPath, line: item.range.start.line + 1 })); }
        finally { vscode.window.showInputBox = namePrompt; }
        assert.equal(report.names.length, 3);
        assert.deepEqual(report.errors, []); report.passed = true;
    } catch (error) { report.error = error.stack || String(error); await vscode.commands.executeCommand("C_Cpp.LogDiagnostics"); throw error; }
    finally { vscode.window.showErrorMessage = originalError; fs.writeFileSync(path.join(__dirname, "reference-results.json"), JSON.stringify(report, null, 4)); }
};
