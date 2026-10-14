const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { parseRunArguments } = require("../out/XRunArguments");
const { getRunSettings, runSettingsKey, configuredExecutable, makeRunTarget, validateRunSettings } = require("../out/XRunSettings");

test("Windows arguments preserve blank values, quoted spaces, backslashes and literal shell characters", () => {
    assert.deepEqual(parseRunArguments(""), []);
    assert.deepEqual(parseRunArguments('Run "two words" "" --mode=test'), ["Run", "two words", "", "--mode=test"]);
    assert.deepEqual(parseRunArguments('"C:\\folder with space\\\\"'), ["C:\\folder with space\\"]);
    assert.deepEqual(parseRunArguments('before\\ next'), ["before\\", "next"]);
    assert.deepEqual(parseRunArguments('"say \\"hi\\"" & echo > file'), ['say "hi"', "&", "echo", ">", "file"]);
    assert.throws(() => parseRunArguments('"unfinished'), /큰따옴표/);
});

test("run profiles isolate kits and Debug/Release and retain explicitly empty arguments", () => {
    const settings = { executable: "C:/moved/app.exe", arguments: "", workingDirectory: "" };
    const preferences = { kitId: "qt4", configuration: "debug", runConfigurations: { [runSettingsKey("qt4", "debug")]: settings } };
    assert.deepEqual(getRunSettings(preferences, "qt4"), settings);
    assert.equal(getRunSettings(preferences, "qt5").executable, "");
    assert.equal(getRunSettings(preferences, "qt4", "release").executable, "");
    assert.deepEqual(validateRunSettings({ ...settings, buildBeforeRun: false }), settings, "Removed legacy checkbox must not affect incremental builds");
    assert.equal(getRunSettings({ kitId: "qt4", configuration: "debug", runExecutable: "old.exe" }, "qt4").executable, "old.exe");
    assert.equal(getRunSettings({ kitId: "qt4", configuration: "debug", runExecutable: "old.exe" }, "qt5").executable, "");
    assert.throws(() => validateRunSettings({ ...settings, arguments: null }));
});

test("custom executable and working directory resolve independently; missing custom targets do not fall back", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-run-"));
    t.after(() => {
        assert(path.basename(root).startsWith("qt-pro-run-"));
        assert(!path.relative(os.tmpdir(), root).startsWith(".."));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const executable = path.join(root, "moved", "app.exe");
    const cwd = path.join(root, "runtime data");
    fs.mkdirSync(path.dirname(executable)); fs.mkdirSync(cwd); fs.writeFileSync(executable, "test fixture");
    const plan = { projectPath: path.join(root, "app.pro"), buildDirectory: path.join(root, "build") };
    const settings = { executable: '${projectDir}/moved/app.exe', arguments: "Run", workingDirectory: "runtime data" };
    assert.equal(configuredExecutable(plan, settings), executable);
    assert.deepEqual(makeRunTarget(plan, settings, executable), { executable, argumentsList: ["Run"], workingDirectory: cwd });
    assert.equal(makeRunTarget(plan, { ...settings, workingDirectory: "%{RunConfig:Executable:Path}", arguments: "" }, executable).workingDirectory, path.dirname(executable));
    assert.equal(makeRunTarget(plan, { ...settings, workingDirectory: "" }, executable).workingDirectory, path.dirname(executable));
    assert.throws(() => makeRunTarget(plan, settings, path.join(root, "missing.exe")), /실행 파일을 찾을/);
    assert.throws(() => makeRunTarget(plan, { ...settings, workingDirectory: "missing" }, executable), /작업 폴더를 찾을/);
});
