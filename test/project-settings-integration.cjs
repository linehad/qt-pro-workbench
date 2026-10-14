const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], tasks: [], launches: [], ui: [] };
    const original = { pick: vscode.window.showQuickPick, input: vscode.window.showInputBox, panel: vscode.window.createWebviewPanel, error: vscode.window.showErrorMessage, status: vscode.window.createStatusBarItem };
    let panel, latest, stateWait, uiWait, ownSession, debugDone, debugFail;
    const panels = [];
    const statuses = new Map();
    let nextName = "Custom Smoke";
    const pendingTimers = new Set();
    const bounded = (register, label, duration = 20000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout: " + label)), duration); pendingTimers.add(timer);
        register(value => { clearTimeout(timer); pendingTimers.delete(timer); resolve(value); }, error => { clearTimeout(timer); pendingTimers.delete(timer); reject(error); });
    });
    const stateReady = predicate => bounded(resolve => { stateWait = state => { if (predicate(state)) { stateWait = undefined; resolve(state); } }; }, "settings state");
    const ui = async action => {
        const done = bounded((resolve, reject) => { uiWait = message => message.error ? reject(new Error(message.error)) : resolve(message); }, "UI action");
        await panel.webview.postMessage({ type: "qa", ...action }); return done;
    };
    const select = async (id, value, predicate) => { const ready = stateReady(predicate); await ui({ select: id, value }); return ready; };
    const save = async (fields, predicate = () => true) => { const ready = stateReady(predicate); await ui({ fields, click: "#save" }); return ready; };
    const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.kit?.name.startsWith("Qt 4.8.1") || item.runKind === "custom") ?? (await Promise.resolve(choices))[0];
    vscode.window.showInputBox = async () => nextName;
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    vscode.window.createStatusBarItem = (...args) => { const item = original.status(...args); statuses.set(args[0], item); return item; };
    vscode.window.createWebviewPanel = (...args) => { const result = original.panel(...args); panels.push(result); if (args[0] === "qtProProjectSelection") { panel = result; } return result; };
    const tasks = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { report.tasks.push(event.execution.task.name); } });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", { createDebugAdapterTracker(session) {
        ownSession = session;
        return {
            onWillReceiveMessage(message) {
                if (message.command === "launch") {
                    const launch = message.arguments;
                    report.launches.push({ program: launch.program, args: launch.args, cwd: launch.cwd, setupCommands: launch.setupCommands, miDebuggerPath: launch.miDebuggerPath, environment: launch.environment.filter(item => ["RUN_CHECK", "BUILD_CHECK"].includes(item.name)) });
                }
            },
            onDidSendMessage(message) {
                if (message.success === false) {
                    (report.adapterResponses ??= []).push({ command: message.command, message: message.message });
                    if (message.command === "launch") { report.errors.push(message.message); }
                }
                if (message.event === "output" && message.body.output.includes("RUN_CHECK") && !message.body.output.includes("LaunchOptions")) { (report.gdbEnvironmentMessages ??= []).push(message.body.output); }
                if (message.event !== "stopped") { return; }
                (async () => {
                    const trace = await session.customRequest("stackTrace", { threadId: message.body.threadId, levels: 1 });
                    const frame = trace.stackFrames[0];
                    assert(frame.name.includes("main"));
                    const value = await session.customRequest("evaluate", { expression: "argc", frameId: frame.id, context: "watch" });
                    assert.equal(value.result, "2"); report.breakpoint = { name: frame.name, argc: value.result };
                    await session.customRequest("continue", { threadId: message.body.threadId });
                })().catch(error => debugFail?.(error));
            }
        };
    } });
    const ended = vscode.debug.onDidTerminateDebugSession(session => { if (session === ownSession) { debugDone?.(); } });
    const debug = async () => {
        const done = bounded((resolve, reject) => { debugDone = resolve; debugFail = reject; }, "debug session", 45000);
        assert.equal(await vscode.commands.executeCommand("qtPro.debug"), true); await done;
    };
    let breakpoint;
    const attachUI = async () => {
        panel.webview.onDidReceiveMessage(message => {
            if (message.type === "qaState") { latest = message.state; stateWait?.(latest); }
            if (message.type === "qaResult") { uiWait?.(message); }
            if (message.type === "qaError") { report.errors.push(message.message); }
        });
        const nonce = panel.webview.html.match(/<script nonce="([^"]+)"/)[1];
        const source = fs.readFileSync(path.join(__dirname, "../media/project-selection.js"), "utf8").replace("const vscode = acquireVsCodeApi();", "const vscode = acquireVsCodeApi(); globalThis.qaApi = vscode;");
        const exercise = `window.addEventListener('message',event=>{const m=event.data;try{
            if(m.type==='state'){qaApi.postMessage({type:'qaState',state:m.state});}
            if(m.type==='error'){qaApi.postMessage({type:'qaError',message:m.message});}
            if(m.type!=='qa'){return;}
            for(const [id,value] of Object.entries(m.fields||{})){const e=document.getElementById(id);if(!e){throw Error('Missing field '+id);}if(typeof value==='boolean'){e.checked=value;e.dispatchEvent(new Event('change',{bubbles:true}));}else{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}}
            if(m.step){const inputs=document.querySelectorAll('#deploySteps .fields input');inputs[inputs.length-2].value=m.step.source;inputs[inputs.length-2].dispatchEvent(new Event('input',{bubbles:true}));inputs[inputs.length-1].value=m.step.destination;inputs[inputs.length-1].dispatchEvent(new Event('input',{bubbles:true}));}
            if(m.select){const e=document.getElementById(m.select);e.value=m.value;e.dispatchEvent(new Event('change'));}
            if(m.click){const e=document.querySelector(m.click);if(!e||e.disabled){throw Error('Unavailable control '+m.click);}e.click();}
            const result={tab:document.querySelector('[role=tab][aria-selected=true]').dataset.tab,shadowDisabled:document.getElementById('buildDirectory').disabled,make:document.getElementById('makeArguments').value};
            qaApi.postMessage({type:'qaResult',...result});
        }catch(error){qaApi.postMessage({type:'qaResult',error:error.message});}});`;
        const ready = stateReady(() => true);
        panel.webview.html = panel.webview.html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script nonce="${nonce}">${source}</script><script nonce="${nonce}">${exercise}</script>`);
        return ready;
    };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const debugModule = require("../out/XDebugConfiguration");
        const makeDebug = debugModule.makeDebugConfiguration;
        debugModule.makeDebugConfiguration = (...args) => ({ ...makeDebug(...args), logging: { engineLogging: true } });
        const { discoverKits } = require("../out/XKitStore");
        const { kitEnvironment } = require("../out/XBuildPlan");
        const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
        const root = fs.mkdtempSync(path.join(__dirname, "unified-settings-qa-")); report.fixture = root;
        const project = path.join(root, "app.pro");
        fs.writeFileSync(project, "TEMPLATE = app\nCONFIG -= qt\nCONFIG += console debug_and_release\nTARGET = WorkbenchSmoke\nSOURCES = main.cpp\n");
        fs.writeFileSync(path.join(root, "main.cpp"), '#include <stdio.h>\n#include <stdlib.h>\nint main(int argc, char **argv) {\n FILE *file=fopen("run-result.txt","w"); if(!file) return 9;\n fprintf(file,"%d|%s|%s",argc,argc>1?argv[1]:"",getenv("RUN_CHECK")?getenv("RUN_CHECK"):""); fclose(file); return 0;\n}\n');
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        await vscode.commands.executeCommand("qtPro.selectKit");
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        const packageRuntime = mode => {
            const directory = path.join(root, mode); const executable = path.join(directory, "WorkbenchSmoke.exe");
            const imports = spawnSync(path.join(kit.compilerDirectory, "objdump.exe"), ["-p", executable], { env: kitEnvironment(kit), encoding: "utf8", windowsHide: true, timeout: 10000 });
            assert.equal(imports.status, 0); report[mode + "Imports"] = imports.stdout.match(/DLL Name: .*/g);
            for (const name of ["mingwm10.dll", "libgcc_s_dw2-1.dll"]) {
                const source = path.join(kit.compilerDirectory, name); const target = path.join(directory, name); fs.copyFileSync(source, target);
                const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); assert.equal(hash(source), hash(target));
            }
            const env = { ...process.env }; for (const key of Object.keys(env)) { if (key.toUpperCase() === "PATH") { delete env[key]; } }
            env.PATH = "C:\\Windows\\System32;C:\\Windows"; env.RUN_CHECK = "clean-path";
            const launch = spawnSync(executable, [], { cwd: directory, env, encoding: "utf8", windowsHide: true, timeout: 10000 });
            assert.equal(launch.status, 0); assert.equal(fs.readFileSync(path.join(directory, "run-result.txt"), "utf8"), "1||clean-path");
        };
        packageRuntime("debug");
        await vscode.commands.executeCommand("qtPro.selectActiveProject"); await attachUI();
        report.ui.push(await ui({})); assert.equal(report.ui[0].shadowDisabled, true); assert.match(report.ui[0].make, /^-j\d+$/);
        assert(!statuses.has("qtPro.kitSettings")); assert(!statuses.has(vscode.StatusBarAlignment.Left) || statuses.get(vscode.StatusBarAlignment.Left).command !== "qtPro.selectKit");
        await ui({ fields: { makeArguments: "-j2", buildEnvironment: "BUILD_CHECK=one" }, click: "#tab-run" });
        assert.equal((await ui({ click: "#tab-build" })).make, "-j2", "Tab switching retains unsaved inputs");
        await save({}, state => state.builds.items.find(item => item.id === state.builds.activeId).settings.makeArguments === "-j2");
        nextName = "Debug Copy";
        let ready = stateReady(state => state.builds.items.length === 3); await ui({ click: '[data-section="build"][data-action="clone"]' }); await ready;
        const cloneId = latest.builds.activeId; assert.equal(latest.builds.items.find(item => item.id === cloneId).settings.makeArguments, "-j2");
        await select("buildConfiguration", "debug", state => state.builds.activeId === "debug");
        nextName = "Debug Extra";
        ready = stateReady(state => state.builds.items.length === 4); await ui({ click: '[data-section="build"][data-action="add"]' }); await ready;
        ready = stateReady(state => state.builds.items.length === 3); await ui({ click: '[data-section="build"][data-action="remove"]' }); await ready;
        await select("buildConfiguration", "debug", state => state.builds.activeId === "debug");
        nextName = "Custom Smoke";
        ready = stateReady(state => state.runs.items.length === 2); await ui({ click: '[data-section="run"][data-action="add"]' }); await ready;
        assert.equal(latest.runs.items.find(item => item.id === latest.runs.activeId).kind, "custom");
        const addSteps = async mode => {
            await ui({ click: "#tab-deploy" });
            for (const name of ["WorkbenchSmoke.exe", "mingwm10.dll", "libgcc_s_dw2-1.dll"]) {
                await ui({ click: "#addDeployStep" }); await ui({ step: { source: '${buildDir}/' + mode + '/' + name, destination: 'deploy/' + mode } });
            }
        };
        await addSteps("debug");
        const deployed = path.join(root, "deploy/debug/WorkbenchSmoke.exe");
        await save({ executable: deployed, arguments: '"UI Run"', runEnvironment: "RUN_CHECK=ui", startupCommands: "set print elements 0" }, state => state.deploys.items[0].steps.length === 3);
        nextName = "Deploy Copy";
        ready = stateReady(state => state.deploys.items.length === 2); await ui({ click: '[data-section="deploy"][data-action="clone"]' }); await ready;
        assert.equal(latest.deploys.items.find(item => item.id === latest.deploys.activeId).steps.length, 3);
        nextName = "Remote Deploy";
        ready = stateReady(state => state.deploys.items.some(item => item.name === "Remote Deploy")); await ui({ click: '[data-section="deploy"][data-action="rename"]' }); await ready;
        ready = stateReady(state => state.deploys.items.length === 1); await ui({ click: '[data-section="deploy"][data-action="remove"]' }); await ready;
        nextName = "Empty Deploy";
        ready = stateReady(state => state.deploys.items.length === 2); await ui({ click: '[data-section="deploy"][data-action="add"]' }); await ready;
        assert.equal(latest.deploys.items.find(item => item.id === latest.deploys.activeId).steps.length, 0);
        ready = stateReady(state => state.deploys.items.length === 1); await ui({ click: '[data-section="deploy"][data-action="remove"]' }); await ready;
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(root, "deploy/debug/run-result.txt"), "utf8"), "2|UI Run|ui");
        const exeTime = fs.statSync(deployed).mtimeMs; const terminalCount = vscode.window.terminals.length;
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true); assert.equal(fs.statSync(deployed).mtimeMs, exeTime); assert.equal(vscode.window.terminals.length, terminalCount);
        breakpoint = new vscode.FunctionBreakpoint("main"); vscode.debug.addBreakpoints([breakpoint]); await debug(); vscode.debug.removeBreakpoints([breakpoint]); breakpoint = undefined;
        assert(same(report.launches.at(-1).program, deployed)); assert.deepEqual(report.launches.at(-1).args, ["UI Run"]);
        assert.equal(fs.readFileSync(path.join(root, "deploy/debug/run-result.txt"), "utf8"), "2|UI Run|ui");
        assert(report.launches.at(-1).setupCommands.some(item => item.text === "set print elements 0"));
        assert(report.launches.at(-1).miDebuggerPath.includes("python_2.7based"));
        await select("buildConfiguration", "release", state => state.configuration === "release");
        assert.equal(latest.deploys.items[0].steps.length, 0); assert.equal(latest.runs.items.length, 1);
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true); packageRuntime("release");
        await addSteps("release");
        await save({ executable: path.join(root, "deploy/release/WorkbenchSmoke.exe"), arguments: "", runEnvironment: "RUN_CHECK=release" });
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), true);
        assert.equal(fs.readFileSync(path.join(root, "deploy/release/run-result.txt"), "utf8"), "1||release");
        await debug();
        assert(report.launches.at(-1).program.includes("release")); assert.deepEqual(report.launches.at(-1).args, []);
        assert.equal(fs.readFileSync(path.join(root, "deploy/release/run-result.txt"), "utf8"), "1||release");
        assert.equal(await vscode.commands.executeCommand("qtPro.deploy"), true);
        const count = report.tasks.length;
        const resultTime = fs.statSync(path.join(root, "deploy/release/run-result.txt")).mtimeMs;
        await ui({ click: "#addDeployStep" }); await ui({ step: { source: "missing", destination: "deploy/release" } }); await save({});
        assert.equal(await vscode.commands.executeCommand("qtPro.run"), undefined);
        assert.match(report.errors.pop(), /배포 원본을 찾을/);
        assert.equal(fs.statSync(path.join(root, "deploy/release/run-result.txt")).mtimeMs, resultTime);
        assert.deepEqual(report.tasks.slice(count), ["app.pro: build"]);
        await ui({ click: "#deploySteps .deploy-step:last-child .step-heading button" }); await save({});
        await save({ qmakeArguments: "DEFINES+=SETTINGS_UI_TEST" });
        const qmakeStart = report.tasks.length;
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        assert.deepEqual(report.tasks.slice(qmakeStart), ["app.pro: qmake", "app.pro: build"]);
        assert(fs.readFileSync(path.join(root, "Makefile.Release"), "utf8").includes("SETTINGS_UI_TEST"));
        assert.equal(await vscode.commands.executeCommand("qtPro.build"), true);
        assert.deepEqual(report.tasks.slice(qmakeStart + 2), ["app.pro: build"]);
        assert.deepEqual(report.errors, []); assert(!fs.existsSync(path.join(root, ".vscode")));
        const beforePanels = panels.length; await vscode.commands.executeCommand("qtPro.configureRun"); assert.equal(panels.length, beforePanels, "Build/Run commands reuse the same settings panel");
        panel.dispose();
        const other = path.join(root, "other.pro"); fs.writeFileSync(other, "TEMPLATE = app\nSOURCES = main.cpp\n");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(other));
        await vscode.commands.executeCommand("qtPro.selectActiveProject"); await attachUI();
        assert.equal(latest.kitId, undefined);
        await select("kit", kit.id, state => state.kitId === kit.id);
        await select("project", project, state => same(state.projectPath, project));
        assert(statuses.get("qtPro.activeProject").text.includes("app.pro"));
        assert.equal(latest.configuration, "release");
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(other));
        assert(statuses.get("qtPro.activeProject").text.includes("app.pro"), "Opening another project's file must not change the active project");
        await vscode.commands.executeCommand("qtPro.configureBuild", vscode.Uri.file(other)); await attachUI();
        assert(same(latest.projectPath, other)); assert(same(latest.activeProject, project));
        assert(statuses.get("qtPro.activeProject").text.includes("app.pro"), "Context-menu settings must preserve the active build/run project");
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        for (const timer of pendingTimers) { clearTimeout(timer); }
        if (vscode.debug.activeDebugSession === ownSession) { await vscode.debug.stopDebugging(ownSession); }
        if (breakpoint) { vscode.debug.removeBreakpoints([breakpoint]); }
        tasks.dispose(); tracker.dispose(); ended.dispose(); for (const item of panels) { item.dispose(); }
        vscode.window.showQuickPick = original.pick; vscode.window.showInputBox = original.input; vscode.window.createWebviewPanel = original.panel; vscode.window.showErrorMessage = original.error; vscode.window.createStatusBarItem = original.status;
        fs.writeFileSync(path.join(__dirname, "project-settings-results.json"), JSON.stringify(report, null, 4));
    }
};
