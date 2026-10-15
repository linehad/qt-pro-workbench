const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const { TXGitRepository, decodeGitContent } = require("../out/XGitRepository");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(__dirname, "git-history-qa-"));
    t.after(() => { assert.equal(path.dirname(root), __dirname); fs.rmSync(root, { recursive: true, force: true }); });
    const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "core.autocrlf=false", "-c", "user.name=History QA", "-c", "user.email=qa@example.invalid", ...args], { encoding: "utf8", windowsHide: true });
    const repo = name => { const folder = path.join(root, name); fs.mkdirSync(folder); git(folder, "init", "--quiet"); return folder; };
    const write = (folder, file, text) => { const target = path.join(folder, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); return target; };
    const commit = (folder, subject) => { git(folder, "add", "--all"); git(folder, "commit", "--quiet", "-m", subject); return git(folder, "rev-parse", "HEAD").trim(); };
    return { root, git, repo, write, commit };
}

test("file history follows renames across pages and excludes identical names in other repositories", async t => {
    const f = fixture(t); const work = f.repo("work"); const main = f.repo("main");
    f.write(work, "driver/옛 파일.cpp", "int value = 1;\n"); const first = f.commit(work, "처음 구현");
    f.git(work, "mv", "driver/옛 파일.cpp", "driver/new [1].cpp"); const rename = f.commit(work, "rename");
    const source = f.write(work, "driver/new [1].cpp", "int value = 2;\n"); const change = f.commit(work, "changed");
    f.write(work, "driver/new 1.cpp", "unrelated\n"); f.commit(work, "unrelated wildcard path");
    const copy = f.write(main, "driver/new [1].cpp", "different repository\n"); f.commit(main, "main only");
    const repository = new TXGitRepository();
    const page = await repository.history(source, true, 0, 2);
    assert.equal(page.repositoryRoot, work); assert.deepEqual(page.commits.map(item => item.hash), [change, rename]);
    assert.equal(page.hasMore, true); assert.equal(page.nextSkip, 2);
    assert.equal(page.commits[1].previousPath, "driver/옛 파일.cpp");
    const older = await repository.history(source, true, page.nextSkip, 2);
    assert.deepEqual(older.commits.map(item => item.hash), [first]); assert.equal(older.hasMore, false);
    assert.equal(older.commits[0].filePath, "driver/옛 파일.cpp");
    const revision = info => repository.revision({ repositoryRoot: work, encoding: "utf8", ...info });
    assert.equal(await revision({ hash: rename, filePath: page.commits[1].filePath }), "int value = 1;\n");
    assert.equal(await revision({ hash: page.commits[1].parents[0], filePath: page.commits[1].previousPath }), "int value = 1;\n");
    const selected = await repository.commit(source, rename, page.commits[1].filePath);
    assert.equal(selected.commit.previousPath, "driver/옛 파일.cpp"); assert.equal(selected.commit.change, "R100");
    assert.equal((await repository.history(copy)).commits[0].subject, "main only");
    assert.equal((await repository.history(source, false)).commits.length, 4);
    await assert.rejects(revision({ hash: change, filePath: "../main/driver/new [1].cpp" }), /저장소 밖/);
    await assert.rejects(revision({ hash: "HEAD~1", filePath: page.filePath }), /전체 커밋 해시/);
});

test("history resolves linked worktrees and handles untracked files and repositories without commits", async t => {
    const f = fixture(t); const root = f.repo("source"); const source = f.write(root, "App.pro", "SOURCES = main.cpp\n");
    const repository = new TXGitRepository();
    assert.deepEqual((await repository.history(source)).commits, []);
    f.commit(root, "project");
    const untracked = f.write(root, "untracked.cpp", "no history\n");
    assert.deepEqual((await repository.history(untracked)).commits, []);
    const linked = path.join(f.root, "linked"); f.git(root, "worktree", "add", "--quiet", "--detach", linked, "HEAD");
    assert(fs.statSync(path.join(linked, ".git")).isFile());
    assert.equal((await repository.history(path.join(linked, "App.pro"))).repositoryRoot, linked);
});

