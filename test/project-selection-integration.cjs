const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, tasks: [], launches: [], errors: [], filePickers: 0, terminalOpens: 0, states: [] };
    const original = { pick: vscode.window.showQuickPick, error: vscode.window.showErrorMessage, open: vscode.window.showOpenDialog, panel: vscode.window.createWebviewPanel, status: vscode.window.createStatusBarItem, input: vscode.window.showInputBox };
    let panel;
    let runPanel;
    let projectStatus;
    let nextState;
    let latestState;
    let ownSession;
    let debugFinished;
    let timer;
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.kit?.name.startsWith("Qt 4.8.1") || item.runKind === "custom");
    vscode.window.showInputBox = async () => "Deployed Worker";
    vscode.window.showErrorMessage = async message => { report.errors.push(message); return undefined; };
    vscode.window.showOpenDialog = async () => { report.filePickers += 1; throw new Error("Unexpected file picker"); };
    vscode.window.createWebviewPanel = (...args) => { const created = original.panel(...args); if (args[0] === "qtProProjectSelection") { panel = created; } if (args[0] === "qtProRunSettings") { runPanel = created; } return created; };
    vscode.window.createStatusBarItem = (...args) => { const item = original.status(...args); if (args[0] === "qtPro.activeProject") { projectStatus = item; } return item; };
    const tasks = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { report.tasks.push(event.execution.task.name); } });
    const terminals = vscode.window.onDidOpenTerminal(() => { report.terminalOpens += 1; });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", { createDebugAdapterTracker(session) {
        ownSession = session;
        return { onWillReceiveMessage(message) { if (message.command === "launch") { report.launches.push({ program: message.arguments.program, args: message.arguments.args, cwd: message.arguments.cwd }); } } };
    } });
    const ended = vscode.debug.onDidTerminateDebugSession(session => { if (session === ownSession) { debugFinished?.(); } });
    const normalize = value => path.resolve(value).toLowerCase();
    const debug = async () => {
        const done = new Promise((resolve, reject) => { debugFinished = resolve; timer = setTimeout(() => reject(new Error("Debug timeout")), 45000); });
        try { assert.equal(await vscode.commands.executeCommand("qtPro.debug"), true); await done; }
        finally { clearTimeout(timer); }
    };
    try {
        const { discoverKits } = require("../out/XKitStore");
        const { buildExecutables } = require("../out/XBuildOutput");
        const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
        const root = fs.mkdtempSync(path.join(__dirname, "project-selection-qa-"));
        report.fixture = root;
        const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
        const parent = write("RootA.pro", "TEMPLATE = subdirs\nSUBDIRS = worker/Worker.pro library/Library.pro\n");
        const app = (directory, name) => {
            write(`${directory}/main.cpp`, `#include <stdio.h>\nint main(int argc, char **argv) { FILE *file = fopen("run-result.txt", "w"); if (!file) { return 9; } fprintf(file, "${name}\\n%s", argc > 1 ? argv[1] : ""); fclose(file); return 0; }\n`);
            return write(`${directory}/${name}.pro`, `TEMPLATE = app\nQT = core\nCONFIG += console debug_and_release\nTARGET = ${name}\nSOURCES = main.cpp\nCONFIG(debug, debug|release): DESTDIR = ../${name}-output/debug\nCONFIG(release, debug|release): DESTDIR = ../${name}-output/release\n`);
        };
        const worker = app("worker", "Worker");
        const other = app("second", "Other");
        const library = write("library/Library.pro", "TEMPLATE = lib\nQT = core\nCONFIG += debug_and_release\nTARGET = Helper\nSOURCES = helper.cpp\n");
        write("library/helper.cpp", "extern \"C\" __declspec(dllexport) int HelperValue() { return 7; }\n");
        const uri = file => vscode.Uri.file(file);
        const plan = (projectPath, configuration) => ({ projectPath, configuration, buildDirectory: path.dirname(projectPath), kit });
        const runtime = executable => {
            const directory = path.dirname(executable);
            for (const name of ["QtCored4.dll", "QtCore4.dll"]) { fs.copyFileSync(path.join(path.dirname(kit.qmakePath), name), path.join(directory, name)); }
            for (const name of ["mingwm10.dll", "libgcc_s_dw2-1.dll"]) { fs.copyFileSync(path.join(kit.compilerDirectory, name), path.join(directory, name)); }
        };
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        for (const project of [other, parent]) {
            await vscode.commands.executeCommand("qtPro.openProject", uri(project));
            await vscode.commands.executeCommand("qtPro.selectKit");
        }
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        const parentExecutable = buildExecutables(plan(parent, "debug"))[0];
        assert.equal(path.basename(parentExecutable), "Worker.exe");
        runtime(parentExecutable);
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: "RunA", workingDirectory: "" });
        await vscode.commands.executeCommand("qtPro.selectKit", uri(library));
        assert.equal(await vscode.commands.executeCommand("qtPro.build", uri(library)), true);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(worker));
        assert(projectStatus.text.includes("RootA.pro"));
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(path.dirname(parentExecutable), "run-result.txt"), "utf8").replaceAll("\r", ""), "Worker\nRunA");
        const opened = report.terminalOpens;
        const terminalCount = vscode.window.terminals.length;
        for (let index = 0; index < 3; ++index) { assert.equal(await vscode.commands.executeCommand("qtPro.run"), true); }
        assert.equal(vscode.window.terminals.length, terminalCount, "Repeated builds and runs must reuse terminals");
        assert.equal(report.terminalOpens, opened, "No new terminal on repeated build and run");
        report.terminalReuse = { repeatedRuns: 3, terminalCount };
        await debug();
        assert.equal(normalize(report.launches.at(-1).program), normalize(parentExecutable));
        assert.deepEqual(report.launches.at(-1).args, ["RunA"]);

        await vscode.commands.executeCommand("qtPro.selectActiveProject");
        assert(panel);
        const stateReady = (predicate = () => true) => new Promise((resolve, reject) => { const guard = setTimeout(() => reject(new Error("Project view timeout")), 15000); nextState = state => { if (!predicate(state)) { return false; } clearTimeout(guard); resolve(state); return true; }; });
        panel.webview.onDidReceiveMessage(message => { if (message.type === "qaState") { latestState = message.state; report.states.push({ project: message.state.projectPath, configuration: message.state.configuration, activeRunId: message.state.activeRunId, runs: message.state.runConfigurations }); if (nextState?.(message.state)) { nextState = undefined; } } });
        const nonce = panel.webview.html.match(/<script nonce="([^"]+)"/)[1];
        const script = fs.readFileSync(path.join(__dirname, "../media/project-selection.js"), "utf8");
        const exercise = `window.addEventListener('message',event=>{if(event.data.type==='state'){vscode.postMessage({type:'qaState',state:event.data.state});}if(event.data.type==='qaClick'){const button=[...document.querySelectorAll('#'+event.data.column+' button')].find(item=>item.dataset.value===event.data.value);if(button){button.click();}else{vscode.postMessage({type:'qaError',message:'Missing choice'});}}});`;
        let waiting = stateReady();
        panel.webview.html = panel.webview.html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script nonce="${nonce}">${script}</script><script nonce="${nonce}">${exercise}</script>`);
        await waiting;
        assert.equal(latestState.projects.length, 2, "Opening a child .pro must not add another root");
        assert.equal(normalize(latestState.projectPath), normalize(parent));
        waiting = stateReady(state => normalize(state.projectPath) === normalize(other)); await panel.webview.postMessage({ type: "qaClick", column: "projects", value: other }); await waiting;
        waiting = stateReady(state => state.configuration === "release"); await panel.webview.postMessage({ type: "qaClick", column: "configurations", value: "release" }); await waiting;
        assert.equal(normalize(latestState.projectPath), normalize(other));
        assert.equal(latestState.configuration, "release");
        assert(projectStatus.text.includes("Other.pro"));
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        const otherExecutable = buildExecutables(plan(other, "release"))[0];
        runtime(otherExecutable);
        // The Run column contains named configurations, not raw executable paths.
        waiting = stateReady(state => state.runConfigurations.some(item => item.executable === otherExecutable)); await panel.webview.postMessage({ type: "qaClick", column: "configurations", value: "release" }); await waiting;
        assert.equal(latestState.runConfigurations.find(item => item.id === latestState.activeRunId).name, "Other");
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: otherExecutable, arguments: "RunB", workingDirectory: "" });
        const beforeContext = report.tasks.length;
        assert.equal(await vscode.commands.executeCommand("qtPro.build", uri(library)), true);
        assert.deepEqual(report.tasks.slice(beforeContext), ["Library.pro: build"]);
        assert(projectStatus.text.includes("Other.pro"));
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(path.dirname(otherExecutable), "run-result.txt"), "utf8").replaceAll("\r", ""), "Other\nRunB");
        await debug();
        assert.equal(normalize(report.launches.at(-1).program), normalize(otherExecutable));
        assert.deepEqual(report.launches.at(-1).args, ["RunB"]);

        await vscode.commands.executeCommand("qtPro.configureRun");
        assert(runPanel);
        let nextRunState;
        let runState;
        const runReady = predicate => new Promise((resolve, reject) => { const guard = setTimeout(() => reject(new Error("Run settings timeout: " + JSON.stringify(runState))), 15000); nextRunState = state => { if (!predicate(state)) { return false; } clearTimeout(guard); resolve(state); return true; }; });
        runPanel.webview.onDidReceiveMessage(message => {
            if (message.type === "qaRunState") { runState = message.state; if (nextRunState?.(runState)) { nextRunState = undefined; } }
            if (message.type === "qaRunError") { report.errors.push(message.message); }
        });
        const runNonce = runPanel.webview.html.match(/<script nonce="([^"]+)"/)[1];
        const runExercise = `window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'settings') { vscode.postMessage({type:'qaRunState',state:message.configurations}); }
            if (message.type === 'error') { vscode.postMessage({type:'qaRunError',message:message.message}); }
            if (message.type !== 'qaRunAction') { return; }
            for (const [field,value] of Object.entries(message.fields || {})) { element(field).value=value; element(field).dispatchEvent(new Event('input',{bubbles:true})); }
            if (message.action === 'select') { element('activeConfiguration').value=message.id; element('activeConfiguration').dispatchEvent(new Event('change')); return; }
            if (message.action === 'save') { element('settings').dispatchEvent(new Event('submit',{cancelable:true})); return; }
            element(message.action).click();
        });`;
        const runScript = fs.readFileSync(path.join(__dirname, "../media/run-settings.js"), "utf8").replace(/\}\)\(\);\s*$/, runExercise + "})();");
        waiting = runReady(state => state.items.length === 1);
        runPanel.webview.html = runPanel.webview.html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script nonce="${runNonce}">${runScript}</script>`);
        await waiting;
        const defaultId = runState.activeId;
        const runAction = async (action, predicate, extra = {}) => { const ready = runReady(predicate); await runPanel.webview.postMessage({ type: "qaRunAction", action, ...extra }); return ready; };
        await runAction("add", state => state.items.length === 2);
        const customId = runState.activeId;
        assert.equal(runState.items.find(item => item.id === customId).kind, "custom");
        assert.equal(runState.items.find(item => item.id === customId).executable, "");
        await vscode.commands.executeCommand("qtPro.run");
        assert.match(report.errors.pop(), /Executable을 지정/);
        await runAction("rename", state => state.items.some(item => item.name === "Deployed Worker"));
        const customCwd = path.join(root, "runtime data"); fs.mkdirSync(customCwd);
        // Switching auto-saves this draft by ID without replacing the original configuration.
        await runAction("select", state => state.activeId === defaultId, { id: defaultId, fields: { executable: parentExecutable, arguments: "", workingDirectory: customCwd } });
        assert.equal(runState.items.find(item => item.id === defaultId).arguments, "RunB");
        assert.equal(runState.items.find(item => item.id === customId).arguments, "");
        await runAction("select", state => state.activeId === customId, { id: customId });
        await runAction("clone", state => state.items.length === 3);
        const cloneId = runState.activeId;
        assert.equal(runState.items.find(item => item.id === cloneId).executable, parentExecutable);
        await runAction("save", state => state.items.find(item => item.id === cloneId).arguments === "CloneArgument", { fields: { arguments: "CloneArgument" } });
        await runAction("remove", state => state.items.length === 2);
        assert.equal(runState.activeId, customId);
        assert.equal(runState.items.find(item => item.id === customId).arguments, "");
        report.namedConfigurations = runState;
        runPanel.dispose(); runPanel = undefined;

        // Select the two saved entries from the Project / Build / Run view.
        panel.reveal();
        waiting = stateReady(state => state.activeRunId === customId); await panel.webview.postMessage({ type: "qaClick", column: "configurations", value: "release" }); await waiting;
        waiting = stateReady(state => state.activeRunId === defaultId); await panel.webview.postMessage({ type: "qaClick", column: "executables", value: defaultId }); await waiting;
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(path.dirname(otherExecutable), "run-result.txt"), "utf8").replaceAll("\r", ""), "Other\nRunB");
        waiting = stateReady(state => state.activeRunId === customId); await panel.webview.postMessage({ type: "qaClick", column: "executables", value: customId }); await waiting;
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(customCwd, "run-result.txt"), "utf8").replaceAll("\r", ""), "Worker\n");
        await debug();
        assert.equal(normalize(report.launches.at(-1).program), normalize(parentExecutable));
        assert.deepEqual(report.launches.at(-1).args, []);
        assert.equal(normalize(report.launches.at(-1).cwd), normalize(customCwd));
        assert.equal(report.tasks.at(-1), "Other.pro: build", "Custom Run/F5 still builds the active project in Release");
        assert.equal(report.filePickers, 0);
        assert.deepEqual(report.errors, []);
        await vscode.commands.executeCommand("qtPro.run", uri(library));
        assert.match(report.errors.pop(), /실행 가능한 EXE가 없습니다/);
        assert.equal(report.filePickers, 0);
        report.passed = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        clearTimeout(timer); panel?.dispose(); runPanel?.dispose(); tasks.dispose(); terminals.dispose(); tracker.dispose(); ended.dispose();
        vscode.window.showInputBox = original.input; vscode.window.showQuickPick = original.pick; vscode.window.showErrorMessage = original.error; vscode.window.showOpenDialog = original.open; vscode.window.createWebviewPanel = original.panel; vscode.window.createStatusBarItem = original.status;
        fs.writeFileSync(path.join(__dirname, "project-selection-results.json"), JSON.stringify(report, null, 4));
    }
};
