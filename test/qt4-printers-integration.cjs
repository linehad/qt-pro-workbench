const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const root = path.join(__dirname, "qt4-printers-qa");
    const project = path.join(root, "QtValues.pro");
    const source = path.join(root, "main.cpp");
    const line = fs.readFileSync(source, "utf8").split("\n").findIndex(value => value.includes("nMarker += 1"));
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(source), new vscode.Position(line, 0)));
    const report = { passed: false, stops: [], values: {}, children: {}, errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    let ownSession, resolveDone, rejectDone, timeout, stopCount = 0;
    const completed = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; timeout = setTimeout(() => reject(new Error("Qt value debug timeout")), 45000); });
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); rejectDone(new Error(String(message))); };
    const evaluate = (session, frameId, expression, context) => session.customRequest("evaluate", { expression, frameId, context });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", { createDebugAdapterTracker(session) {
        if (!session.name.includes("QtValues.pro")) { return; }
        ownSession = session;
        return { onDidSendMessage(message) {
            if (message.command === "launch" && message.success === false) { rejectDone(new Error(message.message)); }
            if (message.event === "exited") { report.exitCode = message.body.exitCode; }
            if (message.event !== "stopped") { return; }
            (async () => {
                const trace = await session.customRequest("stackTrace", { threadId: message.body.threadId, levels: 1 });
                const frame = trace.stackFrames[0];
                report.stops.push({ reason: message.body.reason, function: frame.name, line: frame.line });
                assert(frame.name.includes("main"));
                const hover = await evaluate(session, frame.id, "sText", "hover");
                assert.equal(hover.result, '"Qt 한글 😀"');
                if (stopCount++ > 0) { await session.customRequest("continue", { threadId: message.body.threadId }); return; }
                assert.equal(message.body.reason, "breakpoint");
                for (const expression of ["sText", "sAlias", "sNull", "sEmbedded", "qReference", "qCharacter", "qBytes", "qStringVariant", "qNumberVariant", "qInvalidVariant", "qBytesVariant"]) {
                    report.values[expression] = (await evaluate(session, frame.id, expression, "watch")).result;
                }
                assert.equal(report.values.sText, hover.result);
                assert.equal(report.values.sAlias, hover.result);
                assert.equal(report.values.sNull, '""');
                assert.equal(report.values.qReference, '"한글"');
                assert.equal(report.values.qCharacter, '"한"');
                assert(report.values.qStringVariant.includes("Qt 한글 😀"));
                assert.equal(report.values.qNumberVariant, "71");
                assert.equal(report.values.qInvalidVariant, "QVariant(invalid)");
                assert.equal(report.values.qBytesVariant, report.values.qBytes);
                for (const expression of ["qNames", "qNumbers", "qWords", "qNested", "qMap", "qAlignedMap", "qHash", "qIntHash", "qEmptyList", "qQueue", "qStack", "qListVariant", "qMapVariant", "qMultiMap", "qMultiHash"]) {
                    const parent = await evaluate(session, frame.id, expression, "watch");
                    const variables = parent.variablesReference ? (await session.customRequest("variables", { variablesReference: parent.variablesReference })).variables : [];
                    report.children[expression] = { result: parent.result, values: variables.map(item => ({ name: item.name, value: item.value, type: item.type })) };
                    assert(!variables.some(item => ["d", "shared_null", "shared_empty"].includes(item.name)), expression);
                }
                assert(report.children.qNames.values.some(item => item.value.includes("Qt 한글 😀")));
                assert(report.children.qWords.values.some(item => item.value.includes("Qt 한글 😀")));
                assert(report.children.qNumbers.values.some(item => item.value === "11"));
                assert(report.children.qNumbers.values.some(item => item.value === "22"));
                assert(report.children.qAlignedMap.values.some(item => item.value.includes("1234567890123")));
                assert.equal(report.children.qEmptyList.values.length, 0);
                assert(report.children.qMapVariant.values.some(item => item.value.includes("Qt 한글 😀")));
                assert.equal(report.children.qMultiMap.values.length, 2);
                assert.equal(report.children.qMultiHash.values.length, 2);
                const scopes = await session.customRequest("scopes", { frameId: frame.id });
                const local = scopes.scopes.find(item => item.name === "Locals");
                const variables = (await session.customRequest("variables", { variablesReference: local.variablesReference })).variables;
                assert.equal(variables.find(item => item.name === "sText").value, hover.result);
                await session.customRequest("next", { threadId: message.body.threadId });
            })().catch(rejectDone);
        } };
    } });
    const ended = vscode.debug.onDidTerminateDebugSession(session => { if (session === ownSession) { resolveDone(); } });
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const { discoverKits } = require("../out/XKitStore");
        const { getBuildSettings } = require("../out/XBuildSettings");
        const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        await vscode.commands.executeCommand("qtPro.selectKit");
        await vscode.commands.executeCommand("qtPro.configureBuild", undefined, { ...getBuildSettings({ configuration: "debug" }, kit), shadowBuild: true, buildDirectory: path.join(root, "build") });
        vscode.debug.addBreakpoints([breakpoint]);
        assert.equal(await vscode.commands.executeCommand("qtPro.debug"), true);
        await completed;
        assert.equal(report.exitCode, 0);
        assert.equal(report.stops.length, 2);
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        clearTimeout(timeout);
        if (vscode.debug.activeDebugSession === ownSession) { await vscode.debug.stopDebugging(ownSession); }
        tracker.dispose(); ended.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(path.join(__dirname, "qt4-printers-results.json"), JSON.stringify(report, null, 4));
    }
};
