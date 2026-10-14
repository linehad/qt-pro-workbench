const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    let api;
    vscode.window.showQuickPick = async () => { throw new Error("Unexpected picker"); };
    vscode.window.showErrorMessage = async text => { report.errors.push(String(text)); };
    const call = (operation, args = {}) => api.execute({ operation, arguments: args });
    try {
        api = await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const { discoverKits } = require("../out/XKitStore");
        const { makeBuildPlan } = require("../out/XBuildPlan");
        const { getBuildConfigurations } = require("../out/XConfigurations");
        const { saveConfigurations } = require("../out/XConfigurationStore");
        const { cmakeConfigurations } = require("../out/XCMakeIntelliSense");
        const { readCMakeModel } = require("../out/XCMakeFileApi");
        const { parseCMakeProject } = require("../out/XCMakeProject");
        const project = "F:/HydraX_main/HydraX_Daemon/CMakeLists.txt";
        const storage = path.join(__dirname, process.env.QT_PRO_CMAKE_TEST_PROFILE + "/User/globalStorage/ynlim.qt-pro-workbench");
        const kit = { ...discoverKits().find(item => item.name.startsWith("Qt 6.11.1")), cmakeGenerator: "Ninja", cmakeMakePath: "C:/Strawberry/c/bin/ninja.exe" };
        assert(kit.qmakePath); kit.id += "-hydra-cmake-qa";
        const kitsFile = path.join(storage, "kits.json");
        const kits = JSON.parse(fs.readFileSync(kitsFile)); fs.writeFileSync(kitsFile, JSON.stringify([...kits.filter(item => item.id !== kit.id), kit]));
        const preferences = { configuration: "debug", buildSystem: "cmake" };
        const builds = getBuildConfigurations(preferences, kit);
        const suffix = "qt-pro-qa-" + Date.now(); report.outputSuffix = suffix;
        for (const item of builds.items) {
            item.settings.qmakeArguments = `-DHYDRA_OUTPUT_PLATFORM_SUFFIX=${suffix} -DHYDRA_ENABLE_DEPLOY=OFF -DHYDRA_ENABLE_TESTS=OFF`;
            item.settings.makeArguments = "--parallel 4 --target Hydra_Daemon Hydra_Menu";
        }
        saveConfigurations(storage, project, "build-profiles", { [kit.id]: builds });
        preferences.buildProfiles = { [kit.id]: builds };
        await call("qt_select_project", { projectPath: project });
        await call("qt_select_kit", { kitId: kit.id });
        const job = await call("qt_build", { operation: "build" });
        const until = Date.now() + 20 * 60000;
        let result;
        while (Date.now() < until) {
            result = await call("qt_get_job", { jobId: job.id });
            if (result.status !== "running") { break; }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert.equal(result.status, "succeeded", JSON.stringify(result));
        const plan = makeBuildPlan(project, kit, preferences, storage);
        const model = readCMakeModel(plan.buildDirectory, "debug", project);
        const executables = model.targets.filter(target => target.type === "EXECUTABLE");
        report.targets = executables.map(target => ({ name: target.name, artifacts: target.artifacts }));
        assert(executables.some(target => target.name === "Hydra_Daemon"));
        const menu = model.targets.find(target => target.name === "Hydra_Menu");
        assert.equal(menu.type, "MODULE_LIBRARY");
        assert(menu.artifacts.some(file => file.path.endsWith("Menu.dll") && fs.existsSync(path.resolve(model.build, file.path))));
        report.menu = menu.artifacts;
        for (const target of executables) {
            const executable = target.artifacts.find(file => file.path.endsWith(".exe"));
            assert(executable && fs.existsSync(path.resolve(model.build, executable.path)));
        }
        const configs = cmakeConfigurations(plan); report.sources = configs.size;
        const source = path.resolve("F:/HydraX_main/HydraX_Daemon/XDaemon/main.cpp").toLowerCase();
        const config = configs.get(source); assert(config);
        assert(config.includePath.some(file => file.includes("QtCore")));
        assert(config.compilerPath.includes("mingw1310_64"));
        const tree = parseCMakeProject(project, plan); assert.equal(tree.children.length, 2);
        report.buildDirectory = plan.buildDirectory; report.qt = kit.name;
        assert(!fs.existsSync("F:/HydraX_main/HydraX_Daemon/CMakeCache.txt"));
        assert.deepEqual(report.errors, []); report.passed = true;
    } catch (error) {
        report.error = error.stack || String(error);
        if (api) { try { report.logs = (await call("qt_get_log", { limit: 100 })).entries; report.state = await call("qt_get_state"); } catch {} }
        throw error;
    } finally {
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError;
        fs.writeFileSync(path.join(__dirname, "cmake-hydra-results.json"), JSON.stringify(report, null, 4));
    }
};
