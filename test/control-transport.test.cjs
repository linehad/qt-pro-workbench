const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TXLocalControlServer } = require("../out/XLocalControlServer");
const { callLocalControl, listControlInstances, readControlDescriptor, controlPipe } = require("../out/XLocalControlClient");
const { executeControlRequest } = require("../out/XControlCli");
const { installControlSkill } = require("../out/XControlInstall");

test("local control authenticates requests, isolates windows and ignores closed instances", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-control-"));
    const originalLocalData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = root;
    const first = new TXLocalControlServer(async request => ({ window: "first", operation: request.operation }));
    const second = new TXLocalControlServer(async () => ({ window: "second" }));
    t.after(() => {
        first.dispose(); second.dispose();
        if (originalLocalData === undefined) { delete process.env.LOCALAPPDATA; } else { process.env.LOCALAPPDATA = originalLocalData; }
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, { recursive: true, force: true });
    });
    await first.start(); await second.start();
    const descriptor = readControlDescriptor(first.instanceId);
    assert.equal((await executeControlRequest({ operation: "qt_get_state", arguments: { instanceId: first.instanceId } })).window, "first");
    assert.equal((await executeControlRequest({ operation: "qt_get_state", arguments: { instanceId: second.instanceId } })).window, "second");
    assert.equal((await listControlInstances()).length, 2);
    await assert.rejects(callLocalControl({ ...descriptor, token: "0".repeat(64) }, { operation: "qt_get_state", arguments: {} }), /인증/);
    await assert.rejects(callLocalControl(descriptor, { operation: "qt_get_state", arguments: { instanceId: second.instanceId } }), /다른 VS Code/);
    await assert.rejects(executeControlRequest({ operation: "qt_get_state", arguments: {} }), /instanceId/);
    await assert.rejects(executeControlRequest({ operation: "qt_debug_control", arguments: { instanceId: first.instanceId, sessionId: "s", action: "deleteEverything" } }), /unsupported/);
    await assert.rejects(executeControlRequest({ operation: "qt_get_state", arguments: { instanceId: first.instanceId, command: "anything" } }), /unknown/);
    assert.throws(() => controlPipe("../../other"));
    first.dispose();
    assert.equal((await listControlInstances()).length, 1);
});

test("Codex control skill updates its managed copy and preserves an existing user skill", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-skill-"));
    const originalCodexDirectory = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    t.after(() => {
        if (originalCodexDirectory === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = originalCodexDirectory; }
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const target = installControlSkill(path.resolve(__dirname, ".."));
    assert.equal(target, path.join(root, "skills/vscode-qt-control/SKILL.md"));
    assert(fs.readFileSync(target, "utf8").includes("name: vscode-qt-control"));
    assert.equal(installControlSkill(path.resolve(__dirname, "..")), target);
    const references = path.join(path.dirname(target), "references/debugging.md");
    assert(fs.readFileSync(references).equals(fs.readFileSync(path.join(__dirname, "../media/control/skill/references/debugging.md"))));
    fs.writeFileSync(references, "outdated managed guide");
    const metadata = path.join(path.dirname(target), "agents/openai.yaml");
    fs.writeFileSync(metadata, "policy:\n  allow_implicit_invocation: false\n");
    fs.writeFileSync(path.join(path.dirname(target), "personal-notes.txt"), "keep");
    installControlSkill(path.resolve(__dirname, ".."));
    assert(fs.readFileSync(references).equals(fs.readFileSync(path.join(__dirname, "../media/control/skill/references/debugging.md"))));
    assert.equal(fs.readFileSync(metadata, "utf8"), "policy:\n  allow_implicit_invocation: false\n");
    assert.equal(fs.readFileSync(path.join(path.dirname(target), "personal-notes.txt"), "utf8"), "keep");
    assert(fs.existsSync(path.join(path.dirname(target), "references/qt-workbench.md")));
    assert(fs.existsSync(path.join(path.dirname(target), "references/vscode.md")));
    fs.writeFileSync(target, "User-owned instructions");
    assert.throws(() => installControlSkill(path.resolve(__dirname, "..")), /덮어쓰지/);
    assert.equal(fs.readFileSync(target, "utf8"), "User-owned instructions");
});

test("unified skill archives managed predecessors, retains notes and explicit invocation policy, and ignores unrelated user skills", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-skill-merge-"));
    const original = process.env.CODEX_HOME; process.env.CODEX_HOME = root;
    t.after(() => {
        if (original === undefined) { delete process.env.CODEX_HOME; } else { process.env.CODEX_HOME = original; }
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true });
    });
    const previous = path.join(root, "skills/qt-pro-control"); fs.mkdirSync(path.join(previous, "agents"), { recursive: true });
    fs.writeFileSync(path.join(previous, "SKILL.md"), "<!-- Managed by Qt Pro Workbench control API v1. -->");
    fs.writeFileSync(path.join(previous, "notes.txt"), "user notes");
    fs.writeFileSync(path.join(previous, "agents/openai.yaml"), "policy:\n  allow_implicit_invocation: false\n");
    const unrelated = path.join(root, "skills/vscode-control"); fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, "SKILL.md"), "User-owned instructions");
    const target = installControlSkill(path.resolve(__dirname, ".."));
    assert(!fs.existsSync(previous)); assert.equal(fs.readFileSync(path.join(unrelated, "SKILL.md"), "utf8"), "User-owned instructions");
    assert(fs.readFileSync(path.join(path.dirname(target), "agents/openai.yaml"), "utf8").includes("allow_implicit_invocation: false"));
    const backup = path.join(root, "skill-backups", fs.readdirSync(path.join(root, "skill-backups"))[0]);
    assert.equal(fs.readFileSync(path.join(backup, "qt-pro-control/notes.txt"), "utf8"), "user notes");
    assert.equal(fs.readdirSync(path.join(root, "skill-backups")).length, 1);
    installControlSkill(path.resolve(__dirname, "..")); assert.equal(fs.readdirSync(path.join(root, "skill-backups")).length, 1);
});
