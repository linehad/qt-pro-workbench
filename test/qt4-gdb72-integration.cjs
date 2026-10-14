const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const name = "Qt 4.8.1 GDB 7.2 compatibility";
    const report = { passed: false, messages: [], errors: [] };
    const breakpoint = new vscode.FunctionBreakpoint("main");
    let finish;
    let reject;
    let timeout;
    const completed = new Promise((resolve, fail) => { finish = resolve; reject = fail; timeout = setTimeout(() => fail(new Error("Debug session timeout")), 40000); });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", {
        createDebugAdapterTracker(session) {
            if (session.name !== name) { return; }
            return { onDidSendMessage(message) {
                if (message.event === "output") { report.messages.push(message.body.output); }
                if (message.success === false) { report.errors.push({ command: message.command, message: message.message }); }
                if (message.event === "exited") { report.exitCode = message.body.exitCode; }
                if (message.event !== "stopped") { return; }
                report.reason = message.body.reason;
                (async () => {
                    const trace = await session.customRequest("stackTrace", { threadId: message.body.threadId, levels: 1 });
                    const frame = trace.stackFrames[0];
                    report.function = frame.name;
                    report.source = frame.source?.path;
                    const variable = await session.customRequest("evaluate", { expression: "argc", frameId: frame.id, context: "watch" });
                    report.argc = variable.result;
                    assert.equal(report.reason, "breakpoint");
                    assert(report.function.includes("main"));
                    assert.equal(report.argc, "1");
                    await session.customRequest("continue", { threadId: message.body.threadId });
                })().catch(reject);
            } };
        }
    });
    const termination = vscode.debug.onDidTerminateDebugSession(session => { if (session.name === name) { finish(); } });
    vscode.debug.addBreakpoints([breakpoint]);
    try {
        await vscode.extensions.getExtension("ms-vscode.cpptools").activate();
        const fixture = fs.mkdtempSync(path.join(__dirname, "qt4-gdb72-runtime-"));
        const program = path.join(fixture, "QtProSmoke.exe");
        fs.copyFileSync(path.join(__dirname, "smoke-storage/builds/smoke-c5f2ff734943/ebd9252294a4/debug/bin/QtProSmoke.exe"), program);
        for (const file of ["mingwm10.dll", "libgcc_s_dw2-1.dll"]) { fs.copyFileSync(path.join("C:/QtSDK/mingw/bin", file), path.join(fixture, file)); }
        fs.copyFileSync("C:/QtSDK/Desktop/Qt/4.8.1/mingw/bin/QtCored4.dll", path.join(fixture, "QtCored4.dll"));
        report.runtimeDirectory = fixture;
        assert(fs.existsSync(program));
        const { makeDebugConfiguration } = require("../out/XDebugConfiguration");
        const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === "PATH") ?? "Path";
        const configuration = makeDebugConfiguration({ projectPath: path.join(__dirname, "smoke source/smoke.pro"), kit: {
            compilerDirectory: "C:/QtSDK/mingw/bin", qmakePath: "C:/QtSDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe"
        }, environment: { [pathKey]: "C:\\QtSDK\\Desktop\\Qt\\4.8.1\\mingw\\bin;C:\\QtSDK\\mingw\\bin;" + process.env[pathKey] } }, {
            executable: program, argumentsList: [], workingDirectory: fixture
        });
        configuration.name = name;
        assert.equal(path.resolve(configuration.miDebuggerPath), path.resolve("C:/QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe"));
        report.debugger = configuration.miDebuggerPath;
        report.targetArchitecture = configuration.targetArchitecture;
        const started = await Promise.race([vscode.debug.startDebugging(undefined, configuration), completed.then(() => false)]);
        assert(started, "Debug adapter must start");
        await completed;
        assert.equal(report.exitCode, 0);
        assert.equal(report.argc, "1");
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        clearTimeout(timeout);
        if (vscode.debug.activeDebugSession?.name === name) { await vscode.debug.stopDebugging(); }
        tracker.dispose(); termination.dispose(); vscode.debug.removeBreakpoints([breakpoint]);
        fs.writeFileSync(path.join(__dirname, "qt4-gdb72-results.json"), JSON.stringify(report, null, 4));
    }
};
