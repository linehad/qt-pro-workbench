const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, tasks: [], launches: [], errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const originalCommand = vscode.commands.executeCommand;
    let chosenConfiguration = "release";
    let activeContext = false;
    let finished;
    let session;
    let timer;
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.configuration === chosenConfiguration || item.kit?.name.startsWith("Qt 4.8.1"));
    vscode.window.showErrorMessage = async message => { report.errors.push(message); return undefined; };
    vscode.commands.executeCommand = async (command, ...args) => {
        if (command === "setContext" && args[0] === "qtPro.hasActiveProject") { activeContext = args[1]; }
        return originalCommand(command, ...args);
    };
    const tasks = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { report.tasks.push(event.execution.task.name); } });
    const tracker = vscode.debug.registerDebugAdapterTrackerFactory("cppdbg", {
        createDebugAdapterTracker(value) {
            session = value;
            return { onWillReceiveMessage(message) {
                if (message.command === "launch") {
                    const { program, args, cwd } = message.arguments;
                    report.launches.push({ program, args, cwd });
                }
            } };
        }
    });
    const termination = vscode.debug.onDidTerminateDebugSession(value => { if (value === session) { finished?.(); } });
    const normalize = value => path.resolve(value).toLowerCase();
    try {
        const extension = vscode.extensions.getExtension("ynlim.qt-pro-workbench");
        await extension.activate();
        const binding = extension.packageJSON.contributes.keybindings.find(item => item.key === "f5");
        assert(binding);
        assert.equal(binding.when, "qtPro.hasActiveProject && debugState == inactive");
        const root = fs.mkdtempSync(path.join(__dirname, "f5-configuration-qa-"));
        const project = path.join(root, "app.pro");
        const source = path.join(root, "main.cpp");
        fs.writeFileSync(project, "TEMPLATE = app\nTARGET = F5Configuration\nQT = core\nCONFIG += console\nSOURCES = main.cpp\n");
        fs.writeFileSync(source, '#include <QtCore/QCoreApplication>\n#include <stdio.h>\n#define VALUE 1\nint main(int argc, char **argv) {\nFILE *f=fopen("mode.txt", "w");\n#ifdef QT_NO_DEBUG\nfprintf(f, "release\\n");\n#else\nfprintf(f, "debug\\n");\n#endif\nfprintf(f, "%d\\n%s", VALUE, argc>1 ? argv[1] : "");\nfclose(f); return 0;\n}\n');
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        await vscode.commands.executeCommand("qtPro.selectKit");
        const document = await vscode.workspace.openTextDocument(source);
        await vscode.window.showTextDocument(document);
        assert.equal(vscode.window.activeTextEditor.document.languageId, "cpp");
        assert(activeContext);
        const pressF5 = async () => {
            const ended = new Promise((resolve, reject) => {
                finished = resolve;
                timer = setTimeout(() => reject(new Error("F5 session timeout")), 45000);
            });
            try {
                assert.equal(await vscode.commands.executeCommand(binding.command), true);
                await ended;
            } finally { clearTimeout(timer); }
        };
        await vscode.commands.executeCommand("qtPro.selectConfiguration");
        const releaseRun = path.join(root, "release-run");
        fs.mkdirSync(releaseRun);
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: "ReleaseArgument", workingDirectory: releaseRun });
        await pressF5();
        assert.deepEqual(report.tasks, ["app.pro: qmake", "app.pro: build"]);
        assert.equal(fs.readFileSync(path.join(releaseRun, "mode.txt"), "utf8").replaceAll("\r", ""), "release\n1\nReleaseArgument");
        const releaseExe = path.join(root, "release/F5Configuration.exe");
        const releaseObject = path.join(root, "release/main.o");
        assert.equal(normalize(report.launches[0].program), normalize(releaseExe));
        const releaseTimes = [fs.statSync(releaseExe).mtimeMs, fs.statSync(releaseObject).mtimeMs];
        await pressF5();
        assert.deepEqual([fs.statSync(releaseExe).mtimeMs, fs.statSync(releaseObject).mtimeMs], releaseTimes);
        assert.equal(report.tasks.length, 3);
        chosenConfiguration = "debug";
        await vscode.commands.executeCommand("qtPro.selectConfiguration");
        const debugRun = path.join(root, "debug-run");
        fs.mkdirSync(debugRun);
        await vscode.commands.executeCommand("qtPro.configureRun", undefined, { executable: "", arguments: "DebugArgument", workingDirectory: debugRun });
        const edit = new vscode.WorkspaceEdit();
        const valueOffset = document.getText().indexOf("VALUE 1") + "VALUE ".length;
        edit.replace(document.uri, new vscode.Range(document.positionAt(valueOffset), document.positionAt(valueOffset + 1)), "2");
        assert(await vscode.workspace.applyEdit(edit));
        assert(document.isDirty);
        await pressF5();
        assert(!document.isDirty);
        assert.equal(normalize(report.launches[2].program), normalize(path.join(root, "debug/F5Configuration.exe")));
        assert.equal(fs.readFileSync(path.join(debugRun, "mode.txt"), "utf8").replaceAll("\r", ""), "debug\n2\nDebugArgument");
        assert.deepEqual([fs.statSync(releaseExe).mtimeMs, fs.statSync(releaseObject).mtimeMs], releaseTimes);
        const failure = new vscode.WorkspaceEdit();
        failure.insert(document.uri, document.positionAt(document.getText().length), "\n#error F5_BUILD_FAILURE\n");
        assert(await vscode.workspace.applyEdit(failure));
        assert.equal(await vscode.commands.executeCommand(binding.command), false);
        assert.equal(report.launches.length, 3, "Build failure must not launch an old executable");
        assert.equal(report.errors.length, 1);
        assert.match(report.errors[0], /build 실패/);
        report.selectedConfigurationPreserved = true;
        report.cppEditorUsesF5Binding = true;
        report.unchangedReleaseReused = true;
        report.unsavedChangesBuiltBeforeLaunch = true;
        report.buildFailureStopsLaunch = true;
        report.passed = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        clearTimeout(timer);
        tasks.dispose(); tracker.dispose(); termination.dispose();
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError; vscode.commands.executeCommand = originalCommand;
        fs.writeFileSync(path.join(__dirname, "f5-configuration-results.json"), JSON.stringify(report, null, 4));
    }
};
