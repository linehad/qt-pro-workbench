const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const reportPath = path.resolve(__dirname, "debug-results.json");
    const results = [];
    const errors = [];
    const progressPath = path.resolve(__dirname, "debug-progress.json");
    const progress = [];
    const note = value => { progress.push(value); fs.writeFileSync(progressPath, JSON.stringify(progress, null, 4)); };
    let requestedKit = "";
    let currentResult;
    let ended;
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(choice => choice.kit?.name === requestedKit);
    vscode.window.showErrorMessage = async message => { errors.push(message); return undefined; };
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", {
        createDebugAdapterTracker(session) {
            note({ adapter: session.type });
            return {
                onDidSendMessage(message) {
                    if (message.event) { note({ event: message.event, detail: message.event === "output" ? message.body?.output : undefined }); }
                    if (message.success === false) { note({ failed: message.command, message: message.message }); }
                    if (message.event === "stopped") {
                        currentResult.stopped = true;
                        currentResult.reason = message.body.reason;
                        session.customRequest("stackTrace", { threadId: message.body.threadId, levels: 1 }).then(trace => {
                            currentResult.function = trace.stackFrames?.[0]?.name;
                            currentResult.source = trace.stackFrames?.[0]?.source?.path;
                            return session.customRequest("continue", { threadId: message.body.threadId });
                        }).catch(error => errors.push(String(error)));
                    }
                    if (message.event === "exited") { currentResult.exitCode = message.body.exitCode; }
                }
            };
        }
    });
    const termination = vscode.debug.onDidTerminateDebugSession(session => {
        if (session.type === "cppdbg") { ended?.(); }
    });
    const breakpoint = new vscode.FunctionBreakpoint("main");
    vscode.debug.addBreakpoints([breakpoint]);
    try {
        assert(!vscode.workspace.workspaceFolders?.length);
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        note("activated");
        const { discoverKits } = require("../out/XKitStore");
        const projectPath = path.resolve(__dirname, "smoke source/smoke.pro");
        const before = fs.readdirSync(path.dirname(projectPath));
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(projectPath));
        for (const kit of discoverKits()) {
            requestedKit = kit.name;
            const document = await vscode.workspace.openTextDocument(projectPath);
            await vscode.window.showTextDocument(document);
            assert.equal(document.languageId, "qmake");
            await vscode.commands.executeCommand("qtPro.selectKit");
            currentResult = { kit: kit.name, stopped: false };
            results.push(currentResult);
            note({ kit: kit.name });
            let timeout;
            const finished = new Promise((resolve, reject) => {
                ended = resolve;
                timeout = setTimeout(() => reject(new Error("Debug session timeout: " + kit.name)), 60000);
            });
            try {
                // This is the command behind the standard Run and Debug button / F5.
                await Promise.race([vscode.commands.executeCommand("workbench.action.debug.start"), finished]);
                note("start command returned");
                await finished;
            } finally { clearTimeout(timeout); }
            assert(currentResult.stopped, "Must reach a real source breakpoint");
            assert(currentResult.function?.includes("main"));
            assert.equal(currentResult.exitCode, 0);
            const source = await vscode.workspace.openTextDocument(path.join(path.dirname(projectPath), "main.cpp"));
            await vscode.window.showTextDocument(source);
            const expected = path.dirname(path.dirname(kit.qmakePath)).toLowerCase();
            for (let attempt = 0; attempt < 15; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", source.uri, new vscode.Position(0, 20));
                currentResult.resolvedHeader = definitions?.map(item => (item.uri ?? item.targetUri)?.fsPath).find(file => file?.toLowerCase().startsWith(expected));
                currentResult.diagnostics = vscode.languages.getDiagnostics(source.uri).map(item => ({ severity: item.severity, message: item.message }));
                if (currentResult.resolvedHeader && !currentResult.diagnostics.some(item => item.severity === 0)) { break; }
            }
            assert(currentResult.resolvedHeader, "Qt include must resolve after building");
            assert(!currentResult.diagnostics.some(item => item.severity === 0));
        }
        assert.deepEqual(fs.readdirSync(path.dirname(projectPath)), before);
        assert.equal(errors.length, 0);
        fs.writeFileSync(reportPath, JSON.stringify({ passed: true, standardRunAndDebug: true, folderless: true, results }, null, 4));
    } catch (error) {
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error), errors, results }, null, 4));
        throw error;
    } finally {
        if (vscode.debug.activeDebugSession?.name.startsWith("Qt Pro:")) { await vscode.debug.stopDebugging(vscode.debug.activeDebugSession); }
        tracker.dispose(); termination.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
    }
};
