const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const reportPath = path.resolve(__dirname, "integration-results.json");
    const taskResults = [];
    const errors = [];
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    vscode.window.showErrorMessage = async message => { errors.push(message); return undefined; };
    const listener = vscode.tasks.onDidEndTask(event => {
        if (event.execution.task.source === "Qt Pro") { taskResults.push({ name: event.execution.task.name }); }
    });
    try {
        assert(!vscode.workspace.workspaceFolders?.length, "Must work without an opened folder");
        const extension = vscode.extensions.getExtension("ynlim.qt-pro-workbench");
        assert(extension);
        await extension.activate();
        const projectPath = path.resolve(__dirname, "smoke source/smoke.pro");
        const sourceBefore = fs.readdirSync(path.dirname(projectPath));
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(projectPath));
        vscode.window.showQuickPick = async choices => {
            const values = await Promise.resolve(choices);
            return values.find(choice => choice.kit?.name.startsWith("Qt 6.")) ?? values[0];
        };
        await vscode.commands.executeCommand("qtPro.selectKit");
        const succeeded = await vscode.commands.executeCommand("qtPro.run");
        assert.equal(succeeded, true, "Build and executable must succeed");
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(taskResults.length, 3, "qmake, make and program tasks must run");
        assert.deepEqual(fs.readdirSync(path.dirname(projectPath)), sourceBefore);
        await vscode.commands.executeCommand("qtPro.closeProject");
        const failurePath = path.resolve(__dirname, "smoke source/failure.pro");
        fs.writeFileSync(failurePath, "error(Intentional test failure)\n");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(failurePath));
        await vscode.commands.executeCommand("qtPro.selectKit");
        const failed = await vscode.commands.executeCommand("qtPro.run");
        await new Promise(resolve => setTimeout(resolve, 400));
        assert.equal(failed, false);
        assert.equal(taskResults.length, 4, "Failure must stop before make and run");
        assert(errors.some(message => message.includes("qmake 실패")));
        await vscode.commands.executeCommand("qtPro.closeProject");
        fs.writeFileSync(reportPath, JSON.stringify({ passed: true, folderless: true, stopsOnFailure: true, taskResults }, null, 4));
    } catch (error) {
        fs.writeFileSync(reportPath, JSON.stringify({ passed: false, error: String(error), errors, taskResults }, null, 4));
        throw error;
    } finally {
        listener.dispose();
        vscode.window.showQuickPick = originalPick;
        vscode.window.showErrorMessage = originalError;
    }
};
