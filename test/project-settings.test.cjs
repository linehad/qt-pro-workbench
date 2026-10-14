const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getBuildConfigurations, getDeployConfigurations, changeConfiguration, validateBuildConfigurations, validateDeployConfigurations } = require("../out/XConfigurations");
const { loadConfigurations, saveConfigurations } = require("../out/XConfigurationStore");
const { getBuildSettings, buildSettingsKey } = require("../out/XBuildSettings");
const { deployFiles, resolveDeployPath } = require("../out/XDeploy");
const { parseRunArguments, formatRunArguments } = require("../out/XRunArguments");
const { makeRunTarget, validateRunSettings } = require("../out/XRunSettings");
const { makeBuildPlan, kitEnvironment } = require("../out/XBuildPlan");
const { recordQmakeState } = require("../out/XQmakeState");
const { spawnSync } = require("node:child_process");

const kit = { id: "kit", name: "Qt", qmakePath: "C:/Qt/bin/qmake.exe", compilerDirectory: "C:/Qt/mingw/bin", makePath: "C:/Qt/mingw/bin/mingw32-make.exe" };

test("build profiles migrate existing settings, clone independently, retain selection and isolate kits", () => {
    const custom = { ...getBuildSettings({ configuration: "debug" }, kit), makeArguments: "-j3" };
    const preferences = { configuration: "debug", buildConfigurations: { [buildSettingsKey(kit.id, "debug")]: custom } };
    const builds = getBuildConfigurations(preferences, kit);
    assert.equal(builds.items[0].settings.makeArguments, "-j3");
    const cloned = changeConfiguration(builds, { action: "clone", id: "debug", name: "Debug Test" });
    cloned.items.at(-1).settings.makeArguments = "-j5";
    assert.equal(cloned.items[0].settings.makeArguments, "-j3");
    const saved = { ...preferences, buildProfiles: { [kit.id]: cloned } };
    assert.equal(getBuildSettings(saved, kit).makeArguments, "-j5");
    assert.equal(getBuildConfigurations({ ...saved, configuration: "release" }, kit).activeId, "release");
    assert.notEqual(getBuildSettings(saved, { ...kit, id: "other" }).makeArguments, "-j5");
    assert.throws(() => changeConfiguration(cloned, { action: "rename", id: "debug", name: "Release" }), /같은 이름/);
    assert.throws(() => validateBuildConfigurations({ ...cloned, activeId: "missing" }), /선택한 구성/);
});

test("named build/deploy settings persist outside projects with independent project, kit and mode selections", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-config-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, "source/app.pro");
    const builds = getBuildConfigurations({ configuration: "debug" }, kit);
    const deploys = getDeployConfigurations({ configuration: "debug" }, kit.id);
    deploys.items[0].steps = [{ id: "copy", source: "${executable}", destination: "deploy" }];
    const storage = path.join(root, "personal");
    saveConfigurations(storage, project, "build-profiles", { [kit.id]: builds });
    saveConfigurations(storage, project, "deploy-configurations", { [buildSettingsKey(kit.id, "debug")]: deploys });
    assert.deepEqual(loadConfigurations(storage, project, "build-profiles", validateBuildConfigurations)[kit.id], builds);
    const preferences = { configuration: "debug", deployConfigurations: loadConfigurations(storage, project, "deploy-configurations", validateDeployConfigurations) };
    assert.deepEqual(getDeployConfigurations(preferences, kit.id), deploys);
    assert.deepEqual(getDeployConfigurations({ ...preferences, configuration: "release" }, kit.id).items[0].steps, []);
    assert.deepEqual(getDeployConfigurations(preferences, "other").items[0].steps, []);
    assert.equal(loadConfigurations(storage, path.join(root, "other.pro"), "deploy-configurations", validateDeployConfigurations), undefined);
    assert(!fs.existsSync(path.dirname(project)));
    assert.throws(() => changeConfiguration(deploys, { action: "remove", id: "default" }), /하나 이상/);
});

test("deployment copies files and folders incrementally and preserves source names and empty directories", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-copy-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "assets/empty"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets/data.txt"), "first");
    fs.writeFileSync(path.join(root, "app.exe"), "executable");
    const plan = { projectPath: path.join(root, "app.pro"), buildDirectory: root, configuration: "release" };
    const steps = [{ id: "1", source: "${executable}", destination: "deploy/${configuration}" }, { id: "2", source: "assets", destination: "deploy/${configuration}" }];
    assert.deepEqual(await deployFiles(steps, plan, path.join(root, "app.exe")), { copied: 2, unchanged: 0 });
    assert(fs.statSync(path.join(root, "deploy/release/assets/empty")).isDirectory());
    const output = path.join(root, "deploy/release/assets/data.txt");
    const firstTime = fs.statSync(output).mtimeMs;
    assert.deepEqual(await deployFiles(steps, plan, path.join(root, "app.exe")), { copied: 0, unchanged: 2 });
    assert.equal(fs.statSync(output).mtimeMs, firstTime);
    fs.writeFileSync(path.join(root, "assets/data.txt"), "other");
    assert.deepEqual(await deployFiles(steps, plan, path.join(root, "app.exe")), { copied: 1, unchanged: 1 });
    assert.equal(fs.readFileSync(output, "utf8"), "other");
    assert.throws(() => resolveDeployPath("${outputDir}", plan), /변수/);
});

