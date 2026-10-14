const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateKits, saveKits } = require("../out/XKitSettings");

test("kit edits retain identity and advanced options; invalid paths and conflicting edits cannot overwrite saved kits", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-kit-settings-"));
    const tool = name => { const file = path.join(root, name); fs.writeFileSync(file, "fixture"); return file; };
    const kit = { id: "existing-kit", name: "Qt test", qmakePath: tool("qmake.exe"), compilerDirectory: root, makePath: tool("mingw32-make.exe"), debuggerPath: tool("gdb.exe"), spec: "win32-g++", qmakeArguments: ['CONFIG+=one two'], makeArguments: ["-j", "2"], environment: { CUSTOM_PATH: "C:\\one two" } };
    tool("g++.exe");
    const file = path.join(root, "kits.json");
    fs.writeFileSync(file, JSON.stringify([kit]));
    const original = fs.readFileSync(file, "utf8");
    const changed = { ...kit, name: "Renamed kit" };
    const saved = saveKits(file, [changed], original);
    assert.equal(saved[0].id, kit.id);
    assert.deepEqual(saved[0].makeArguments, ["-j", "2"]);
    assert.equal(saved[0].environment.CUSTOM_PATH, "C:\\one two");
    const persisted = fs.readFileSync(file, "utf8");
    assert.throws(() => saveKits(file, [kit], original), /다른 곳/);
    assert.throws(() => saveKits(file, [{ ...kit, qmakePath: path.join(root, "missing.exe") }], persisted), /찾을 수 없습니다/);
    assert.equal(fs.readFileSync(file, "utf8"), persisted);
    assert.throws(() => validateKits([kit, kit]), /중복/);
    assert.throws(() => validateKits([{ ...kit, environment: { PATH: "a", Path: "b" } }]), /중복/);
    assert.throws(() => validateKits([{ ...kit, qmakeArguments: ["a\nb"] }]), /인수를 한 줄/);
    assert.equal(validateKits([{ ...kit, debuggerPath: "" }])[0].debuggerPath, undefined);
    assert.deepEqual(saveKits(file, [], persisted), []);
    for (const name of fs.readdirSync(root)) { fs.unlinkSync(path.join(root, name)); }
    fs.rmdirSync(root);
});
