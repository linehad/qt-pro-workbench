const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const originalSpawn = cp.spawn;
    let finished;
    let timeout;
    let ownSession;
    const children = [];
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { report.errors.push(message); return undefined; };
    const started = vscode.debug.onDidStartDebugSession(session => { if (session.type === "cppdbg") { ownSession = session; } });
    const ended = vscode.debug.onDidTerminateDebugSession(session => { if (session === ownSession) { finished?.(); } });
    cp.spawn = (executable, args, options) => { children.push({ executable, hidden: options?.windowsHide }); return originalSpawn(executable, args, options); };
    try {
        const { root } = require("./gui-visibility-probe.cjs");
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(path.join(root, "gui.pro")));
        await vscode.commands.executeCommand("qtPro.selectKit");
        const runResult = path.join(root, "extension-run.txt");
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: JSON.stringify(runResult), workingDirectory: "" });
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        report.run = fs.readFileSync(runResult, "utf8");
        assert.match(report.run, /^visible=1/m);
        assert(children.some(item => /mingw32-make/i.test(item.executable) && item.hidden === true));
        assert(children.some(item => /GuiVisibility.exe/i.test(item.executable) && item.hidden === false));
        const debugResult = path.join(root, "extension-f5.txt");
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: JSON.stringify(debugResult), workingDirectory: "" });
        const done = new Promise((resolve, reject) => { finished = resolve; timeout = setTimeout(() => reject(new Error("GUI debug timeout")), 30000); });
        assert.equal(await vscode.commands.executeCommand("qtPro.debug"), true);
        await done;
        report.f5 = fs.readFileSync(debugResult, "utf8");
        assert.match(report.f5, /^visible=1/m);
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        clearTimeout(timeout); started.dispose(); ended.dispose();
        cp.spawn = originalSpawn; vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(path.join(__dirname, "gui-launch-results.json"), JSON.stringify(report, null, 4));
    }
};
