const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [], moves: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showQuickPick = async items => (await Promise.resolve(items)).find(item => item.kit?.name.includes("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { report.errors.push(String(message)); };
    const waitFor = async (predicate, description, timeout = 15000) => {
        const deadline = Date.now() + timeout;
        while (!await predicate()) {
            if (Date.now() > deadline) { throw new Error("Timeout: " + description); }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    };
    const normalize = file => path.resolve(file).toLowerCase();
    const location = item => ({ file: (item.uri ?? item.targetUri).fsPath, line: (item.range ?? item.targetSelectionRange).start.line });
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        assert(!vscode.workspace.workspaceFolders?.length);
        const root = fs.mkdtempSync(path.join(__dirname, "declaration-definition-qa-"));
        report.fixture = root;
        const project = path.join(root, "navigation.pro");
        const header = path.join(root, "XTable.h");
        const source = path.join(root, "XTable.cpp");
        fs.writeFileSync(project, "TEMPLATE = lib\nHEADERS += XTable.h\nSOURCES += XTable.cpp\n");
        fs.writeFileSync(header, "#pragma once\nclass TXVersionOne {\npublic:\n    int UpdateRecovery(int value);\n};\nclass TXVersionTwo {\npublic:\n    int UpdateRecovery(int value);\n};\n");
        fs.writeFileSync(source, '#include "XTable.h"\n\nint TXVersionOne::UpdateRecovery(int value) { return value + 1; }\nint TXVersionTwo::UpdateRecovery(int value) { return value + 2; }\nint use(TXVersionOne& table) { return table.UpdateRecovery(0); }\n');
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        await vscode.commands.executeCommand("qtPro.selectKit");
        const headerDoc = await vscode.workspace.openTextDocument(header);
        const sourceDoc = await vscode.workspace.openTextDocument(source);
        await vscode.window.showTextDocument(headerDoc, { preview: false });
        await vscode.window.showTextDocument(sourceDoc, { preview: false });
        const symbolPosition = (document, line) => new vscode.Position(line, document.lineAt(line).text.indexOf("UpdateRecovery") + 3);
        const settings = vscode.workspace.getConfiguration("editor.gotoLocation", sourceDoc);
        assert.equal(settings.get("alternativeDefinitionCommand"), "editor.action.revealDeclaration");
        assert.equal(settings.get("alternativeDeclarationCommand"), "editor.action.revealDefinition");
        assert.equal(vscode.workspace.getConfiguration("editor.gotoLocation", { languageId: "typescript" }).get("alternativeDefinitionCommand"), "editor.action.goToReferences");
        await waitFor(async () => {
            const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", headerDoc.uri, symbolPosition(headerDoc, 3));
            report.definitions = definitions?.map(location);
            return report.definitions?.some(item => normalize(item.file) === normalize(source) && item.line === 2);
        }, "C/C++ indexes the definition", 30000);
        await waitFor(async () => {
            const declarations = await vscode.commands.executeCommand("vscode.executeDeclarationProvider", sourceDoc.uri, symbolPosition(sourceDoc, 2));
            report.declarations = declarations?.map(location);
            return report.declarations?.some(item => normalize(item.file) === normalize(header) && item.line === 3);
        }, "C/C++ indexes the declaration", 30000);
        const navigate = async (from, fromLine, to, toLine, command = "editor.action.revealDefinition") => {
            const position = symbolPosition(from, fromLine);
            const editor = await vscode.window.showTextDocument(from, { preview: false, selection: new vscode.Range(position, position) });
            await vscode.commands.executeCommand(command);
            await waitFor(() => {
                const current = vscode.window.activeTextEditor;
                if (!current) { return false; }
                return normalize(current.document.fileName) === normalize(to.fileName) && current.selection.active.line === toLine;
            }, `${path.basename(from.fileName)}:${fromLine + 1} -> ${path.basename(to.fileName)}:${toLine + 1}`);
            report.moves.push({ from: fromLine + 1, to: toLine + 1, command, target: path.basename(to.fileName) });
        };
        await navigate(sourceDoc, 2, headerDoc, 3);
        await navigate(headerDoc, 3, sourceDoc, 2);
        await navigate(sourceDoc, 3, headerDoc, 7);
        await navigate(headerDoc, 7, sourceDoc, 3);
        await navigate(sourceDoc, 4, sourceDoc, 2);
        // The declaration command also switches back when already at that declaration.
        await navigate(headerDoc, 3, sourceDoc, 2, "editor.action.revealDeclaration");
        assert(!fs.existsSync(path.join(root, ".vscode")));
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) { report.error = error.stack || String(error); throw error; }
    finally {
        vscode.window.showQuickPick = originalPick;
        vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(path.join(__dirname, "declaration-definition-results.json"), JSON.stringify(report, null, 4));
    }
};
