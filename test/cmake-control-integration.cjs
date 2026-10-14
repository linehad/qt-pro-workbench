const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], timings: [], controls: [], tasks: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const originalDialog = vscode.window.showOpenDialog;
    let api, sessionId;
    const tasks = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { report.tasks.push(event.execution.task.name); } });
    vscode.window.showQuickPick = async () => { throw new Error("Automation opened a QuickPick"); };
    vscode.window.showOpenDialog = async () => { throw new Error("Automation opened a file picker"); };
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    const { executeControlRequest } = require("../out/XControlCli");
    const { discoverKits } = require("../out/XKitStore");
    const { kitEnvironment } = require("../out/XBuildPlan");
    const call = async (operation, args = {}) => {
        const started = Date.now();
        const result = await executeControlRequest({ operation, arguments: { instanceId: api.instanceId, ...args } });
        report.timings.push({ operation, ms: Date.now() - started });
        return result;
    };
    const waitFor = async (query, predicate, label) => {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
            const value = await query();
            if (predicate(value)) { return value; }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("Timeout: " + label);
    };
    const finishJob = async job => {
        const result = await waitFor(() => call("qt_get_job", { jobId: job.id }), value => value.status !== "running", "job");
        assert.equal(result.status, "succeeded", JSON.stringify(result));
        return result;
    };
    const paused = async previousStop => {
        const state = await waitFor(() => call("qt_get_state"), value => value.debug.some(item => item.state === "paused" && item.stopId > previousStop), "debug stop");
        const debug = state.debug.find(item => item.state === "paused");
        sessionId = debug.sessionId;
        report.controls.push({ state: debug.state, reason: debug.reason, stopId: debug.stopId });
        return debug;
    };
    const inspect = async stop => {
        const base = { sessionId: stop.sessionId, stopId: stop.stopId };
        const stack = await call("qt_debug_stack", base);
        const frame = stack.stackFrames[0];
        assert(frame.name.includes("main"));
        const value = await call("qt_debug_evaluate", { ...base, frameId: frame.id, expression: "sText" });
        assert.equal(value.result, '"Qt 한글 😀"');
        const list = await call("qt_debug_evaluate", { ...base, frameId: frame.id, expression: "qNames" });
        const elements = await call("qt_debug_variables", { ...base, variablesReference: list.variablesReference });
        assert(elements.variables.some(item => item.value === value.result));
        const scopes = await call("qt_debug_scopes", { ...base, frameId: frame.id });
        const locals = scopes.scopes.find(item => item.name === "Locals");
        const variables = await call("qt_debug_variables", { ...base, variablesReference: locals.variablesReference });
        assert.equal(variables.variables.find(item => item.name === "sText").value, value.result);
        report.value = value.result;
        return frame;
    };
    try {
        api = await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        assert.equal(api.version, 1);
        await assert.rejects(api.execute({ operation: "qt_get_state", arguments: { instanceId: "wrong-window" } }), /다른 VS Code/);
        const commandState = await vscode.commands.executeCommand("qtPro.control", { operation: "qt_get_state", arguments: {} });
        assert(Array.isArray(commandState.projects));
        const instances = await executeControlRequest({ operation: "qt_list_instances", arguments: {} });
        assert(instances.some(item => item.instanceId === api.instanceId));
        const root = fs.mkdtempSync(path.join(__dirname, "cmake-control-qa-")); report.fixture = root;
        const project = path.join(root, "CMakeLists.txt");
        const source = path.join(root, "main.cpp");
        fs.writeFileSync(project, "cmake_minimum_required(VERSION 3.14)\nproject(Control LANGUAGES CXX)\nfind_package(Qt4 4.8 REQUIRED QtCore)\ninclude(${QT_USE_FILE})\nadd_executable(Control main.cpp)\ntarget_link_libraries(Control ${QT_LIBRARIES})\n");
        const code = [
            "#include <QString>", "#include <QStringList>", "#include <windows.h>",
            "namespace XControlTest {", "int increment(int nValue)", "{", "    volatile int nResult = nValue + 1;", "    return nResult;", "}", "}",
            "int main(int argc, char **argv)", "{", '    QString sText = QString::fromUtf8("Qt \\xed\\x95\\x9c\\xea\\xb8\\x80 \\xf0\\x9f\\x98\\x80");', "    if (argc > 1) { return sText.isEmpty() ? 1 : 0; }",
            "    QStringList qNames;", '    qNames << "first" << sText;', "    int nValue = 2;", "    nValue = XControlTest::increment(nValue); // breakpoint", "    volatile int nMarker = nValue;", "    while (nMarker == 3) { Sleep(20); }", "    return 0;", "}", ""
        ];
        fs.writeFileSync(source, code.join("\n"));
        const state = await call("qt_select_project", { projectPath: project });
        assert.equal(state.activeProject.toLowerCase(), project.toLowerCase());
        const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
        await call("qt_select_kit", { kitId: kit.id });
        await call("qt_select_build_configuration", { configurationId: "release" });
        await finishJob(await call("qt_build", { operation: "build" }));
        report.release = (await call("qt_get_state")).automaticExecutable;
        assert(fs.existsSync(report.release));
        await call("qt_select_build_configuration", { configurationId: "debug" });
        const debugState = await call("qt_get_state");
        await call("qt_select_run_configuration", { configurationId: debugState.runs.activeId });
        await finishJob(await call("qt_build", { operation: "build" }));
        const builtState = await call("qt_get_state");
        assert.equal(builtState.buildSystem, "cmake");
        const executable = builtState.automaticExecutable;
        report.buildDirectory = builtState.buildDirectory;
        assert(executable && fs.existsSync(executable));
        assert(!fs.existsSync(path.join(root, "CMakeCache.txt")));
        await finishJob(await call("qt_build", { operation: "configure" }));
        await finishJob(await call("qt_build", { operation: "clean" }));
        assert(!fs.existsSync(executable));
        await finishJob(await call("qt_build", { operation: "rebuild" }));
        const env = kitEnvironment(kit);
        const execute = (file, args, extra = {}) => new Promise((resolve, reject) => cp.execFile(file, args, { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024, ...extra }, (error, stdout, stderr) => error ? reject(new Error(error + stdout.slice(-2000) + stderr.slice(-2000))) : resolve(stdout)));
        for (const file of [executable, path.join(path.dirname(kit.qmakePath), "QtCored4.dll")]) {
            const imports = await execute(path.join(kit.compilerDirectory, "objdump.exe"), ["-p", file]);
            assert(imports.includes("DLL Name:"));
        }
        for (const name of ["QtCored4.dll", "mingwm10.dll", "libgcc_s_dw2-1.dll"]) {
            const from = path.join(name.startsWith("Qt") ? path.dirname(kit.qmakePath) : kit.compilerDirectory, name);
            const to = path.join(path.dirname(executable), name); fs.copyFileSync(from, to);
            const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); assert.equal(hash(from), hash(to));
        }
        const cleanEnv = { ...env };
        for (const key of Object.keys(cleanEnv)) { if (key.toUpperCase() === "PATH") { delete cleanEnv[key]; } }
        cleanEnv.PATH = "C:\\Windows\\System32;C:\\Windows";
        await execute(executable, ["smoke"], { env: cleanEnv });
        const breakpointLine = code.findIndex(line => line.includes("// breakpoint")) + 1;
        const added = await call("qt_set_breakpoints", { breakpoints: [{ file: source, line: breakpointLine }] });
        const ownBreakpoint = added.find(item => item.file.toLowerCase() === source.toLowerCase());
        assert(ownBreakpoint);
        await finishJob(await call("qt_start_debug"));
        let stop = await paused(0);
        const firstFrame = await inspect(stop);
        const wrapper = path.join(process.env.LOCALAPPDATA, "QtProWorkbench/control-api/QtControl.ps1");
        const requestFile = path.join(root, "unicode-request.json");
        fs.writeFileSync(requestFile, JSON.stringify({ operation: "qt_debug_evaluate", arguments: { instanceId: api.instanceId, sessionId, stopId: stop.stopId, frameId: firstFrame.id, expression: "sText" } }));
        const unicodeOutput = await execute("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-RequestFile", requestFile]);
        assert.equal(JSON.parse(unicodeOutput).result.result, report.value);
        report.cliUnicode = JSON.parse(unicodeOutput).result.result;
        await call("qt_debug_control", { sessionId, stopId: stop.stopId, action: "stepIn" });
        const previous = stop;
        stop = await paused(stop.stopId);
        const inner = await call("qt_debug_stack", { sessionId, stopId: stop.stopId });
        assert(inner.stackFrames[0].name.includes("increment"));
        await assert.rejects(call("qt_debug_stack", { sessionId, stopId: previous.stopId }), /중단 위치/);
        await call("qt_debug_control", { sessionId, stopId: stop.stopId, action: "stepOut" });
        stop = await paused(stop.stopId);
        await call("qt_debug_control", { sessionId, stopId: stop.stopId, action: "next" });
        stop = await paused(stop.stopId);
        await inspect(stop);
        await call("qt_remove_breakpoints", { ids: [ownBreakpoint.id] });
        assert(!(await call("qt_list_breakpoints")).some(item => item.id === ownBreakpoint.id));
        await call("qt_debug_control", { sessionId, stopId: stop.stopId, action: "continue" });
        await call("qt_debug_control", { sessionId, action: "pause" });
        stop = await paused(stop.stopId);
        await call("qt_debug_control", { sessionId, action: "stop" });
        await waitFor(() => call("qt_get_state"), value => value.debug.find(item => item.sessionId === sessionId)?.state === "terminated", "terminated");
        let logs = await call("qt_get_log", { limit: 100 });
        while (!logs.entries.some(item => item.source.startsWith("debug:")) && logs.nextCursor < logs.latestCursor) { logs = await call("qt_get_log", { afterCursor: logs.nextCursor, limit: 100 }); }
        assert(logs.entries.some(item => item.source.startsWith("debug:")));
        assert(logs.entries.some(item => item.source.includes("build")));
        report.logCount = logs.entries.length;
        const cliOutput = await execute("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "-Operation", "qt_get_state", "-InstanceId", api.instanceId]);
        const cliState = JSON.parse(cliOutput); assert.equal(cliState.ok, true); assert.equal(cliState.result.activeProject.toLowerCase(), project.toLowerCase());
        report.cliElapsedMs = cliState.elapsedMs;
        assert.deepEqual(report.errors, []);
        assert(!fs.existsSync(path.join(root, ".vscode")));
        report.passed = true;
    } catch (error) {
        report.error = error.stack || String(error);
        if (api) {
            try { report.debug = (await api.execute({ operation: "qt_get_state", arguments: {} })).debug; report.logs = (await api.execute({ operation: "qt_get_log", arguments: { limit: 100 } })).entries.slice(-25); } catch {}
        }
        throw error;
    }
    finally {
        if (api && sessionId) { try { await api.execute({ operation: "qt_debug_control", arguments: { sessionId, action: "stop" } }); } catch {} }
        tasks.dispose();
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError; vscode.window.showOpenDialog = originalDialog;
        fs.writeFileSync(path.join(__dirname, "cmake-control-results.json"), JSON.stringify(report, null, 4));
    }
};
