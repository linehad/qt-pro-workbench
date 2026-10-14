const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { getBuildSettings, buildSettingsKey, validateBuildSettings, applyBuildEnvironment } = require("../out/XBuildSettings");
const { makeBuildPlan } = require("../out/XBuildPlan");

test("shadow builds are explicit and isolated per project kit and configuration", () => {
    const kit = { id: "kit", name: "Qt", qmakePath: "C:/Qt/bin/qmake.exe", compilerDirectory: "C:/Qt/mingw/bin", makePath: "C:/Qt/mingw/bin/mingw32-make.exe" };
    const preferences = { configuration: "debug" };
    const defaults = getBuildSettings(preferences, kit);
    assert.equal(defaults.shadowBuild, false);
    const settings = { ...defaults, shadowBuild: true, buildDirectory: "custom-debug", qmakeArguments: '"DEFINES+=ONE TWO"', makeArguments: "-j3", cleanArguments: "clean -j3", environment: "CUSTOM=one two" };
    const saved = { configuration: "debug", buildConfigurations: { [buildSettingsKey(kit.id, "debug")]: settings } };
    const project = path.resolve("test/no-project/app.pro");
    const plan = makeBuildPlan(project, kit, saved, "unused");
    assert.equal(plan.buildDirectory, path.resolve(path.dirname(project), "custom-debug"));
    assert(plan.qmakeArguments.includes("DEFINES+=ONE TWO"));
    assert.deepEqual(plan.makeArguments, ["-j3"]);
    assert.equal(plan.environment.CUSTOM, "one two");
    assert.equal(makeBuildPlan(project, kit, { ...saved, configuration: "release" }, "unused").buildDirectory, path.dirname(project));
    assert.equal(makeBuildPlan(project, { ...kit, id: "other" }, saved, "unused").buildDirectory, path.dirname(project));
    assert.throws(() => validateBuildSettings({ ...settings, buildDirectory: "" }), /폴더/);
    assert.throws(() => validateBuildSettings({ ...settings, qmakeArguments: '"unterminated' }), /큰따옴표/);
    assert.deepEqual(applyBuildEnvironment({ Path: "old" }, "PATH=new"), { Path: "new" });
});
