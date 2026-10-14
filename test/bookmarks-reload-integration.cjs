const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false };
    const previous = JSON.parse(fs.readFileSync(path.join(__dirname, "navigation-bookmarks-results.json"), "utf8"));
    const original = vscode.window.createTreeView;
    const views = new Map();
    vscode.window.createTreeView = (id, options) => { const view = original(id, options); views.set(id, { view, provider: options.treeDataProvider }); return view; };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const bookmarks = views.get("qtProBookmarks").provider;
        const rows = bookmarks.getChildren().flatMap(file => bookmarks.getChildren(file));
        assert.equal(rows.length, previous.bookmarks.length);
        assert.equal(rows[0].bookmark.id, previous.bookmarks[0].id);
        assert.equal(rows[0].bookmark.line, 5);
        // A new empty VS Code window has a distinct workspace state.
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(path.join(previous.fixture, "Alpha", "Alpha.pro")));
        await vscode.commands.executeCommand("qtPro.openBookmark", rows[0]);
        assert.equal(vscode.window.activeTextEditor.selection.active.line, 5);
        await vscode.commands.executeCommand("qtPro.revealActiveFile");
        const projects = views.get("qtProProjects");
        report.projects = projects.provider.projects();
        report.found = projects.provider.findFile(rows[0].bookmark.filePath);
        const deadline = Date.now() + 10000;
        while (!projects.view.selection[0] && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.equal(projects.view.selection[0]?.filePath?.toLowerCase(), rows[0].bookmark.filePath.toLowerCase());
        report.restoredBookmark = rows[0].bookmark;
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally { vscode.window.createTreeView = original; fs.writeFileSync(path.join(__dirname, "bookmarks-reload-results.json"), JSON.stringify(report, null, 4)); }
};
