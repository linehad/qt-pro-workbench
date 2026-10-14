const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { activeRunConfiguration, changeRunConfiguration, getRunConfigurationSet, normalizeRunConfigurationSet, runSettingsKey } = require("../out/XRunConfigurations");
const { getRunSettings } = require("../out/XRunSettings");
const { loadRunConfigurations, saveRunConfigurations } = require("../out/XRunSettingsStore");
const initial = () => getRunConfigurationSet({ configuration: "debug" }, "kit", "debug", "Project");

test("adding, cloning and switching named runs preserves independent settings including empty arguments", () => {
    let state = initial();
    const firstId = state.activeId;
    state = changeRunConfiguration(state, { action: "save", id: firstId, settings: { executable: "", arguments: "Run", workingDirectory: "data" } });
    state = changeRunConfiguration(state, { action: "add", kind: "custom", name: "Custom Executable" });
    const customId = state.activeId;
    assert.equal(activeRunConfiguration(state).executable, "");
    assert.equal(activeRunConfiguration(state).kind, "custom");
    state = changeRunConfiguration(state, { action: "save", id: customId, settings: { executable: "C:/deployed/app.exe", arguments: "", workingDirectory: "" } });
    state = changeRunConfiguration(state, { action: "rename", id: customId, name: "Deployed" });
    state = changeRunConfiguration(state, { action: "clone", id: customId, name: "Deployed" });
    const cloneId = state.activeId;
    assert.notEqual(cloneId, customId);
    assert.equal(activeRunConfiguration(state).name, "Deployed (2)");
    state = changeRunConfiguration(state, { action: "save", id: cloneId, settings: { executable: "C:/other.exe", arguments: '"two words"', workingDirectory: "other" } });
    state = changeRunConfiguration(state, { action: "select", id: firstId });
    assert.equal(activeRunConfiguration(state).arguments, "Run");
    assert.equal(activeRunConfiguration(state).workingDirectory, "data");
    const preferences = { configuration: "debug", runConfigurations: { [runSettingsKey("kit", "debug")]: state } };
    assert.equal(getRunSettings(preferences, "kit").arguments, "Run");
    state = changeRunConfiguration(state, { action: "select", id: customId });
    assert.equal(activeRunConfiguration(state).arguments, "");
    assert.equal(activeRunConfiguration(state).executable, "C:/deployed/app.exe");
    const before = structuredClone(state);
    assert.throws(() => changeRunConfiguration(state, { action: "rename", id: customId, name: "Project" }), /같은 이름/);
    assert.deepEqual(state, before);
    state = changeRunConfiguration(state, { action: "remove", id: customId });
    assert.equal(state.activeId, cloneId);
    assert.throws(() => changeRunConfiguration(state, { action: "save", id: customId, settings: before.items[1] }), /삭제/);
    state = changeRunConfiguration(state, { action: "remove", id: cloneId });
    assert.equal(state.activeId, firstId);
    assert.throws(() => changeRunConfiguration(state, { action: "remove", id: firstId }), /하나 이상/);
});

test("legacy files migrate losslessly and named selections survive reload without leaking across project, kit or build configuration", () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "qt-run-configs-"));
    const project = path.join(storage, "Project.pro");
    const key = runSettingsKey("kit", "debug");
    const old = { executable: "C:/existing/app.exe", arguments: "Run", workingDirectory: "C:/runtime" };
    saveRunConfigurations(storage, project, { [key]: old });
    const migrated = loadRunConfigurations(storage, project);
    assert.equal(migrated[key].items.length, 1);
    assert.deepEqual(getRunSettings({ configuration: "debug", runConfigurations: migrated }, "kit"), old);
    let state = changeRunConfiguration(migrated[key], { action: "add", kind: "custom", name: "Separate" });
    state = changeRunConfiguration(state, { action: "save", id: state.activeId, settings: { executable: "C:/separate.exe", arguments: "", workingDirectory: "" } });
    saveRunConfigurations(storage, project, { [key]: state, [runSettingsKey("kit", "release")]: initial() });
    const loaded = loadRunConfigurations(storage, project);
    assert.deepEqual(loaded[key], state);
    assert.equal(getRunSettings({ configuration: "debug", runConfigurations: loaded }, "kit").executable, "C:/separate.exe");
    assert.equal(getRunSettings({ configuration: "release", runConfigurations: loaded }, "kit").executable, "");
    assert.equal(getRunSettings({ configuration: "debug", runConfigurations: loaded }, "other-kit").executable, "");
    assert.equal(loadRunConfigurations(storage, path.join(storage, "Other.pro")), undefined);
    assert(!fs.existsSync(project), "Storing configuration must not create project files");
    const directory = path.join(storage, "run-configurations");
    for (const entry of fs.readdirSync(directory)) { fs.unlinkSync(path.join(directory, entry)); }
    fs.rmdirSync(directory); fs.rmdirSync(storage);
});

test("invalid named records fail explicitly instead of silently launching a different executable", () => {
    assert.throws(() => normalizeRunConfigurationSet({ activeId: "missing", items: initial().items }), /목록에 없습니다/);
    assert.throws(() => normalizeRunConfigurationSet({ activeId: "default", items: [...initial().items, ...initial().items] }), /중복/);
    assert.throws(() => normalizeRunConfigurationSet({ activeId: "default", items: [{ ...initial().items[0], arguments: '"unfinished' }] }), /큰따옴표/);
});