test("source revision decoding honors legacy Korean encoding and UTF-16", () => {
    assert.equal(decodeGitContent(Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]), "euckr"), "안녕");
    assert.equal(decodeGitContent(Buffer.from("2f2f20c7d1b1db20c1d6bcae208c630d0a", "hex"), "utf8"), "// 한글 주석 똠\r\n");
    assert.equal(decodeGitContent(Buffer.from("한글", "utf8"), "euckr"), "한글");
    assert.equal(decodeGitContent(Buffer.from("hello", "utf16le"), "utf16le"), "hello");
    assert.equal(decodeGitContent(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("// 한글\r\n", "utf16le")]), "utf8"), "// 한글\r\n");
    assert.equal(decodeGitContent(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("// 한글\r\n", "utf16le").swap16()]), "utf8"), "// 한글\r\n");
    assert.equal(decodeGitContent(Buffer.from([0xe9]), "windows1252"), "é");
});

test("directory history includes descendant changes but excludes siblings and other repositories", async t => {
    const f = fixture(t); const root = f.repo("work"); const other = f.repo("main");
    f.write(root, "driver/a.cpp", "first\n"); f.write(root, "driver/sub/b.h", "before\n"); f.write(root, "driver2/a.cpp", "outside\n");
    const first = f.commit(root, "initial");
    f.write(root, "driver/a.cpp", "second\n"); f.write(root, "driver/sub/b.h", "after\n"); f.write(root, "driver2/a.cpp", "also outside\n"); const changed = f.commit(root, "two descendant files");
    f.write(root, "driver2/a.cpp", "outside only\n"); const head = f.commit(root, "sibling only");
    f.write(other, "driver/a.cpp", "another repository\n"); f.commit(other, "main only");
    const repository = new TXGitRepository();
    const directory = path.join(root, "driver");
    const page = await repository.history(directory, true, 0, 1);
    assert.equal(page.directoryPath, "driver"); assert.equal(page.commits[0].hash, changed); assert.equal(page.hasMore, true);
    assert.deepEqual(page.commits[0].changes.map(change => change.filePath), ["driver/a.cpp", "driver/sub/b.h"]);
    assert.equal((await repository.history(directory, true, page.nextSkip)).commits[0].hash, first);
    const all = await repository.history(root); assert.equal(all.directoryPath, "."); assert.equal(all.commits[0].hash, head);
    const latest = await repository.latest(path.join(root, "driver/a.cpp"), "utf8");
    assert.equal(latest.hash, head); assert.equal(await repository.revision(latest), "second\n");
    const untracked = f.write(root, "driver/new.cpp", "new source\n");
    assert.equal(await repository.revision(await repository.latest(untracked, "utf8")), "");
});

