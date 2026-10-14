const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const vscode = {
    env: { sessionId: "reference-test-window" }, debug: {}, commands: { executeCommand: () => { throw new Error("Reference preparation must not open a window"); } },
    Uri: { file: file => ({ fsPath: file }) },
    workspace: { workspaceFile: undefined, workspaceFolders: undefined, textDocuments: [], updateWorkspaceFolders: (_start, _remove, ...folders) => { vscode.workspace.workspaceFolders = [...(vscode.workspace.workspaceFolders ?? []), ...folders]; return true; } }
};
const originalLoad = Module._load;
let reference;
try { Module._load = function (request, ...args) { return request === "vscode" ? vscode : originalLoad.call(this, request, ...args); }; reference = require("../out/XReferenceWorkspace"); }
finally { Module._load = originalLoad; }

test("folderless references prepare the current window and retain project and dirty-document state across the host restart", async t => {
    const root = fs.mkdtempSync(path.join(__dirname, "reference-workspace-qa-"));
    t.after(() => { assert.equal(path.dirname(root), __dirname); fs.rmSync(root, { recursive: true, force: true }); });
    const storage = path.join(root, "personal"); const work = path.join(root, "work"); const main = path.join(root, "main");
    const project = path.join(work, "App.pro"); const file = path.join(work, "main.cpp");
    vscode.workspace.workspaceFolders = undefined; vscode.debug.activeDebugSession = undefined;
    vscode.workspace.textDocuments = [{ uri: { scheme: "file" }, fileName: file, isDirty: true, getText: () => "unsaved text" }];
    const projects = [{ projectPath: project, openedProject: project, root: work, files: [file] }];
    assert.equal(await reference.prepareReferenceWorkspace(storage, projects, project, { file, line: 2, character: 3 }), true);
    const restored = reference.loadReferenceSession(storage);
    assert.deepEqual(restored.projects, [project]); assert.equal(restored.activeProject, project);
    assert.equal(restored.documents[0].dirtyText, "unsaved text"); assert.deepEqual(restored.reference, { file, line: 2, character: 3 });
    assert.equal(vscode.workspace.workspaceFolders.length, 1);
    const other = path.join(main, "Other.pro"); projects.push({ projectPath: other, openedProject: other, root: main, files: [] });
    reference.saveReferenceSession(storage, [project, other], project);
    assert.equal(await reference.prepareReferenceWorkspace(storage, projects, project, { file, line: 2, character: 3 }), false);
    assert.equal(vscode.workspace.workspaceFolders.length, 2);
    assert.deepEqual(reference.loadReferenceSession(storage).projects, [project, other]);
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: path.join(root, "unrelated") } }];
    assert.equal(reference.loadReferenceSession(storage), undefined, "Unrelated workspaces must not adopt the old project session");
});

test("initial reference preparation preserves an active debugger and fails without opening or changing a workspace", async () => {
    vscode.workspace.workspaceFolders = undefined; vscode.debug.activeDebugSession = { id: "keep-running" };
    const project = path.join(__dirname, "guarded.pro");
    await assert.rejects(reference.prepareReferenceWorkspace(__dirname, [{ projectPath: project, openedProject: project, root: __dirname, files: [] }], project, undefined), /디버깅을 종료/);
    assert.equal(vscode.workspace.workspaceFolders, undefined); assert.equal(vscode.debug.activeDebugSession.id, "keep-running");
    vscode.debug.activeDebugSession = undefined;
});
