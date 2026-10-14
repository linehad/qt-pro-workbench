const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { getBuildConfigurations, getDeployConfigurations, validateBuildConfigurations, validateDeployConfigurations } = require("../out/XConfigurations");
const { loadConfigurations } = require("../out/XConfigurationStore");
const { getRunConfigurationSet } = require("../out/XRunConfigurations");
const { loadRunConfigurations } = require("../out/XRunSettingsStore");

const originalLoad = Module._load;
let TXProjectSettingsController;
try {
    Module._load = function (name, ...args) { return name === "vscode" ? {} : originalLoad.call(this, name, ...args); };
    ({ TXProjectSettingsController } = require("../out/XProjectSettingsController"));
} finally { Module._load = originalLoad; }

test("saving settings preserves the selected build mode; switching profiles selects its mode and separate run settings", async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-mode-test-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const project = path.join(root, "app.pro");
    const kitsPath = path.join(root, "kits.json");
    const kit = { id: "kit", name: "Qt", qmakePath: "C:/Qt/bin/qmake.exe", compilerDirectory: "C:/Qt/mingw/bin", makePath: "C:/Qt/mingw/bin/mingw32-make.exe" };
    fs.writeFileSync(kitsPath, JSON.stringify([kit]));
    let selection = { kitId: kit.id, configuration: "debug", runExecutable: "C:/Debug/app.exe" };
    const preferences = () => ({
        ...selection,
        buildProfiles: loadConfigurations(root, project, "build-profiles", validateBuildConfigurations),
        deployConfigurations: loadConfigurations(root, project, "deploy-configurations", validateDeployConfigurations),
        runConfigurations: loadRunConfigurations(root, project)
    });
    const controller = new TXProjectSettingsController({ storagePath: root, kitsPath, projects: () => [project], activeProject: () => project, preferences, savePreferences: async (_project, value) => { selection = value; }, refresh: async () => {} }, project);
    const save = async (mode, makeArguments) => {
        const current = preferences();
        const builds = getBuildConfigurations(current, kit);
        const build = builds.items.find(item => item.id === builds.activeId);
        const deploys = getDeployConfigurations(current, kit.id);
        const runs = getRunConfigurationSet(current, kit.id, current.configuration);
        const run = runs.items.find(item => item.id === runs.activeId);
        await controller.select({ field: "save", draft: {
            projectPath: project, kitId: kit.id, configuration: current.configuration,
            buildId: builds.activeId, deployId: deploys.activeId, runId: runs.activeId,
            build: { ...build.settings, makeArguments }, deploy: [], run: { ...run, arguments: mode },
            buildMode: mode === "debug" ? "release" : "debug"
        } });
        assert.equal(preferences().configuration, mode);
        assert.equal(getBuildConfigurations(preferences(), kit).items.find(item => item.id === builds.activeId).configuration, mode);
    };
    await save("debug", "-j2");
    await controller.select({ field: "build", change: { action: "select", id: "release" } });
    assert.equal(preferences().configuration, "release");
    assert.equal(preferences().runExecutable, undefined);
    await save("release", "-j3");
    await controller.select({ field: "build", change: { action: "select", id: "debug" } });
    const builds = getBuildConfigurations(preferences(), kit);
    assert.equal(builds.items.find(item => item.id === "debug").settings.makeArguments, "-j2");
    assert.equal(builds.items.find(item => item.id === "release").settings.makeArguments, "-j3");
    for (const mode of ["debug", "release"]) {
        const runs = getRunConfigurationSet(preferences(), kit.id, mode);
        assert.equal(runs.items.find(item => item.id === runs.activeId).arguments, mode);
        assert.equal(runs.items.find(item => item.id === runs.activeId).executable, mode === "debug" ? "C:/Debug/app.exe" : "");
    }
});
