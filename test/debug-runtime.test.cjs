const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { installDebugRuntime, debugPipePath, debugSupportDirectory } = require("../out/XDebugRuntime");

test("debug helpers survive deletion of the extension package and updated helpers retain the previous runtime", () => {
    const root = fs.mkdtempSync(path.join(__dirname, "debug-runtime-qa-"));
    const extension = path.join(root, "extension");
    const files = ["out/XDebugPipe.js", "out/XRunArguments.js", "media/debug/XQt4Printers.py", "media/debug/XQt4Values.py", "media/debug/XQt4Containers.py", "media/debug/InterruptProcess.ps1"];
    for (const file of files) {
        const to = path.join(extension, file); fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(__dirname, "..", file), to);
    }
    const directory = installDebugRuntime(extension, path.join(root, "storage"));
    assert.equal(debugPipePath(), path.join(directory, "XDebugPipe.js"));
    assert.equal(debugSupportDirectory(), directory);
    assert.equal(installDebugRuntime(extension, path.join(root, "storage")), directory);
    const saved = fs.readFileSync(path.join(extension, "out/XDebugPipe.js"));
    fs.unlinkSync(path.join(extension, "out/XDebugPipe.js"));
    const output = cp.execFileSync(process.execPath, [debugPipePath(), process.execPath, "-p", "12345"], { encoding: "utf8", windowsHide: true });
    assert.equal(output.trim(), "12345");
    fs.writeFileSync(path.join(extension, "out/XDebugPipe.js"), Buffer.concat([saved, Buffer.from("\n// updated\n")]));
    const updated = installDebugRuntime(extension, path.join(root, "storage"));
    assert.notEqual(updated, directory);
    assert(fs.existsSync(path.join(directory, "XDebugPipe.js")));
    assert(fs.readFileSync(path.join(directory, "XDebugPipe.js")).equals(saved));
});
