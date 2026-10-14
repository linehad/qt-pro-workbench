const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, comparisons: [], errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const originalStatus = vscode.window.createStatusBarItem;
    const originalSpawn = childProcess.spawn;
    const statuses = new Map();
    const launches = [];
    let configuration = "debug";
    let operation = "build";
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.configuration === configuration || item.operation === operation || item.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { report.errors.push(message); return undefined; };
    vscode.window.createStatusBarItem = (...args) => {
        const item = originalStatus(...args);
        if (typeof args[0] === "string") { statuses.set(args[0], item); }
        return item;
    };
    childProcess.spawn = (executable, args, options) => {
        if (/^(qmake|mingw32-make)\.exe$/i.test(path.basename(executable))) {
            launches.push({ executable, args, cwd: options.cwd, marker: options.env.QT_PRO_ACTIONS_TEST });
        }
        return originalSpawn(executable, args, options);
    };
    const snapshot = folder => fs.readdirSync(folder, { recursive: true }).map(relative => {
        const entry = fs.statSync(path.join(folder, relative));
        return entry.isFile() ? [relative, entry.size, entry.mtimeMs] : undefined;
    }).filter(Boolean);
    const invoke = async (command, ...args) => {
        launches.length = 0;
        assert.equal(await vscode.commands.executeCommand(command, ...args), true);
        return structuredClone(launches);
    };
    let tree;
    try {
        const extension = vscode.extensions.getExtension("ynlim.qt-pro-workbench");
        await extension.activate();
        const { TXProjectTree } = require("../out/XProjectTree");
        const { discoverKits } = require("../out/XKitStore");
        const { getBuildSettings } = require("../out/XBuildSettings");
        const root = fs.mkdtempSync(path.join(__dirname, "build-actions-qa-"));
        for (const relative of ["mother.pro", "main.cpp", "first/first.pro", "second/second.pro"]) {
            const target = path.join(root, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(__dirname, "target source", relative), target);
        }
        const mother = vscode.Uri.file(path.join(root, "mother.pro"));
        const child = vscode.Uri.file(path.join(root, "first/first.pro"));
        tree = new TXProjectTree([mother.fsPath]);
        const childRoot = tree.getChildren(tree.getChildren()[0]).find(node => node.projectPath === child.fsPath);
        const childFile = tree.getChildren(childRoot).find(node => node.kind === "file");
        await vscode.commands.executeCommand("qtPro.openProject", mother);
        await vscode.commands.executeCommand("qtPro.selectKit", mother);
        await invoke("qtPro.build", mother);
        const siblingBefore = snapshot(path.join(root, "second"));
        const parentBefore = fs.statSync(path.join(root, "Makefile")).mtimeMs;
        // Open the child as an independent root for global button comparisons.
        await vscode.commands.executeCommand("qtPro.closeProject", mother);
        await vscode.commands.executeCommand("qtPro.openProject", child);
        await vscode.commands.executeCommand("qtPro.selectKit", childFile);
        const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
        const bottomBuild = statuses.get("qtPro.build");
        const bottomActions = statuses.get("qtPro.buildActions");
        assert(bottomBuild); assert(bottomActions);
        const toolbar = extension.packageJSON.contributes.menus["view/title"];
        const shortcut = extension.packageJSON.contributes.keybindings.find(item => item.key === "ctrl+shift+b");
        assert.equal(shortcut.when, "qtPro.hasActiveProject");
        for (configuration of ["debug", "release"]) {
            await vscode.commands.executeCommand("qtPro.selectConfiguration", childFile);
            await vscode.commands.executeCommand("qtPro.configureBuild", childFile, { ...getBuildSettings({ configuration }, kit), makeArguments: "-j2", cleanArguments: "clean -j2", environment: `QT_PRO_ACTIONS_TEST=${configuration}` });
            assert(bottomBuild.text.includes("first.pro"));
            assert(bottomBuild.tooltip.toLowerCase().includes(configuration));
            await invoke("qtPro.qmake", childFile);
            for (operation of ["build", "clean", "qmake", "rebuild"]) {
                // A different active project must not change the right-clicked target.
                await vscode.commands.executeCommand("qtPro.selectKit", mother);
                const expected = await invoke(`qtPro.${operation}`, childFile);
                assert(expected.length > 0);
                assert(expected.every(item => item.cwd.toLowerCase() === path.dirname(child.fsPath).toLowerCase()));
                assert(expected.every(item => item.marker === configuration));
                for (const item of expected.filter(item => /mingw32-make/i.test(item.executable))) {
                    assert(item.args.includes(configuration === "debug" ? "Makefile.Debug" : "Makefile.Release"));
                    assert(item.args.includes("-j2"));
                }
                const topCommand = toolbar.find(item => item.command === `qtPro.${operation}`).command;
                assert.deepEqual(await invoke(topCommand), expected, "Top button/menu must use the same commands, directory and environment");
                assert.deepEqual(await invoke(bottomActions.command), expected, "Bottom action menu must use the same build pipeline");
                if (operation === "build") {
                    const object = path.join(root, "first", configuration, "main.o");
                    const before = fs.statSync(object).mtimeMs;
                    assert.deepEqual(await invoke(bottomBuild.command), expected);
                    assert.deepEqual(await invoke(shortcut.command), expected);
                    assert.equal(fs.statSync(object).mtimeMs, before, "Buttons must reuse unchanged objects");
                }
                report.comparisons.push({ configuration, operation, sameProcessArguments: true, sameDirectoryAndEnvironment: true });
            }
        }
        assert.deepEqual(snapshot(path.join(root, "second")), siblingBefore);
        assert.equal(fs.statSync(path.join(root, "Makefile")).mtimeMs, parentBefore);
        assert(!fs.existsSync(path.join(root, ".vscode")));
        assert.deepEqual(report.errors, []);
        report.parentAndSiblingUntouched = true;
        report.passed = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        tree?.dispose();
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
        vscode.window.createStatusBarItem = originalStatus; childProcess.spawn = originalSpawn;
        fs.writeFileSync(path.join(__dirname, "build-actions-results.json"), JSON.stringify(report, null, 4));
    }
};