test("graph and revision comparisons work without workspace folders and do not write the source", async t => {
    const f = fixture(t); const root = f.repo("work"); const file = f.write(root, "main.cpp", "first\n"); f.commit(root, "first");
    f.write(root, "main.cpp", "second\n"); f.commit(root, "second");
    const calls = []; const panels = []; let provider;
    const uri = value => ({ ...value, toString: () => JSON.stringify(value) });
    const mock = {
        Uri: { file: fsPath => uri({ scheme: "file", fsPath }), from: uri, joinPath: (base, ...parts) => uri({ scheme: "file", fsPath: path.join(base.fsPath, ...parts) }) },
        ViewColumn: { Active: 1 },
        workspace: { isTrusted: true, workspaceFolders: undefined, textDocuments: [], openTextDocument: async (...args) => { calls.push(["openTextDocument", ...args]); }, getConfiguration: () => ({ get: (_key, fallback) => fallback }), registerTextDocumentContentProvider: (_scheme, content) => { provider = content; return { dispose() {} }; } },
        extensions: { getExtension: () => ({ activate: async () => {} }) },
        commands: { executeCommand: async (...args) => { calls.push(args); } },
        window: {
            showQuickPick: () => { throw new Error("File history must not use a picker"); }, showInformationMessage: () => {}, showErrorMessage: () => {},
            createWebviewPanel: () => {
                const panel = { viewColumn: 1, messages: [], revealCount: 0, reveal() { ++this.revealCount; }, dispose() {}, onDidDispose: () => ({ dispose() {} }) };
                panel.webview = { cspSource: "vscode-webview:", asWebviewUri: item => item, postMessage: async message => { panel.messages.push(message); return true; }, onDidReceiveMessage: callback => { panel.receive = callback; return { dispose() {} }; } };
                panels.push(panel); return panel;
            }
        }
    };
    const originalLoad = Module._load; let TXGitHistory;
    try { Module._load = function (name, ...args) { return name === "vscode" ? mock : originalLoad.call(this, name, ...args); }; ({ TXGitHistory } = require("../out/XGitHistory")); }
    finally { Module._load = originalLoad; }
    const history = new TXGitHistory(mock.Uri.file(path.resolve(__dirname, "..")));
    await history.showGraph({ kind: "project", projectPath: file });
    assert.equal(calls[0][0], "git-graph.view"); assert.equal(calls[0][1].rootUri.fsPath, root);
    await history.showFileHistory({ kind: "file", projectPath: path.join(root, "App.pro"), filePath: file });
    await history.showFileHistory(mock.Uri.file(file)); assert.equal(panels.length, 1); assert.equal(panels[0].revealCount, 1);
    const panel = panels[0]; await panel.receive({ type: "ready" });
    const latest = panel.messages.find(message => message.type === "history").commits[0];
    await panel.receive({ type: "select", hash: latest.hash });
    assert.equal(panel.messages.at(-1).message, "second");
    await panel.receive({ type: "open", hash: latest.hash, action: "previous" });
    const diff = calls.find(call => call[0] === "vscode.diff");
    assert.equal(await provider.provideTextDocumentContent(diff[1]), "first\n");
    assert.equal(await provider.provideTextDocumentContent(diff[2]), "second\n");
    assert.equal(mock.workspace.workspaceFolders, undefined); assert.equal(fs.readFileSync(file, "utf8"), "second\n");
    const page = await history.control("qt_git_history", { file, limit: 1 });
    assert.equal(page.commits.length, 1); assert.equal(page.hasMore, true);
    const read = await history.control("qt_git_read_revision", { file, revision: page.commits[0].hash, historicalPath: page.commits[0].filePath });
    assert.equal(read.text, "second\n");
    const legacyBytes = Buffer.from("2f2f20c7d1b1db20c1d6bcae208c630d0a", "hex");
    const legacy = f.write(root, "legacy.cpp", legacyBytes); const legacyRevision = f.commit(root, "Korean comments");
    const korean = await history.control("qt_git_read_revision", { file: legacy, revision: legacyRevision });
    assert.equal(korean.text, "// 한글 주석 똠\r\n");
    f.write(root, "legacy.cpp", "// 한글 UTF-8\n"); const converted = f.commit(root, "UTF-8 migration");
    assert.equal((await history.control("qt_git_read_revision", { file: legacy, revision: legacyRevision })).text, "// 한글 주석 똠\r\n");
    assert.equal((await history.control("qt_git_read_revision", { file: legacy, revision: converted })).text, "// 한글 UTF-8\n");
    const dirty = { uri: mock.Uri.file(legacy), encoding: "utf8", isDirty: true, getText: () => "// 저장 안 한 수정\n" };
    mock.workspace.textDocuments.push(dirty);
    const compared = await history.control("qt_git_compare_latest", { file: legacy });
    assert.equal(compared.revision, converted); assert.equal(await provider.provideTextDocumentContent(JSON.parse(compared.left)), "// 한글 UTF-8\n");
    assert.equal(JSON.parse(compared.right).fsPath, legacy); assert.equal(dirty.getText(), "// 저장 안 한 수정\n");
    assert.equal(calls.filter(call => call[0] === "openTextDocument").length, 0);
    assert.equal(fs.readFileSync(legacy, "utf8"), "// 한글 UTF-8\n");
    const part = f.write(root, "lib/Common.pri", "SOURCES = a.cpp sub/b.cpp\n");
    f.write(root, "lib/a.cpp", "library source\n"); f.write(root, "lib/sub/b.cpp", "nested library source\n");
    f.commit(root, "three library files");
    const container = await history.showFileHistory({ kind: "include", projectPath: file, partPath: part, label: "Common" });
    assert.equal(container.file, path.dirname(part));
    const folderPanel = panels.at(-1); await folderPanel.receive({ type: "ready" });
    const folderHistory = folderPanel.messages.find(message => message.type === "history");
    assert.equal(folderHistory.isDirectory, true); assert.equal(folderHistory.commits[0].changes.length, 3);
    assert.deepEqual(folderHistory.commits[0].changes.map(change => change.filePath), ["lib/Common.pri", "lib/a.cpp", "lib/sub/b.cpp"]);
    const child = await history.showFileHistory({ kind: "file", projectPath: file, partPath: part, filePath: part, label: "Common.pri" });
    assert.equal(child.file, part);
    const childPanel = panels.at(-1); await childPanel.receive({ type: "ready" });
    const childHistory = childPanel.messages.find(message => message.type === "history");
    assert.equal(childHistory.isDirectory, false); assert.equal(childHistory.commits[0].changes.length, 1);
    mock.workspace.isTrusted = false;
    await assert.rejects(history.control("qt_git_history", { file }), /신뢰/);
    history.dispose();
});

