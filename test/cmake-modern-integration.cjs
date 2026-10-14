const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], generators: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    let api, sessionId;
    vscode.window.showQuickPick = async () => { throw new Error("Unexpected picker"); };
    vscode.window.showErrorMessage = async text => { report.errors.push(String(text)); };
    const call = (operation, args = {}) => api.execute({ operation, arguments: args });
    const waitFor = async (query, predicate) => {
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            const result = await query(); if (predicate(result)) { return result; }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("Timeout waiting for CMake/debug");
    };
    const job = async promise => {
        const started = await promise;
        const result = await waitFor(() => call("qt_get_job", { jobId: started.id }), value => value.status !== "running");
        assert.equal(result.status, "succeeded", JSON.stringify(result));
    };
    try {
        api = await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const root = fs.mkdtempSync(path.join(__dirname, "cmake-modern-qa-")); report.fixture = root;
        const source = path.join(root, "main.cpp");
        fs.writeFileSync(source, '#include <QCoreApplication>\n#include <QString>\nint main(int argc, char **argv)\n{\n    QCoreApplication qApplication(argc, argv);\n    QString sText = "CMake Qt";\n    int nValue = 42;\n    volatile int nResult = nValue; // breakpoint\n    return sText.isEmpty() ? 1 : nResult - 42;\n}\n');
        const project = path.join(root, "CMakeLists.txt");
        fs.writeFileSync(project, 'cmake_minimum_required(VERSION 3.20)\nproject(Modern LANGUAGES CXX)\nfind_package(Qt6 REQUIRED COMPONENTS Core)\nadd_executable(Modern main.cpp)\ntarget_compile_definitions(Modern PRIVATE QA_CMAKE=1)\ntarget_link_libraries(Modern PRIVATE Qt6::Core)\n');
        const { discoverKits } = require("../out/XKitStore");
        const { cmakeConfigurations } = require("../out/XCMakeIntelliSense");
        const { makeBuildPlan } = require("../out/XBuildPlan");
        const kit = discoverKits().find(item => item.name.startsWith("Qt 6.11.")); assert(kit);
        const storage = path.join(__dirname, process.env.QT_PRO_CMAKE_TEST_PROFILE + "/User/globalStorage/ynlim.qt-pro-workbench");
        const kitsFile = path.join(storage, "kits.json");
        const originalKits = JSON.parse(fs.readFileSync(kitsFile));
        const generatorKits = ["Ninja", "Ninja Multi-Config"].map((generator, index) => ({ ...kit, id: kit.id + "-ninja-" + index, name: kit.name + " / " + generator, cmakeGenerator: generator, cmakeMakePath: "C:/Strawberry/c/bin/ninja.exe" }));
        fs.writeFileSync(kitsFile, JSON.stringify([...originalKits, ...generatorKits]));
        await call("qt_select_project", { projectPath: project });
        for (const selected of generatorKits) {
            await call("qt_select_kit", { kitId: selected.id });
            for (const mode of ["release", "debug"]) {
                await call("qt_select_build_configuration", { configurationId: mode });
                await job(call("qt_build", { operation: "build" }));
                const state = await call("qt_get_state");
                assert(fs.existsSync(state.automaticExecutable));
                const plan = makeBuildPlan(project, selected, { configuration: mode, buildSystem: "cmake" }, storage);
                const config = cmakeConfigurations(plan).get(source.toLowerCase());
                assert(config.defines.includes("QA_CMAKE=1"));
                assert(config.includePath.some(file => file.includes("QtCore")));
                assert(config.compilerPath.includes("mingw1310_64"));
                report.generators.push({ generator: selected.cmakeGenerator, mode, executable: state.automaticExecutable, includes: config.includePath.length });
            }
            await job(call("qt_build", { operation: "clean" }));
            await job(call("qt_build", { operation: "rebuild" }));
            assert.equal(await vscode.commands.executeCommand("qtPro.run", vscode.Uri.file(project)), true);
        }
        await call("qt_set_breakpoints", { breakpoints: [{ file: source, line: 8 }] });
        await job(call("qt_start_debug"));
        const stopped = await waitFor(() => call("qt_get_state"), state => state.debug.some(session => session.state === "paused"));
        const debug = stopped.debug.find(session => session.state === "paused"); sessionId = debug.sessionId;
        const base = { sessionId, stopId: debug.stopId };
        const stack = await call("qt_debug_stack", base);
        const value = await call("qt_debug_evaluate", { ...base, frameId: stack.stackFrames[0].id, expression: "nValue" });
        assert.equal(value.result, "42"); report.variable = value.result;
        await call("qt_debug_control", { sessionId, action: "stop" });
        await waitFor(() => call("qt_get_state"), state => state.debug.find(session => session.sessionId === sessionId)?.state === "terminated");
        assert(!fs.existsSync(path.join(root, "CMakeCache.txt"))); assert(!fs.existsSync(path.join(root, ".vscode")));
        assert.deepEqual(report.errors, []); report.passed = true;
    } catch (error) {
        report.error = error.stack || String(error);
        if (api) { try { report.logs = (await call("qt_get_log", { limit: 100 })).entries.slice(-30); } catch {} }
        throw error;
    } finally {
        if (api && sessionId) { try { await call("qt_debug_control", { sessionId, action: "stop" }); } catch {} }
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(path.join(__dirname, "cmake-modern-results.json"), JSON.stringify(report, null, 4));
    }
};
