const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const vscode = require("vscode");

exports.run = async function () {
    const result = { passed: false, cases: [], tasks: [], errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const listener = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { result.tasks.push(event.execution.task.name); } });
    const report = path.join(__dirname, "build-reuse-results.json");
    const { discoverKits } = require("../out/XKitStore");
    const { makeBuildPlan, kitEnvironment } = require("../out/XBuildPlan");
    const { selectedMakefile } = require("../out/XExistingBuild");
    const { defaultExecutable } = require("../out/XBuildOutput");
    const { getBuildSettings } = require("../out/XBuildSettings");
    const storage = path.join(process.env.LOCALAPPDATA, "Temp/qt-pro-build-reuse-qa/User/globalStorage/ynlim.qt-pro-workbench");
    const snapshot = files => files.map(file => ({ file, hash: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), time: fs.statSync(file).mtimeMs }));
    let wantedKit;
    let wantedConfiguration = "debug";
    vscode.window.showQuickPick = async choices => {
        const items = await Promise.resolve(choices);
        if (items[0]?.configuration) { return items.find(item => item.configuration === wantedConfiguration); }
        return items.find(item => item.kit?.id === wantedKit.id);
    };
    vscode.window.showErrorMessage = async message => { result.errors.push(message); return undefined; };
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const root = fs.mkdtempSync(path.join(__dirname, "build-reuse-qa-"));
        for (const kit of discoverKits()) {
            wantedKit = kit;
            for (const configuration of ["debug", "release"]) {
                wantedConfiguration = configuration;
                const directory = path.join(root, `${kit.id}-${configuration}`);
                fs.mkdirSync(directory, { recursive: true });
                const project = path.join(directory, "reuse.pro");
                const includePaths = Array.from({ length: 18 }, (_, index) => `INCLUDEPATH += $$PWD/include/directory_${index}_with_long_name`).join("\n");
                fs.writeFileSync(project, `TEMPLATE = app\nTARGET = ReuseSmoke\nQT = core\nCONFIG += console\nCONFIG -= app_bundle\nCONFIG(debug, debug|release): MODE = debug\nCONFIG(release, debug|release): MODE = release\nOBJECTS_DIR = $$PWD/build/win/$$MODE/obj\nMOC_DIR = $$PWD/build/win/$$MODE/moc\nRCC_DIR = $$PWD/build/win/$$MODE/rcc\nDESTDIR = $$PWD/output/$$MODE\nwin32:system(if not exist $$MOC_DIR mkdir $$MOC_DIR)\nwin32:system(if not exist $$MOC_DIR/mocinclude.tmp echo. > $$MOC_DIR/mocinclude.tmp)\nHEADERS = Probe.h\nSOURCES = main.cpp\n${includePaths}\n`);
                fs.writeFileSync(path.join(directory, "Probe.h"), '#include <QObject>\nclass Probe : public QObject { Q_OBJECT public: Probe() {} };\n');
                fs.writeFileSync(path.join(directory, "main.cpp"), '#include "Probe.h"\nint main() { Probe probe; return 0; }\n');
                const options = { cwd: directory, env: kitEnvironment(kit), encoding: "utf8", timeout: 120000, windowsHide: true };
                const qmake = spawnSync(kit.qmakePath, ["reuse.pro", "-spec", kit.spec, `CONFIG+=${configuration}`], options);
                assert.equal(qmake.status, 0, qmake.stderr + qmake.stdout);
                const makefile = selectedMakefile(directory, configuration);
                const baseline = spawnSync(kit.makePath, ["-f", makefile, "-j4"], options);
                assert.equal(baseline.status, 0, baseline.stderr + baseline.stdout);
                const plan = makeBuildPlan(project, kit, { configuration }, storage);
                assert.equal(plan.buildDirectory, directory);
                assert.equal(plan.needsQmake, false);
                const object = path.join(directory, `build/win/${configuration}/obj/main.o`);
                const mocObject = path.join(directory, `build/win/${configuration}/obj/moc_Probe.o`);
                const moc = path.join(directory, `build/win/${configuration}/moc/moc_Probe.cpp`);
                const executable = defaultExecutable(plan);
                assert.equal(executable, path.join(directory, `output/${configuration}/ReuseSmoke.exe`));
                const files = [path.join(directory, makefile), object, mocObject, moc, executable];
                const before = snapshot(files);
                await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
                await vscode.commands.executeCommand("qtPro.selectKit");
                await vscode.commands.executeCommand("qtPro.selectConfiguration");
                const taskCount = result.tasks.length;
                assert.equal(await vscode.commands.executeCommand("qtPro.build", vscode.Uri.file(project)), true);
                assert.deepEqual(result.tasks.slice(taskCount), ["reuse.pro: build"], "Existing matching Makefile must skip qmake");
                assert.deepEqual(snapshot(files), before, "Existing Makefile, object, moc and EXE must remain untouched");
                const run = spawnSync(executable, [], options);
                assert.equal(run.status, 0, run.stderr);
                result.cases.push({ kit: kit.name, configuration, reusedMakefile: true, reusedObjectsAndMoc: true, executableUnchanged: true });
                fs.writeFileSync(report, JSON.stringify(result, null, 4));
            }
        }
        assert.deepEqual(result.errors, []);
        result.passed = true;
    } catch (error) { result.error = String(error); throw error; }
    finally {
        listener.dispose();
        vscode.window.showQuickPick = originalPick;
        vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(report, JSON.stringify(result, null, 4));
    }
};