test("calendar dates validate real days and display full months with adjacent dates", () => {
    const { parseDate, dateKey, monthGrid } = require("../media/git-history-calendar.js");
    assert.equal(dateKey(parseDate("2024-02-29")), "2024-02-29");
    for (const value of ["2023-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-00", "2026-10-", "0000-01-01", "0002"]) { assert.equal(parseDate(value), null, value); }
    const june = monthGrid(2024, 5).map(dateKey);
    assert.equal(june.length, 42); assert.equal(june[0], "2024-05-26"); assert.equal(june[6], "2024-06-01"); assert.equal(june[35], "2024-06-30");
    assert(monthGrid(2024, 1).map(dateKey).includes("2024-02-29"));
    assert(!monthGrid(2023, 1).map(dateKey).includes("2023-02-29"));
    assert.equal(dateKey(parseDate("0002-01-01")), "0002-01-01");
});

test("history pane sizing keeps multiple changed-file rows and clamps either draggable boundary", () => {
    const { fitPaneHeights, resizePanePair, ratiosForHeights } = require("../media/git-history-layout.js");
    const limits = [100, 75, 160];
    const initial = fitPaneHeights(550, undefined, limits);
    assert(initial[2] >= 160); assert.equal(initial.reduce((sum, value) => sum + value), 550);
    const moved = resizePanePair(initial, 1, -1000, limits);
    assert.equal(moved[0], initial[0]); assert.equal(moved[1], 75); assert(moved[2] > initial[2]);
    const restored = fitPaneHeights(550, ratiosForHeights(moved, limits), limits);
    restored.forEach((height, index) => assert(Math.abs(height - moved[index]) < 0.001));
    const expanded = resizePanePair(initial, 0, 1000, limits);
    assert.equal(expanded[1], 75); assert.equal(expanded[2], initial[2]);
    const small = fitPaneHeights(280, [0.5, 0.2, 0.3], [70, 50, 130]);
    assert(small[2] >= 130); assert.equal(small.reduce((sum, value) => sum + value), 280);
});

