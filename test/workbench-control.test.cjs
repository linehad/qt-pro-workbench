const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const mock = { workspace: { isTrusted: true }, debug: { registerDebugAdapterTrackerFactory: () => ({ dispose() {} }), onDidTerminateDebugSession: () => ({ dispose() {} }) } };
const originalLoad = Module._load;
let TXWorkbenchControl;
try {
    Module._load = function (name, ...args) { return name === "vscode" ? mock : originalLoad.call(this, name, ...args); };
    ({ TXWorkbenchControl } = require("../out/XWorkbenchControl"));
} finally { Module._load = originalLoad; }

test("automation jobs return immediately, preserve the target, reject concurrent selection and report failure", async () => {
    let completeBuild, selected = false;
    let activeProject = "F:/first.pro";
    const controller = new TXWorkbenchControl({
        state: () => ({ projects: [], activeProject, kitId: "kit", kitName: "Qt", kits: [] }),
        openProject: async () => {}, select: async () => { selected = true; },
        build: async project => { assert.equal(project, "F:/first.pro"); return new Promise(resolve => { completeBuild = resolve; }); }, debug: async () => true
    });
    const call = (operation, args = {}) => controller.execute({ operation, arguments: args });
    const job = await call("qt_build", { operation: "build" });
    assert.equal(job.status, "running");
    activeProject = "F:/second.pro";
    await assert.rejects(call("qt_select_build_configuration", { configurationId: "release" }), /작업 중/);
    assert.equal(selected, false);
    await assert.rejects(call("qt_build", { operation: "build" }), /작업 중/);
    completeBuild(false);
    await new Promise(resolve => setImmediate(resolve));
    const failed = await call("qt_get_job", { jobId: job.id });
    assert.equal(failed.status, "failed"); assert(failed.error);
    assert((await call("qt_get_log")).entries.some(item => item.source === "job"));
    mock.workspace.isTrusted = false;
    await assert.rejects(call("qt_set_breakpoints", { breakpoints: [] }), /신뢰/);
    assert.equal((await call("qt_get_state")).trusted, false);
    mock.workspace.isTrusted = true;
    controller.dispose();
});
