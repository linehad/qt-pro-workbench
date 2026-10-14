const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { debuggerPathForKit } = require("../out/XDebugConfiguration");
const { qtDebugSetupCommands } = require("../out/XQtDebugPrinters");

test("Qt 4.8.1 defaults to its bundled GDB 7.2 across relocated SDKs; explicit debugger and other Qt kits retain their selection", () => {
    const kit = { qmakePath: "C:/QtSDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe", compilerDirectory: "C:/QtSDK/mingw/bin" };
    assert.equal(debuggerPathForKit(kit), path.resolve("C:/QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe"));
    const relocated = { qmakePath: "D:/Development/QtSDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe", compilerDirectory: "D:/Development/QtSDK/mingw/bin" };
    assert.equal(debuggerPathForKit(relocated), path.resolve("D:/Development/QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe"));
    assert.equal(debuggerPathForKit({ ...kit, debuggerPath: "E:/Custom/gdb.exe" }), "E:/Custom/gdb.exe");
    const modern = { qmakePath: "C:/Qt/6.11.0/mingw_64/bin/qmake.exe", compilerDirectory: "C:/Qt/Tools/mingw1310_64/bin" };
    assert.equal(debuggerPathForKit(modern), path.join(modern.compilerDirectory, "gdb.exe"));
});

test("Qt 4 loads packaged printers and uses UTF-8 output; newer Qt kits keep their setup", () => {
    const legacy = { qmakePath: "D:/SDK/Desktop/Qt/4.8.1/mingw/bin/qmake.exe" };
    const commands = qtDebugSetupCommands(legacy);
    assert.equal(commands[0].text, "set charset UTF-8");
    assert(commands[1].text.includes("XQt4Printers.register_printers()"));
    assert(commands[1].text.includes("media/debug"));
    assert(commands.every(command => command.ignoreFailures === false));
    assert.deepEqual(qtDebugSetupCommands({ qmakePath: "C:/Qt/6.11.0/mingw_64/bin/qmake.exe" }), []);
});