test("splitter pointer and keyboard controls save ratios and retain them when the viewport changes", () => {
    const vm = require("node:vm");
    const source = fs.readFileSync(path.join(__dirname, "../media/git-history-layout.js"), "utf8");
    const element = height => ({
        clientHeight: height, style: {}, listeners: {}, attributes: {}, captures: new Set(),
        classList: { add() {}, remove() {} }, getBoundingClientRect() { return { height }; },
        addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); },
        setAttribute(name, value) { this.attributes[name] = value; },
        setPointerCapture(id) { this.captures.add(id); }, hasPointerCapture(id) { return this.captures.has(id); }, releasePointerCapture(id) { this.captures.delete(id); },
        fire(name, data = {}) { for (const handler of this.listeners[name] || []) { handler({ preventDefault() {}, ...data }); } }
    });
    const nodes = { "commit-list": element(0), "commit-detail": element(0), "changed-panel": element(0), "message-splitter": element(6), "changes-splitter": element(6) };
    const main = element(800); main.children = [element(45), element(32), nodes["commit-list"], element(25), nodes["message-splitter"], nodes["commit-detail"], nodes["changes-splitter"], nodes["changed-panel"], element(48)];
    const saved = []; const window = { innerHeight: 800, addEventListener(name, handler) { this[name] = handler; } };
    vm.runInNewContext(source, { window, document: { querySelector: () => main, getElementById: id => nodes[id], body: element(0) }, getComputedStyle: () => ({ paddingTop: "14", paddingBottom: "14", rowGap: "7" }), ResizeObserver: class { observe() {} } });
    window.GitHistoryLayout.initialize(undefined, ratios => saved.push([...ratios]));
    const values = () => [...main.style.gridTemplateRows.matchAll(/([\d.]+)px/g)].map(match => Number(match[1]));
    const before = values();
    nodes["changes-splitter"].fire("pointerdown", { button: 0, pointerId: 1, clientY: 500 });
    nodes["changes-splitter"].fire("pointermove", { clientY: 450 });
    nodes["changes-splitter"].fire("pointerup", { pointerId: 1 });
    assert(values()[4] > before[4]); assert.equal(saved.length, 1); assert.equal(nodes["changes-splitter"].captures.size, 0);
    const ratio = saved[0];
    main.clientHeight = 620; window.innerHeight = 620; window.resize();
    assert(values()[4] >= 160); assert.equal(saved.length, 1);
    const expected = require("../media/git-history-layout.js").fitPaneHeights(374, ratio, [100, 75, 160]);
    assert(Math.abs(values()[4] - expected[2]) < 0.001);
    nodes["message-splitter"].fire("keydown", { key: "ArrowDown" }); assert.equal(saved.length, 2);
    nodes["changes-splitter"].fire("dblclick"); assert.deepEqual(saved.at(-1), [0.5, 0.2, 0.3]);
});

