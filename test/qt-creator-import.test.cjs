const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { importQtCreatorOnce, readQtCreatorSettings } = require("../out/XQtCreatorImport");
const { qtCreatorKits, mergeQtCreatorKits } = require("../out/XQtCreatorKits");

function fixture() {
    const root = fs.mkdtempSync(path.join(__dirname, "qt-creator-qa-"));
    const tool = file => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "fixture"); return target; };
    const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    const value = (key, data) => {
        if (typeof data === "object") { return `<valuemap type="QVariantMap" key="${escape(key)}">${Object.entries(data).map(([name, item]) => value(name, item)).join("")}</valuemap>`; }
        return `<value type="${typeof data === "number" ? "int" : "QString"}" key="${escape(key)}">${escape(data)}</value>`;
    };
    const writeXml = (directory, file, records) => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, file), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE QtCreatorProfiles><qtcreator>${Object.entries(records).map(([key, data]) => `<data><variable>${key}</variable>${value("", data)}</data>`).join("")}</qtcreator>`);
    };
    return { root, tool, writeXml };
}

test("Creator SDK and user records bind exact compilers, GDB and CMake; import runs once and preserves existing edits and IDs", () => {
    const { root, tool, writeXml } = fixture();
    const sdk = path.join(root, "sdk"); const user = path.join(root, "user");
    const qmake = tool("Qt/6.11.1/mingw_64/bin/qmake.exe");
    const cxx = tool("Compiler/bin/g++.exe"); const c = tool("Compiler/bin/gcc.exe");
    const make = tool("Compiler/bin/mingw32-make.exe"); const debuggerPath = tool("Compiler/bin/gdb-custom.exe"); const cmakePath = tool("Tools/cmake.exe");
    writeXml(sdk, "toolchains.xml", {
        "ToolChain.0": { "ProjectExplorer.ToolChain.Id": "ProjectExplorer.ToolChain.Mingw:cxx", "ProjectExplorer.GccToolChain.Path": cxx },
        "ToolChain.1": { "ProjectExplorer.ToolChain.Id": "ProjectExplorer.ToolChain.Mingw:c", "ProjectExplorer.GccToolChain.Path": c }
    });
    writeXml(sdk, "qtversion.xml", { "QtVersion.0": { Id: -1, autodetectionSource: "SDK.Qt6", QMakePath: qmake } });
    const data = { "PE.Profile.DeviceType": "Desktop", "PE.Profile.ToolChainsV3": { Cxx: "cxx", C: "c" }, "QtSupport.QtInformation": "SDK.Qt6", "Debugger.Information": "debugger", "CMakeProjectManager.CMakeKitInformation": "cmake" };
    const profile = { "PE.Profile.Id": "CreatorKit", "PE.Profile.Name": "Qt %{Qt:Version} & 한글", "PE.Profile.Data": data };
    writeXml(sdk, "profiles.xml", { "Profile.0": profile });
    writeXml(user, "profiles.xml", { "Profile.0": { ...profile, "PE.Profile.Data": { ...data, "CMake.GeneratorKitInformation": { Generator: "Ninja" } } } });
    writeXml(user, "debuggers.xml", { "DebuggerItem.0": { Id: "debugger", Binary: debuggerPath, EngineType: 1 } });
    writeXml(user, "cmaketools.xml", { "CMakeTools.0": { Id: "cmake", Binary: cmakePath } });
    const settings = readQtCreatorSettings(path.join(__dirname, ".."), [sdk, user]);
    const skipped = []; const imported = qtCreatorKits(settings, skipped);
    assert.equal(imported.length, 1); assert.deepEqual(skipped, []);
    assert.equal(imported[0].name, "Qt 6.11.1 & 한글"); assert.equal(imported[0].cxxCompilerPath, cxx);
    assert.equal(imported[0].debuggerPath, debuggerPath); assert.equal(imported[0].cmakePath, cmakePath); assert.equal(imported[0].cmakeGenerator, "Ninja");
    const kitsFile = path.join(root, "kits.json");
    const existing = { id: "keep-identity", name: "My edited kit", qmakePath: qmake, compilerDirectory: path.dirname(cxx), makePath: make, makeArguments: ["-j2"], environment: { MINE: "keep" } };
    const initialized = mergeQtCreatorKits([{ ...existing, cmakeGenerator: "MinGW Makefiles" }], imported, true).kits;
    assert.equal(initialized[0].id, existing.id); assert.equal(initialized[0].cmakeGenerator, "Ninja"); assert.equal(initialized[0].name, imported[0].name);
    fs.writeFileSync(kitsFile, JSON.stringify([existing]));
    const first = importQtCreatorOnce(path.join(__dirname, ".."), kitsFile, [sdk, user]);
    assert.equal(first.added, 0); assert.equal(first.updated, 1);
    const saved = JSON.parse(fs.readFileSync(kitsFile, "utf8"));
    assert.equal(saved[0].id, existing.id); assert.equal(saved[0].name, existing.name);
    assert.deepEqual(saved[0].makeArguments, ["-j2"]); assert.deepEqual(saved[0].environment, existing.environment);
    assert.equal(saved[0].debuggerPath, debuggerPath);
    fs.writeFileSync(kitsFile, "[]"); fs.writeFileSync(path.join(user, "profiles.xml"), "corrupt XML");
    assert.equal(importQtCreatorOnce(path.join(__dirname, ".."), kitsFile, [sdk, user]), undefined);
    assert.equal(fs.readFileSync(kitsFile, "utf8"), "[]");
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "qt-creator-import.json"), "utf8")).status, "complete");
});

test("Qt 4 Creator imports keep the requested bundled GDB 7.2 even when Creator points at another GDB", () => {
    const { root, tool, writeXml } = fixture(); const directory = path.join(root, "creator");
    const qmake = tool("QtSDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe"); const cxx = tool("QtSDK/mingw/bin/mingw32-g++.exe");
    tool("QtSDK/mingw/bin/mingw32-make.exe"); const expected = tool("QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe");
    const otherDebugger = tool("NewCompiler/gdb.exe");
    writeXml(directory, "toolchains.xml", { "ToolChain.0": { "ProjectExplorer.ToolChain.Id": "Mingw:{id}", "ProjectExplorer.GccToolChain.Path": cxx } });
    writeXml(directory, "qtversion.xml", { "QtVersion.0": { Id: 3, QMakePath: qmake } });
    writeXml(directory, "profiles.xml", { "Profile.0": { "PE.Profile.Id": "Legacy", "PE.Profile.Name": "Qt 4.8.1", "PE.Profile.Data": { "PE.Profile.DeviceType": "Desktop", "PE.Profile.ToolChainsV3": { Cxx: "{id}" }, "QtSupport.QtInformation": 3, "Debugger.Information": { Binary: otherDebugger, EngineType: 1 } } } });
    const kits = qtCreatorKits(readQtCreatorSettings(path.join(__dirname, ".."), [directory]), []);
    assert.equal(kits.length, 1); assert.equal(kits[0].debuggerPath, expected);
});
