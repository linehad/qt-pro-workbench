const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const reportFile = path.join(__dirname, "../folderless-reference-results.json");
const text = "int qtProReferenceProbe(int value) { return value + 1; }\nint useProbe() { return qtProReferenceProbe(1); }\n";
const dirtySuffix = "// Unsaved reference QA edit\n";

exports.activate = async function () {
    let report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : { passed: false, errors: [] };
    const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 4));
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); save(); };
    try {
        const api = await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const call = (operation, args = {}) => api.execute({ operation, arguments: args });
        if (!report.phase) {
            assert(!vscode.workspace.workspaceFolders?.length);
            report.sessionId = vscode.env.sessionId;
            report.fixture = fs.mkdtempSync(path.join(__dirname, "../folderless-reference-qa-"));
            const write = (file, value) => { const target = path.join(report.fixture, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); return target; };
            write("work/.git", "gitdir: QA"); write("main/.git", "gitdir: QA");
            report.project = write("work/driver/Driver.pro", "TEMPLATE = app\nQT -= gui\nSOURCES = Fins.cpp\nHEADERS = Fins.h\n");
            report.source = write("work/driver/Fins.cpp", text);
            write("work/driver/Fins.h", "int qtProReferenceProbe(int value);\n");
            report.other = write("work/other/Other.pro", "TEMPLATE = lib\nQT -= gui\nSOURCES = Caller.cpp\nHEADERS = ../driver/Fins.h\n");
            write("work/other/Caller.cpp", '#include "../driver/Fins.h"\nint callFromOtherProject() { return qtProReferenceProbe(2); }\n');
            report.copy = write("main/driver/Driver.pro", "TEMPLATE = app\nQT -= gui\nSOURCES = Fins.cpp\nHEADERS = Fins.h\n");
            write("main/driver/Fins.cpp", text); write("main/driver/Fins.h", "int qtProReferenceProbe(int value);\n");
            write("work/closed/Closed.pro", "SOURCES = Closed.cpp\n"); write("work/closed/Closed.cpp", "int qtProReferenceProbe(int); int closedCall() { return qtProReferenceProbe(3); }\n");
            const kit = (await call("qt_get_state")).kits.find(item => /\b4\.8\.1\b/.test(item.name));
            for (const projectPath of [report.project, report.other, report.copy]) {
                await call("qt_select_project", { projectPath }); await call("qt_select_kit", { kitId: kit.id });
            }
            await call("qt_select_project", { projectPath: report.project });
            const document = await vscode.workspace.openTextDocument(report.source);
            const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, document.positionAt(text.length), dirtySuffix); await vscode.workspace.applyEdit(edit);
            const position = document.positionAt(text.indexOf("qtProReferenceProbe"));
            await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
            report.phase = "transitioning"; save();
            await vscode.commands.executeCommand("qtPro.findReferences", document.uri, position);
            return;
        }
        assert.equal(report.phase, "transitioning");
        assert.equal(vscode.env.sessionId, report.sessionId, "Reference search must remain in the same window session");
        report.workspace = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath); save();
        const document = await vscode.workspace.openTextDocument(report.source);
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            const locations = await vscode.commands.executeCommand("qtPro.findReferences", document.uri, document.positionAt(text.indexOf("qtProReferenceProbe")));
            report.locations = locations.map(location => ({ file: location.uri.fsPath, line: location.range.start.line + 1 })); save();
            if (report.locations.some(location => location.file.endsWith("Caller.cpp"))) { break; }
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        assert(report.locations.some(location => location.file.endsWith("Caller.cpp")), JSON.stringify(report.locations));
        assert(report.locations.every(location => location.file.toLowerCase().startsWith(path.join(report.fixture, "work").toLowerCase())));
        assert(!report.locations.some(location => location.file.endsWith("Closed.cpp")));
        assert.equal(document.getText(), text + dirtySuffix); assert.equal(document.isDirty, true);
        assert.equal(fs.readFileSync(report.source, "utf8"), text);
        const state = await call("qt_get_state"); report.projects = state.projects; report.active = state.activeProject;
        assert.equal(state.projects.length, 3); assert.equal(state.activeProject.toLowerCase(), report.project.toLowerCase());
        report.names = (await vscode.commands.executeCommand("qtPro.findName", "qtProReferenceProbe")).map(location => location.uri.fsPath);
        assert(report.names.some(file => file.toLowerCase().startsWith(path.join(report.fixture, "main").toLowerCase())));
        assert(!report.names.some(file => file.endsWith("Closed.cpp")));
        const late = path.join(report.fixture, "late"); fs.mkdirSync(late);
        fs.writeFileSync(path.join(late, ".git"), "gitdir: QA");
        fs.writeFileSync(path.join(late, "Late.pro"), "TEMPLATE = lib\nQT -= gui\nSOURCES = Probe.cpp Caller.cpp\nHEADERS = Probe.h\n");
        fs.writeFileSync(path.join(late, "Probe.cpp"), "int qtProReferenceProbe(int value) { return value + 1; }\n");
        fs.writeFileSync(path.join(late, "Probe.h"), "int qtProReferenceProbe(int value);\n");
        fs.writeFileSync(path.join(late, "Caller.cpp"), '#include "Probe.h"\nint lateCall() { return qtProReferenceProbe(2); }\n');
        await call("qt_select_project", { projectPath: path.join(late, "Late.pro") });
        const lateKit = state.kits.find(item => /\b4\.8\.1\b/.test(item.name)); await call("qt_select_kit", { kitId: lateKit.id });
        const lateDocument = await vscode.workspace.openTextDocument(path.join(late, "Probe.cpp"));
        const lateDeadline = Date.now() + 60000;
        while (Date.now() < lateDeadline) {
            const locations = await vscode.commands.executeCommand("qtPro.findReferences", lateDocument.uri, lateDocument.positionAt(lateDocument.getText().indexOf("qtProReferenceProbe")));
            report.lateReferences = locations.map(location => location.uri.fsPath); save();
            if (report.lateReferences.some(file => file.endsWith("Caller.cpp"))) { break; }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert(report.lateReferences.some(file => file.endsWith("Caller.cpp")));
        assert(report.lateReferences.every(file => file.toLowerCase().startsWith(late.toLowerCase())));
        assert.deepEqual(report.errors, []);
        report.passed = true; report.phase = "complete"; save();
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.action.files.revert");
        await vscode.commands.executeCommand("workbench.action.closeWindow");
    } catch (error) { report.error = error.stack || String(error); save(); }
    finally { vscode.window.showErrorMessage = originalError; }
};
