const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const results = { passed: false, tasks: [], errors: [], debug: {} };
    const reportPath = path.resolve(__dirname, "run-settings-results.json");
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(choice => choice.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { results.errors.push(message); return undefined; };
    const taskListener = vscode.tasks.onDidStartTask(event => {
        if (event.execution.task.source === "Qt Pro") { results.tasks.push(event.execution.task.name); }
    });
    let ended;
    let ownSession;
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", {
        createDebugAdapterTracker(session) {
            ownSession = session;
            let resuming = false;
            return {
                onWillReceiveMessage(message) {
                    if (message.command === "launch") {
                        const { program, args, cwd } = message.arguments;
                        results.debug.launch = { program, args, cwd };
                    }
                },
                onDidSendMessage(message) {
                    if (message.success === false) {
                        const inspection = ["scopes", "variables"].includes(message.command);
                        const cancelled = inspection && resuming && message.message?.includes("process is running");
                        if (!cancelled) { results.errors.push(`${message.command}: ${message.message}`); }
                    }
                    if (message.event === "stopped") {
                        results.debug.stopped = true;
                        results.debug.reason = message.body.reason;
                        session.customRequest("stackTrace", { threadId: message.body.threadId, levels: 1 }).then(async trace => {
                            results.debug.function = trace.stackFrames?.[0]?.name;
                            // Let the workbench finish inspecting the stopped frame before this test resumes it.
                            await new Promise(resolve => setTimeout(resolve, 500));
                            resuming = true;
                            return session.customRequest("continue", { threadId: message.body.threadId });
                        }).catch(error => results.errors.push(String(error)));
                    }
                    if (message.event === "exited") { results.debug.exitCode = message.body.exitCode; }
                }
            };
        }
    });
    const termination = vscode.debug.onDidTerminateDebugSession(session => {
        if (session === ownSession) { ended?.(); }
    });
    const breakpoint = new vscode.FunctionBreakpoint("main");
    vscode.debug.addBreakpoints([breakpoint]);
    const normalize = value => path.resolve(value).toLowerCase();
    const readResult = directory => {
        const lines = fs.readFileSync(path.join(directory, "run-result.txt"), "utf8").replaceAll("\r", "").split("\n");
        return { cwd: lines[0], arguments: lines.slice(2, 2 + Number(lines[1])) };
    };
    const startF5 = async () => {
        let timeout;
        const finished = new Promise((resolve, reject) => {
            ended = resolve;
            timeout = setTimeout(() => reject(new Error("Debug session timeout")), 60000);
        });
        try {
            await Promise.race([vscode.commands.executeCommand("workbench.action.debug.start"), finished]);
            await finished;
        } finally { clearTimeout(timeout); }
    };
    try {
        assert(!vscode.workspace.workspaceFolders?.length);
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const { discoverKits } = require("../out/XKitStore");
        const { makeBuildPlan } = require("../out/XBuildPlan");
        const { defaultExecutable } = require("../out/XBuildOutput");
        const kit = discoverKits().find(value => value.name.startsWith("Qt 4.8.1"));
        assert(kit);
        const fixtureDirectory = fs.mkdtempSync(path.join(__dirname, "run-settings-qa-"));
        for (const name of ["run.pro", "main.cpp"]) { fs.copyFileSync(path.join(__dirname, "run source", name), path.join(fixtureDirectory, name)); }
        const projectPath = path.join(fixtureDirectory, "run.pro");
        const storage = path.join(process.env.LOCALAPPDATA, "Temp/qt-pro-run-qa/User/globalStorage/ynlim.qt-pro-workbench");
        const plan = makeBuildPlan(projectPath, kit, { configuration: "debug" }, storage);
        const makefile = path.join(plan.buildDirectory, "Makefile");
        assert(normalize(makefile).startsWith(normalize(fixtureDirectory) + path.sep));
        if (fs.existsSync(makefile)) { fs.unlinkSync(makefile); }
        const sourceBefore = fs.readdirSync(path.dirname(projectPath));
        const runtime = path.resolve(__dirname, "run QA/working directory");
        const deployed = path.resolve(__dirname, "run QA/external debug");
        fs.mkdirSync(runtime, { recursive: true });
        fs.mkdirSync(deployed, { recursive: true });
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(projectPath));
        await vscode.commands.executeCommand("qtPro.selectKit");
        const save = settings => vscode.commands.executeCommand("qtPro.configureRun", undefined, settings);
        await save({ executable: "", arguments: 'Run "two words" "" --mode=test', workingDirectory: runtime });
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        const first = readResult(runtime);
        assert.equal(normalize(first.cwd), normalize(runtime));
        assert.deepEqual(first.arguments, ["Run", "two words", "", "--mode=test"]);
        assert.equal(results.tasks.length, 3);
        results.withArguments = first;
        const objectFile = path.join(plan.buildDirectory, "debug/main.o");
        const objectTime = fs.statSync(objectFile).mtimeMs;
        const outputFile = defaultExecutable(plan);
        const outputTime = fs.statSync(outputFile).mtimeMs;

        const executable = path.join(deployed, "RenamedSmoke.exe");
        fs.copyFileSync(outputFile, executable);
        const exeBefore = fs.statSync(executable).mtimeMs;
        await save({ executable, arguments: "", workingDirectory: "", buildBeforeRun: false });
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        const blank = readResult(deployed);
        assert.equal(normalize(blank.cwd), normalize(deployed));
        assert.deepEqual(blank.arguments, []);
        assert.equal(results.tasks.length, 5, "Run must invoke incremental make even with a legacy disabled-build setting");
        results.withoutArguments = blank;

        await save({ executable, arguments: 'Run "debug argument"', workingDirectory: runtime, buildBeforeRun: false });
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(projectPath));
        await startF5();
        assert(results.debug.stopped, "Moved EXE must reach a breakpoint");
        assert(results.debug.function?.includes("main"));
        assert.equal(results.debug.exitCode, 0);
        assert.equal(normalize(results.debug.launch.program), normalize(executable));
        assert.equal(normalize(results.debug.launch.cwd), normalize(runtime));
        assert.deepEqual(results.debug.launch.args, ["Run", "debug argument"]);
        assert.deepEqual(readResult(runtime).arguments, ["Run", "debug argument"]);
        assert.equal(results.tasks.length, 6, "F5 must invoke incremental make");
        results.debugWithArguments = results.debug;
        results.debug = {};
        await save({ executable, arguments: "", workingDirectory: "%{RunConfig:Executable:Path}", buildBeforeRun: false });
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(projectPath));
        await startF5();
        assert(results.debug.stopped);
        assert.equal(results.debug.exitCode, 0);
        assert.deepEqual(results.debug.launch.args, []);
        assert.equal(normalize(results.debug.launch.cwd), normalize(deployed));
        assert.deepEqual(readResult(deployed).arguments, []);
        assert.equal(results.tasks.length, 7);
        assert.equal(fs.statSync(objectFile).mtimeMs, objectTime, "Unchanged Run/F5 must not recompile");
        assert.equal(fs.statSync(outputFile).mtimeMs, outputTime, "Unchanged Run/F5 must not relink");
        results.unchangedBuildSkipped = true;

        assert(fs.existsSync(objectFile));
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        assert.deepEqual(results.tasks.slice(7), ["run.pro: build"], "Existing Makefile must skip qmake");
        assert.equal(await vscode.commands.executeCommand("qtPro.clean"), true);
        assert(!fs.existsSync(objectFile), "Clean must remove built objects");
        assert(fs.existsSync(makefile), "Clean must retain the Makefile");
        assert.equal(await vscode.commands.executeCommand("qtPro.qmake"), true);
        assert(!fs.existsSync(objectFile), "Run qmake must not compile");
        assert.equal(await vscode.commands.executeCommand("qtPro.rebuild"), true);
        assert(fs.existsSync(objectFile), "Rebuild must recreate objects");
        assert.deepEqual(results.tasks.slice(7), ["run.pro: build", "run.pro: clean", "run.pro: qmake", "run.pro: clean", "run.pro: qmake", "run.pro: build"]);
        const originalCreatePanel = vscode.window.createWebviewPanel;
        let panel;
        let messageListener;
        let viewTimeout;
        const webviewReady = new Promise((resolve, reject) => {
            viewTimeout = setTimeout(() => reject(new Error("Run Settings webview did not initialize")), 15000);
            vscode.window.createWebviewPanel = (...args) => {
                panel = originalCreatePanel(...args);
                messageListener = panel.webview.onDidReceiveMessage(message => {
                    if (message.type === "ready") { resolve(); }
                });
                return panel;
            };
        });
        try {
            await Promise.race([vscode.commands.executeCommand("qtPro.configureRun"), webviewReady]);
            await webviewReady;
            assert(!panel.webview.html.includes('type="checkbox"'));
            assert(!panel.webview.html.includes("buildBeforeRun"));
            results.settingsScreenInitialized = true;
        } finally {
            clearTimeout(viewTimeout);
            vscode.window.createWebviewPanel = originalCreatePanel;
            messageListener?.dispose();
            panel?.dispose();
        }
        assert.equal(fs.statSync(executable).mtimeMs, exeBefore);
        for (const name of sourceBefore) { assert.equal(fs.readFileSync(path.join(fixtureDirectory, name), "utf8"), fs.readFileSync(path.join(__dirname, "run source", name), "utf8")); }
        assert(!fs.existsSync(path.join(fixtureDirectory, ".vscode")));
        assert.deepEqual(results.errors, []);
        results.passed = true;
        results.folderless = true;
        results.movedExecutableUnchanged = true;
        results.separateBuildSteps = true;
    } catch (error) {
        results.error = String(error);
        throw error;
    } finally {
        fs.writeFileSync(reportPath, JSON.stringify(results, null, 4));
        if (ownSession && vscode.debug.activeDebugSession === ownSession) { await vscode.debug.stopDebugging(ownSession); }
        tracker.dispose(); termination.dispose(); taskListener.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
        vscode.window.showQuickPick = originalPick;
        vscode.window.showErrorMessage = originalError;
    }
};