test("log view keeps the newest selection details and only opens commits from its loaded pages", async () => {
    let receive; const sent = []; const opened = []; let finishFirst;
    const mock = {
        Uri: { joinPath: (_base, ...parts) => parts.join("/") }, ViewColumn: { Active: 1 },
        window: { createWebviewPanel: () => ({
            viewColumn: 1, reveal() {}, dispose() {}, onDidDispose: () => ({ dispose() {} }),
            webview: { cspSource: "vscode-webview:", asWebviewUri: value => value, postMessage: async message => { sent.push(message); return true; }, onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; } }
        }) }
    };
    delete require.cache[require.resolve("../out/XGitHistoryView")];
    const originalLoad = Module._load; let TXGitHistoryView;
    try { Module._load = function (name, ...args) { return name === "vscode" ? mock : originalLoad.call(this, name, ...args); }; ({ TXGitHistoryView } = require("../out/XGitHistoryView")); }
    finally { Module._load = originalLoad; }
    const first = { hash: "a".repeat(40), parents: [], author: "QA", date: "2026-10-01", subject: "first", filePath: "main.cpp" };
    const second = { ...first, hash: "b".repeat(40), subject: "second" };
    const view = new TXGitHistoryView({
        extensionUri: {}, file: "main.cpp", repositoryRoot: "QA", onDispose() {},
        load: async skip => ({ repositoryRoot: "QA", commits: skip ? [second] : [first], nextSkip: skip + 1, hasMore: !skip }),
        message: hash => hash === first.hash ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve("second body"),
        open: async (commit, action) => opened.push({ commit, action }),
        openLatest: async () => opened.push({ latest: true })
    });
    await receive({ type: "ready" }); await receive({ type: "more" });
    assert.equal(sent.findLast(message => message.type === "history").commits.length, 2);
    const pending = receive({ type: "select", hash: first.hash });
    await receive({ type: "select", hash: second.hash }); finishFirst("late first body"); await pending;
    assert.deepEqual(sent.filter(message => message.type === "detail").map(message => message.hash), [second.hash]);
    await receive({ type: "open", hash: "c".repeat(40), action: "previous" }); assert.equal(opened.length, 0);
    await receive({ type: "open", hash: second.hash, action: "delete" }); assert.equal(opened.length, 0);
    await receive({ type: "open", hash: second.hash, action: "previous", file: "unrelated.cpp" });
    assert.equal(opened[0].commit.filePath, "main.cpp"); assert.equal(opened[0].action, "previous");
    await receive({ type: "latest" }); assert.equal(opened[1].latest, true);
    view.dispose();
});

test("directory log opens only a selected change and validates latest comparison paths", async () => {
    let receive; const sent = []; const opened = [];
    const mock = { Uri: { joinPath: (_base, ...parts) => parts.join("/") }, ViewColumn: { Active: 1 }, window: { createWebviewPanel: () => ({
        viewColumn: 1, reveal() {}, dispose() {}, onDidDispose: () => ({ dispose() {} }),
        webview: { cspSource: "vscode-webview:", asWebviewUri: value => value, postMessage: async message => { sent.push(message); return true; }, onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; } }
    }) } };
    delete require.cache[require.resolve("../out/XGitHistoryView")];
    const originalLoad = Module._load; let TXGitHistoryView;
    try { Module._load = function (name, ...args) { return name === "vscode" ? mock : originalLoad.call(this, name, ...args); }; ({ TXGitHistoryView } = require("../out/XGitHistoryView")); }
    finally { Module._load = originalLoad; }
    const commit = { hash: "a".repeat(40), parents: [], author: "QA", date: "2026-10-01", subject: "two files", changes: [{ filePath: "driver/a.cpp", change: "A" }, { filePath: "driver/sub/b.cpp", previousPath: "driver/old.cpp", change: "R100" }] };
    const view = new TXGitHistoryView({ extensionUri: {}, file: "driver", repositoryRoot: "QA", isDirectory: true, onDispose() {},
        load: async () => ({ repositoryRoot: "QA", commits: [commit], nextSkip: 1, hasMore: false }), message: async () => "body",
        open: async (item, action) => opened.push({ item, action }), openLatest: async filePath => opened.push({ latest: filePath }) });
    await receive({ type: "ready" });
    await receive({ type: "open", hash: commit.hash, action: "previous", filePath: "outside.cpp" }); assert.equal(opened.length, 0);
    await receive({ type: "latest", hash: commit.hash, filePath: "../../outside.cpp" }); assert.equal(opened.length, 0);
    await receive({ type: "open", hash: commit.hash, action: "previous", filePath: "driver/sub/b.cpp" });
    assert.equal(opened[0].item.filePath, "driver/sub/b.cpp"); assert.equal(opened[0].item.previousPath, "driver/old.cpp");
    await receive({ type: "latest", hash: commit.hash, filePath: "driver/a.cpp" }); assert.equal(opened[1].latest, "driver/a.cpp");
    assert.equal(sent.find(message => message.type === "history").isDirectory, true); view.dispose();
});
