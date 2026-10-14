const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
let trackerFactory, ended;
const mock = { debug: { registerDebugAdapterTrackerFactory: (_type, factory) => { trackerFactory = factory; return { dispose() {} }; }, onDidTerminateDebugSession: callback => { ended = callback; return { dispose() {} }; } } };
const originalLoad = Module._load;
let TXDebugControl;
try {
    Module._load = function (name, ...args) { return name === "vscode" ? mock : originalLoad.call(this, name, ...args); };
    ({ TXDebugControl } = require("../out/XDebugControl"));
} finally { Module._load = originalLoad; }

test("debug control targets Qt sessions and rejects stale frames before and during requests", async () => {
    const controller = new TXDebugControl(() => {});
    assert.equal(trackerFactory.createDebugAdapterTracker({ id: "unrelated", configuration: {} }), undefined);
    let calls = 0;
    const session = { id: "qt", name: "Qt Pro", configuration: { qtProProject: "F:/app.pro" }, customRequest: async () => { calls++; return { stackFrames: [] }; } };
    const tracker = trackerFactory.createDebugAdapterTracker(session);
    tracker.onDidSendMessage({ event: "stopped", body: { threadId: 1, reason: "breakpoint" } });
    await controller.execute("qt_debug_stack", { sessionId: "qt", stopId: 1 });
    assert.equal(calls, 1);
    await assert.rejects(controller.execute("qt_debug_stack", { sessionId: "qt", stopId: 0 }), /stopId/);
    assert.equal(calls, 1);
    let resolveRequest;
    session.customRequest = () => new Promise(resolve => { resolveRequest = resolve; });
    const pending = controller.execute("qt_debug_stack", { sessionId: "qt", stopId: 1 });
    tracker.onDidSendMessage({ event: "continued", body: {} });
    tracker.onDidSendMessage({ event: "stopped", body: { threadId: 1, reason: "step" } });
    resolveRequest({ stackFrames: [] });
    await assert.rejects(pending, /중단 위치/);
    await assert.rejects(controller.execute("qt_debug_stack", { sessionId: "unrelated", stopId: 2 }), /Qt 디버그/);
    ended(session);
    await assert.rejects(controller.execute("qt_debug_stack", { sessionId: "qt", stopId: 2 }), /Qt 디버그/);
    assert.equal(controller.hasActiveSession(), false);
    controller.dispose();
});
