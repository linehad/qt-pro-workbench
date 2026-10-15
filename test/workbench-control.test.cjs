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
        openProject: async () => {}, closeProject: async () => { selected = true; }, select: async () => { selected = true; },
        build: async project => { assert.equal(project, "F:/first.pro"); return new Promise(resolve => { completeBuild = resolve; }); }, debug: async () => true
    });
    const call = (operation, args = {}) => controller.execute({ operation, arguments: args });
    const job = await call("qt_build", { operation: "build" });
    assert.equal(job.status, "running");
    activeProject = "F:/second.pro";
    await assert.rejects(call("qt_select_build_configuration", { configurationId: "release" }), /작업 중/);
    assert.equal(selected, false);
    await assert.rejects(call("qt_close_project", { projectPath: "F:/first.pro" }), /작업 중/);
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

test("project close requires an explicit opened path and works without a kit", async () => {
    let projects = [{ projectPath: "F:/work/App.pro", name: "App" }, { projectPath: "F:/main/CMakeLists.txt", name: "Main" }];
    let activeProject = projects[0].projectPath;
    const closed = [];
    const controller = new TXWorkbenchControl({
        state: () => ({ projects, activeProject, kits: [] }), openProject: async () => {}, select: async () => {}, build: async () => true, debug: async () => true,
        closeProject: async project => { closed.push(project); projects = projects.filter(item => item.projectPath !== project); if (activeProject === project) { activeProject = projects[0]?.projectPath; } }
    });
    const call = args => controller.execute({ operation: "qt_close_project", arguments: args });
    await assert.rejects(call({}), /projectPath/);
    await assert.rejects(call({ projectPath: "F:/other/App.pro" }), /열린 프로젝트/);
    const inactive = await call({ projectPath: "F:/MAIN/CMakeLists.txt" });
    assert.equal(inactive.activeProject, "F:/work/App.pro"); assert.equal(inactive.projects.length, 1);
    const last = await call({ projectPath: "F:/work/App.pro" }); assert.equal(last.activeProject, undefined); assert.deepEqual(last.projects, []);
    assert.deepEqual(closed, ["F:/main/CMakeLists.txt", "F:/work/App.pro"]);
    controller.dispose();
});