test("deployment validates all steps before copying, rejects collisions and recursive destinations", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-copy-invalid-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "a")); fs.mkdirSync(path.join(root, "b"));
    fs.writeFileSync(path.join(root, "a/data.txt"), "a"); fs.writeFileSync(path.join(root, "b/data.txt"), "b");
    const plan = { projectPath: path.join(root, "app.pro"), buildDirectory: root, configuration: "debug" };
    await assert.rejects(deployFiles([{ source: "a", destination: "dest" }, { source: "missing", destination: "dest" }], plan), /원본을 찾을/);
    assert(!fs.existsSync(path.join(root, "dest")));
    await assert.rejects(deployFiles([{ source: "a", destination: "a/sub" }], plan), /원본 폴더 안/);
    await assert.rejects(deployFiles([{ source: "a/data.txt", destination: "dest" }, { source: "b/data.txt", destination: "dest" }], plan), /중복/);
    assert(!fs.existsSync(path.join(root, "dest")));
});

test("one-line make argument formatting round-trips Windows quoting and empty arguments", () => {
    const values = ["-j8", "", "path with spaces\\", 'embedded"quote', "C:\\plain\\", "$(literal)"];
    assert.deepEqual(parseRunArguments(formatRunArguments(values)), values);
    assert.equal(formatRunArguments(["-j8"]), "-j8");
    assert.match(getBuildSettings({ configuration: "debug" }, kit).makeArguments, /^-j\d+$/);
});

test("run environment and GDB commands inherit build settings and preserve explicitly empty options", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-run-extra-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const executable = path.join(root, "app.exe"); fs.writeFileSync(executable, "test");
    const plan = { projectPath: path.join(root, "app.pro"), buildDirectory: root, environment: { PATH: "kit", BUILD: "yes" } };
    const settings = validateRunSettings({ executable, arguments: "", workingDirectory: "", environment: "PATH=run\nRUN=yes", startupCommands: "set pagination off\n\nset print elements 0", runInTerminal: false });
    const target = makeRunTarget(plan, settings, executable);
    assert.deepEqual(target.environment, { PATH: "run", BUILD: "yes", RUN: "yes" });
    assert.deepEqual(target.startupCommands, ["set pagination off", "set print elements 0"]);
    assert.equal(target.runInTerminal, false);
    assert.deepEqual(target.argumentsList, []);
    assert.throws(() => validateRunSettings({ ...settings, environment: "INVALID" }), /NAME=value/);
});

test("qmake reuses compatible Creator outputs but refreshes changed qmake settings, not make-only changes or Debug/Release switching", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-qmake-state-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const project = path.join(root, "app.pro");
    const storage = path.join(root, "personal");
    fs.writeFileSync(project, "TEMPLATE = app\n");
    for (const suffix of ["Debug", "Release"]) { fs.writeFileSync(path.join(root, "Makefile." + suffix), `# Project: ${project}\nQMAKE = ${kit.qmakePath}\n# Command: ${kit.qmakePath} app.pro\n`); }
    const preferences = { configuration: "debug" };
    const original = makeBuildPlan(project, kit, preferences, storage);
    assert.equal(original.needsQmake, false);
    recordQmakeState(original);
    assert.equal(makeBuildPlan(project, kit, { configuration: "release" }, storage).needsQmake, false);
    const settings = getBuildSettings(preferences, kit);
    const withSettings = value => ({ ...preferences, buildConfigurations: { [buildSettingsKey(kit.id, "debug")]: { ...settings, ...value } } });
    assert.equal(makeBuildPlan(project, kit, withSettings({ makeArguments: "-j3" }), storage).needsQmake, false);
    assert.equal(makeBuildPlan(project, kit, withSettings({ qmakeArguments: "DEFINES+=NEW_OPTION" }), storage).needsQmake, true);
    assert.equal(makeBuildPlan(project, kit, withSettings({ environment: "QMAKE_EXTRA=yes" }), storage).needsQmake, true);
    assert.equal(makeBuildPlan(project, kit, withSettings({ qmakeArguments: "DEFINES+=NEW_OPTION" }), path.join(root, "fresh-personal")).needsQmake, true);
});

test("GDB pipe inherits the run environment and handles a debugger command containing spaces without a shell", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-pipe space-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const probe = path.join(root, "environment probe.js");
    fs.writeFileSync(probe, 'process.stdout.write(process.env.QT_PRO_PIPE_TEST || "missing");\n');
    for (const command of [formatRunArguments([process.execPath, probe]), process.execPath + " " + formatRunArguments([probe])]) {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, "../out/XDebugPipe.js"), process.execPath, command], { env: { ...process.env, QT_PRO_PIPE_TEST: "inherited" }, encoding: "utf8", windowsHide: true, timeout: 10000 });
        assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "inherited");
    }
});
