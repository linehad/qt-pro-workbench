const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const results = { passed: false, tasks: [], errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const report = path.resolve(__dirname, "project-target-results.json");
    const listener = vscode.tasks.onDidStartTask(event => {
        if (event.execution.task.source === "Qt Pro") { results.tasks.push(event.execution.task.name); }
    });
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(choice => choice.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { results.errors.push(message); return undefined; };
    const snapshot = directory => {
        if (!fs.existsSync(directory)) { return []; }
        return fs.readdirSync(directory, { recursive: true }).map(relative => {
            const info = fs.statSync(path.join(directory, relative));
            return info.isFile() ? [relative, info.size, info.mtimeMs] : undefined;
        }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
    };
    let tree;
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const { TXProjectTree } = require("../out/XProjectTree");
        const { discoverKits } = require("../out/XKitStore");
        const { makeBuildPlan } = require("../out/XBuildPlan");
        const fixture = fs.mkdtempSync(path.join(__dirname, "project-target-qa-"));
        for (const relative of ["mother.pro", "main.cpp", "first/first.pro", "second/second.pro"]) {
            const destination = path.join(fixture, relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.resolve(__dirname, "target source", relative), destination);
        }
        const mother = vscode.Uri.file(path.join(fixture, "mother.pro"));
        const first = vscode.Uri.file(path.join(fixture, "first/first.pro"));
        const second = vscode.Uri.file(path.join(fixture, "second/second.pro"));
        const sourceSnapshot = () => snapshot(fixture).filter(([name]) => /\.(pro|cpp)$/.test(name));
        const parentSnapshot = () => snapshot(fixture).filter(([name]) => !name.includes(path.sep));
        const sourceBefore = sourceSnapshot();
        tree = new TXProjectTree([mother.fsPath]);
        const root = tree.getChildren()[0];
        const rootChildren = tree.getChildren(root);
        const motherFile = rootChildren.find(node => node.kind === "file");
        const firstRoot = rootChildren.find(node => node.projectPath === first.fsPath);
        const firstFile = tree.getChildren(firstRoot).find(node => node.kind === "file");
        assert.equal(tree.getTreeItem(motherFile).contextValue, "qtProProjectFile");
        assert.equal(tree.getTreeItem(firstFile).contextValue, "qtProProjectFile");
        assert.equal(tree.getTreeItem(root).contextValue, "qtProProject");

        await vscode.commands.executeCommand("qtPro.openProject", mother);
        await vscode.commands.executeCommand("qtPro.selectKit", motherFile);
        await vscode.commands.executeCommand("qtPro.selectKit", firstFile);
        const kit = discoverKits().find(value => value.name.startsWith("Qt 4.8.1"));
        const storage = path.join(process.env.LOCALAPPDATA, "Temp/qt-pro-target-qa/User/globalStorage/ynlim.qt-pro-workbench");
        const motherPlan = makeBuildPlan(mother.fsPath, kit, { configuration: "debug" }, storage);
        const firstPlan = makeBuildPlan(first.fsPath, kit, { configuration: "debug" }, storage);
        const secondPlan = makeBuildPlan(second.fsPath, kit, { configuration: "debug" }, storage);
        // First is active, but the mother's context menu must build the mother and both children.
        assert.equal(await vscode.commands.executeCommand("qtPro.rebuild", motherFile), true);
        const parentOutputs = snapshot(motherPlan.buildDirectory);
        assert(parentOutputs.some(([file]) => file.endsWith("FirstTarget.exe")));
        assert(parentOutputs.some(([file]) => file.endsWith("SecondTarget.exe")));
        const motherBefore = parentSnapshot();
        const secondBefore = snapshot(secondPlan.buildDirectory);
        const childTasks = results.tasks.length;
        // Mother is active, but the clicked first.pro must receive every operation.
        assert.equal(await vscode.commands.executeCommand("qtPro.qmake", firstFile), true);
        assert.equal(await vscode.commands.executeCommand("qtPro.build", firstFile), true);
        const object = path.join(firstPlan.buildDirectory, "debug/main.o");
        assert(fs.existsSync(object));
        await vscode.commands.executeCommand("qtPro.selectKit", motherFile);
        // Explorer/tab context menus pass a URI instead of a custom tree node.
        assert.equal(await vscode.commands.executeCommand("qtPro.clean", first), true);
        assert(!fs.existsSync(object));
        await vscode.commands.executeCommand("qtPro.selectKit", motherFile);
        assert.equal(await vscode.commands.executeCommand("qtPro.rebuild", first), true);
        assert(fs.existsSync(object));
        assert.deepEqual(results.tasks.slice(childTasks), ["first.pro: qmake", "first.pro: build", "first.pro: clean", "first.pro: clean", "first.pro: qmake", "first.pro: build"]);
        assert.deepEqual(parentSnapshot(), motherBefore, "Child actions must not touch the mother build");
        assert.deepEqual(snapshot(secondPlan.buildDirectory), secondBefore, "Child actions must not touch the sibling build");
        assert.deepEqual(sourceSnapshot(), sourceBefore, "Project sources must stay unchanged");
        assert.deepEqual(results.errors, []);
        results.parentBuildIncludesBothChildren = true;
        results.childActionsLeaveParentAndSiblingUntouched = true;
        results.treeNodeAndUriTargets = true;
        results.passed = true;
    } catch (error) {
        results.error = String(error);
        throw error;
    } finally {
        fs.writeFileSync(report, JSON.stringify(results, null, 4));
        tree?.dispose(); listener.dispose();
        vscode.window.showQuickPick = originalPick;
        vscode.window.showErrorMessage = originalError;
    }
};
