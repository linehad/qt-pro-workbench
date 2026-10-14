const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], dialogs: 0, resolved: [] };
    const original = { pick: vscode.window.showQuickPick, dialog: vscode.window.showOpenDialog, error: vscode.window.showErrorMessage, status: vscode.window.createStatusBarItem };
    const { TXIntelliSenseProjects } = require("../out/XIntelliSenseProjects");
    const originalConfiguration = TXIntelliSenseProjects.prototype.configurationFor;
    let profiles;
    const statuses = new Map();
    let dialogResult;
    let kitName = "Qt 4.8.1";
    const normalize = file => path.resolve(file).toLowerCase();
    const waitFor = async (predicate, description) => {
        const deadline = Date.now() + 30000;
        while (!await predicate()) { if (Date.now() > deadline) { throw new Error("Timeout: " + description); } await new Promise(resolve => setTimeout(resolve, 200)); }
    };
    TXIntelliSenseProjects.prototype.configurationFor = function (file) { profiles = this; return originalConfiguration.call(this, file); };
    vscode.window.showQuickPick = async items => {
        const picked = (await Promise.resolve(items)).find(item => item.kit?.name.includes(kitName));
        return picked;
    };
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    vscode.window.showOpenDialog = async options => { report.dialogs++; assert.deepEqual(options.filters, { "Qt qmake project": ["pro"] }); return dialogResult; };
    vscode.window.createStatusBarItem = (...args) => { const status = original.status(...args); statuses.set(args[0], status); return status; };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const root = fs.mkdtempSync(path.join(__dirname, "project-controls-qa-"));
        report.fixture = root;
        const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
        const mother = write("Mother/mother.pro", "TEMPLATE = subdirs\nSUBDIRS = child/child.pro\n");
        write("Mother/child/child.pro", "TEMPLATE = app\nSOURCES += main.cpp\nHEADERS += childInclude/XLocal.h\nINCLUDEPATH += childInclude\nDEFINES += CHILD_PROJECT\n");
        write("Mother/child/childInclude/XLocal.h", "#pragma once\nstruct TXLocal { int value; };\n");
        const childSource = write("Mother/child/main.cpp", "#include <QTcpSocket>\n#include <XLocal.h>\nint child(TXLocal& local) { QTcpSocket socket; return local.value; }\n");
        const other = write("Other/other.pro", "TEMPLATE = app\nSOURCES += other.cpp\nDEFINES += OTHER_PROJECT\n");
        const otherSource = write("Other/other.cpp", "#include <QCoreApplication>\nint other() { return QCoreApplication::applicationPid(); }\n");
        const closed = write("Closed/closed.pro", "TEMPLATE = app\nSOURCES += closed.cpp\nDEFINES += CLOSED_PROJECT\n");
        const closedSource = write("Closed/closed.cpp", "#include <QTcpSocket>\nint closed() { QTcpSocket socket; return socket.isValid(); }\n");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(closed));
        await vscode.commands.executeCommand("qtPro.selectKit");
        await vscode.commands.executeCommand("qtPro.closeProject", { kind: "project", projectPath: closed });
        dialogResult = [vscode.Uri.file(mother)];
        await vscode.commands.executeCommand("qtPro.addProject", { viewId: "qtProProjects" });
        assert.equal(report.dialogs, 1);
        await vscode.commands.executeCommand("qtPro.selectKit");
        const childDoc = await vscode.workspace.openTextDocument(childSource);
        await vscode.window.showTextDocument(childDoc);
        dialogResult = undefined;
        await vscode.commands.executeCommand("qtPro.addProject", childDoc.uri);
        assert.equal(report.dialogs, 2);
        assert(statuses.get("qtPro.activeProject").text.includes("mother.pro"));
        dialogResult = [vscode.Uri.file(other)];
        await vscode.commands.executeCommand("qtPro.addProject", { unrelated: true });
        kitName = "Qt 6.11.0";
        await vscode.commands.executeCommand("qtPro.selectKit");
        const otherDoc = await vscode.workspace.openTextDocument(otherSource);
        const closedDoc = await vscode.workspace.openTextDocument(closedSource);
        for (const [document, kitDirectory] of [[childDoc, "4.8.1"], [otherDoc, "6.11.0"], [closedDoc, "4.8.1"]]) {
            await vscode.window.showTextDocument(document);
            await waitFor(async () => {
                const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", document.uri, new vscode.Position(0, 16));
                const header = definitions?.map(item => (item.uri ?? item.targetUri).fsPath).find(file => file.includes(kitDirectory));
                const errors = vscode.languages.getDiagnostics(document.uri).filter(item => item.severity === vscode.DiagnosticSeverity.Error);
                if (header && !errors.length) { report.resolved.push({ source: document.fileName, header }); return true; }
                report.pending = { source: document.fileName, configuration: profiles.configurationFor(document.uri.fsPath), errors: errors.map(item => item.message) };
                fs.writeFileSync(path.join(__dirname, "project-controls-intellisense-results.json"), JSON.stringify(report, null, 4));
                return false;
            }, "selected file receives its project's Qt kit: " + document.fileName);
            assert(statuses.get("qtPro.activeProject").text.includes("other.pro"));
        }
        assert(profiles.configurationFor(childSource).defines.includes("CHILD_PROJECT"));
        assert(profiles.configurationFor(otherSource).defines.includes("OTHER_PROJECT"));
        assert(profiles.configurationFor(closedSource).defines.includes("CLOSED_PROJECT"));
        const browse = profiles.browseConfiguration().browsePath;
        assert(browse.includes(normalize(childSource))); assert(browse.includes(normalize(otherSource))); assert(browse.includes(normalize(closedSource)));
        for (const [id, command] of [["qtPro.run", "qtPro.run"], ["qtPro.debug", "qtPro.debug"]]) { assert.equal(statuses.get(id).command, command); }
        assert(!statuses.has("qtPro.kitSettings"));
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        const toolbar = manifest.contributes.menus["view/title"].filter(item => item.when === "view == qtProProjects" && item.group.startsWith("navigation@"));
        assert.deepEqual(toolbar.map(item => item.command).sort(), ["qtPro.addProject", "qtPro.refresh", "qtPro.toggleAutoReveal"].sort());
        assert.deepEqual(report.errors, []);
        assert(!fs.existsSync(path.join(root, ".vscode")));
        delete report.pending;
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        TXIntelliSenseProjects.prototype.configurationFor = originalConfiguration;
        vscode.window.showQuickPick = original.pick; vscode.window.showOpenDialog = original.dialog; vscode.window.showErrorMessage = original.error; vscode.window.createStatusBarItem = original.status;
        fs.writeFileSync(path.join(__dirname, "project-controls-intellisense-results.json"), JSON.stringify(report, null, 4));
    }
};
