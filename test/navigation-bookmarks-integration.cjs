const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], selections: [] };
    const original = { tree: vscode.window.createTreeView, status: vscode.window.createStatusBarItem, error: vscode.window.showErrorMessage, input: vscode.window.showInputBox, decoration: vscode.window.createTextEditorDecorationType };
    const views = new Map();
    const subscriptions = [];
    let projectStatus;
    let breakpoint;
    const store = require("../out/XBookmarkStore");
    const originalLoad = store.loadBookmarks;
    store.loadBookmarks = storage => { report.storage = storage; return originalLoad(storage); };
    const normalize = value => path.resolve(value).toLowerCase();
    const waitFor = async (predicate, description) => {
        const deadline = Date.now() + 12000;
        while (!predicate()) { if (Date.now() > deadline) { throw new Error("Timeout: " + description); } await new Promise(resolve => setTimeout(resolve, 40)); }
    };
    vscode.window.createTreeView = (id, options) => { const view = original.tree(id, options); views.set(id, { view, provider: options.treeDataProvider }); return view; };
    vscode.window.createStatusBarItem = (...args) => { const item = original.status(...args); if (args[0] === "qtPro.activeProject") { projectStatus = item; } return item; };
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    vscode.window.showInputBox = async () => "Main handler";
    vscode.window.createTextEditorDecorationType = options => { if (options.gutterIconPath?.fsPath?.endsWith("bookmark.svg")) { report.hasGutterDecoration = true; } return original.decoration(options); };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const root = fs.mkdtempSync(path.join(__dirname, "navigation-bookmarks-qa-"));
        report.fixture = root;
        const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
        const shared = write("Shared.h", "// shared\nvoid shared();\n");
        const first = write("Alpha/Alpha.pro", "TEMPLATE = subdirs\nSUBDIRS = child/Child.pro\n");
        write("Alpha/child/Child.pro", "TEMPLATE = app\ninclude(files.pri)\n");
        write("Alpha/child/files.pri", "HEADERS += ../../Shared.h\nSOURCES += deep/main.cpp\n");
        const firstSource = write("Alpha/child/deep/main.cpp", "// zero\n// one\nvoid first() {\n    int marker = 1;\n    marker++;\n}\n");
        const second = write("Beta/Beta.pro", "TEMPLATE = app\nHEADERS += ../Shared.h\nSOURCES += second.cpp\n");
        const secondSource = write("Beta/second.cpp", "void second() {\n    int other = 2;\n}\n");
        for (const project of [first, second]) { await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project)); }
        const projectTree = views.get("qtProProjects");
        const bookmarks = views.get("qtProBookmarks");
        assert(projectTree); assert(bookmarks);
        subscriptions.push(projectTree.view.onDidChangeSelection(event => { report.selections.push(event.selection[0]?.filePath); }));
        const selectedFile = () => projectTree.view.selection[0]?.filePath;
        const assertActive = () => assert(projectStatus.text.includes("Beta.pro"), "Following editor files must not change the active build/run project");
        const firstDoc = await vscode.workspace.openTextDocument(firstSource);
        const secondDoc = await vscode.workspace.openTextDocument(secondSource);
        await vscode.window.showTextDocument(firstDoc);
        await waitFor(() => selectedFile() && normalize(selectedFile()) === normalize(firstSource), "nested source selection");
        const hierarchy = [];
        let node = projectTree.view.selection[0];
        while (node) { hierarchy.push(node.kind); node = projectTree.provider.getParent(node); }
        assert.deepEqual(hierarchy, ["file", "folder", "group", "include", "project", "project"]);
        assert.equal(normalize(vscode.window.activeTextEditor.document.uri.fsPath), normalize(firstSource));
        assertActive();
        await vscode.window.showTextDocument(secondDoc);
        await waitFor(() => selectedFile() && normalize(selectedFile()) === normalize(secondSource), "second source selection");
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(shared));
        await waitFor(() => selectedFile() && normalize(selectedFile()) === normalize(shared), "shared header selection");
        assert.equal(normalize(projectTree.view.selection[0].projectPath), normalize(second), "Shared header should stay in its selected project branch");
        assertActive();
        await vscode.commands.executeCommand("qtPro.toggleAutoReveal");
        assert.equal(vscode.workspace.getConfiguration("qtPro").get("autoReveal"), false);
        await vscode.window.showTextDocument(firstDoc);
        await new Promise(resolve => setTimeout(resolve, 180));
        assert.equal(normalize(selectedFile()), normalize(shared));
        await vscode.commands.executeCommand("qtPro.toggleAutoReveal");
        await waitFor(() => normalize(selectedFile()) === normalize(firstSource), "re-enable follow");
        await vscode.commands.executeCommand("qtPro.refresh");
        await vscode.commands.executeCommand("qtPro.revealActiveFile");
        assert.equal(normalize(selectedFile()), normalize(firstSource));
        assertActive();
        report.treeFollowing = true;
        report.activeProjectPreserved = true;

        const rows = () => bookmarks.provider.getChildren().flatMap(file => bookmarks.provider.getChildren(file));
        const rowFor = file => rows().find(node => normalize(node.bookmark.filePath) === normalize(file));
        breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(firstSource), new vscode.Position(3, 0)));
        vscode.debug.addBreakpoints([breakpoint]);
        vscode.window.activeTextEditor.selection = new vscode.Selection(0, 0, 0, 0);
        await vscode.commands.executeCommand("qtPro.toggleBookmark", { uri: vscode.Uri.file(firstSource), lineNumber: 4 });
        assert.equal(rowFor(firstSource).bookmark.line, 3, "Margin line must win over the caret position");
        assert(vscode.debug.breakpoints.includes(breakpoint), "Bookmark must not toggle the breakpoint");
        assert.equal(rows().length, 1);
        await vscode.commands.executeCommand("qtPro.renameBookmark", rowFor(firstSource));
        assert.equal(rowFor(firstSource).bookmark.label, "Main handler");
        await vscode.commands.executeCommand("qtPro.toggleBookmark", { uri: vscode.Uri.file(secondSource), lineNumber: 2 });
        assert.equal(rows().length, 2);
        await vscode.commands.executeCommand("qtPro.openBookmark", rowFor(firstSource));
        assert.equal(vscode.window.activeTextEditor.selection.active.line, 3);
        await vscode.commands.executeCommand("qtPro.nextBookmark");
        assert.equal(normalize(vscode.window.activeTextEditor.document.uri.fsPath), normalize(secondSource));
        assert.equal(vscode.window.activeTextEditor.selection.active.line, 1);
        await waitFor(() => normalize(selectedFile()) === normalize(secondSource), "bookmark navigation follows editor");
        await vscode.commands.executeCommand("qtPro.previousBookmark");
        assert.equal(normalize(vscode.window.activeTextEditor.document.uri.fsPath), normalize(firstSource));
        const edit = new vscode.WorkspaceEdit(); edit.insert(firstDoc.uri, new vscode.Position(0, 0), "// inserted\n// inserted too\n");
        assert(await vscode.workspace.applyEdit(edit));
        await waitFor(() => rowFor(firstSource).bookmark.line === 5, "bookmark tracks inserted lines");
        await firstDoc.save();
        const persisted = () => originalLoad(report.storage);
        await waitFor(() => persisted().find(item => normalize(item.filePath) === normalize(firstSource))?.line === 5, "persist moved bookmark");
        assert.equal(persisted().find(item => normalize(item.filePath) === normalize(firstSource)).label, "Main handler");
        const renamed = path.join(path.dirname(secondSource), "renamed.cpp");
        const rename = new vscode.WorkspaceEdit(); rename.renameFile(secondDoc.uri, vscode.Uri.file(renamed));
        assert(await vscode.workspace.applyEdit(rename));
        await waitFor(() => rowFor(renamed), "bookmark follows renamed file");
        await vscode.commands.executeCommand("qtPro.openBookmark", rowFor(renamed));
        assert.equal(normalize(vscode.window.activeTextEditor.document.uri.fsPath), normalize(renamed));
        await vscode.commands.executeCommand("qtPro.removeBookmark", rowFor(renamed));
        assert.equal(rows().length, 1);
        await vscode.commands.executeCommand("qtPro.toggleBookmark", { uri: firstDoc.uri, lineNumber: 6 });
        assert.equal(rows().length, 0);
        await vscode.commands.executeCommand("qtPro.toggleBookmark", { uri: firstDoc.uri, lineNumber: 6 });
        assert.equal(rows().length, 1);
        assert.equal(persisted().length, 1);
        assert(report.hasGutterDecoration);
        assert(!fs.existsSync(path.join(root, ".vscode")));
        assert(!normalize(report.storage).startsWith(normalize(root)));
        assertActive();
        assert.deepEqual(report.errors, []);
        report.bookmarks = persisted();
        report.bookmarkNavigationAndEditing = true;
        report.passed = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        if (breakpoint) { vscode.debug.removeBreakpoints([breakpoint]); }
        for (const disposable of subscriptions) { disposable.dispose(); }
        vscode.window.createTreeView = original.tree; vscode.window.createStatusBarItem = original.status; vscode.window.showErrorMessage = original.error; vscode.window.showInputBox = original.input; vscode.window.createTextEditorDecorationType = original.decoration;
        store.loadBookmarks = originalLoad;
        fs.writeFileSync(path.join(__dirname, "navigation-bookmarks-results.json"), JSON.stringify(report, null, 4));
    }
};
