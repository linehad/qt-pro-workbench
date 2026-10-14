const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureUserDebugLaunch } = require("../out/XUserDebugLaunch");

test("native debug entry is registered in user settings only and resolves the active project at launch time", async () => {
    const updates = [];
    let user;
    const settings = { inspect: () => ({ globalValue: user, workspaceValue: { configurations: [{ name: "Workspace" }] } }), update: async (...args) => { updates.push(args); user = args[1]; } };
    await ensureUserDebugLaunch(settings);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][0], "launch");
    assert.equal(updates[0][2], true, "Explicit user/global target; never create launch.json");
    assert.deepEqual(user.configurations, [{ name: "Qt Pro: 활성 프로젝트", type: "qt-pro", request: "launch" }]);
    await ensureUserDebugLaunch(settings);
    assert.equal(updates.length, 1, "Activation must not duplicate or rewrite an existing entry");
});

test("user debug configurations, compounds and names are preserved; malformed settings are not overwritten", async () => {
    const original = { version: "0.2.0", configurations: [{ type: "node", request: "launch", name: "Qt Pro: 활성 프로젝트" }, { type: "qt-pro", request: "launch", name: "Specific project", qtProject: "other.pro" }], compounds: [{ name: "Together", configurations: ["Specific project"] }], custom: "keep" };
    let saved;
    await ensureUserDebugLaunch({ inspect: () => ({ globalValue: original }), update: async (_key, value) => { saved = value; } });
    assert.deepEqual(saved.configurations.slice(0, 2), original.configurations);
    assert.equal(saved.configurations[2].name, "Qt Pro: 활성 프로젝트 (2)");
    assert.deepEqual(saved.compounds, original.compounds);
    assert.equal(saved.custom, "keep");
    assert.equal(original.configurations.length, 2);
    await assert.rejects(ensureUserDebugLaunch({ inspect: () => ({ globalValue: { configurations: "invalid" } }), update: () => { throw new Error("Must not write"); } }), /배열/);
});
