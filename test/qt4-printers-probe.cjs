const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { discoverKits } = require("../out/XKitStore");
const { kitEnvironment } = require("../out/XBuildPlan");
const { debuggerPathForKit } = require("../out/XDebugConfiguration");
const { qtDebugSetupCommands } = require("../out/XQtDebugPrinters");

const root = path.join(__dirname, "qt4-printers-qa");
const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
assert(kit);
const output = path.join(root, "build/debug");
const executable = path.join(output, "QtValues.exe");
const env = kitEnvironment(kit);
const run = (file, args, options = {}) => {
    const result = cp.spawnSync(file, args, { cwd: output, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024, ...options });
    assert.equal(result.status, 0, String(result.error ?? "") + result.stderr + result.stdout);
    return result.stdout + result.stderr;
};
const objdump = path.join(kit.compilerDirectory, "objdump.exe");
for (const file of [executable, path.join(path.dirname(kit.qmakePath), "QtCored4.dll")]) {
    const imports = run(objdump, ["-p", file]);
    assert(imports.includes("DLL Name:"));
}
for (const name of ["QtCored4.dll", "mingwm10.dll", "libgcc_s_dw2-1.dll"]) {
    const source = path.join(name.startsWith("Qt") ? path.dirname(kit.qmakePath) : kit.compilerDirectory, name);
    const target = path.join(output, name);
    fs.copyFileSync(source, target);
    const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(hash(source), hash(target));
}
const cleanEnv = { ...env }; for (const key of Object.keys(cleanEnv)) { if (key.toUpperCase() === "PATH") { delete cleanEnv[key]; } }
cleanEnv.PATH = "C:\\Windows\\System32;C:\\Windows";
run(executable, [], { env: cleanEnv });
const source = fs.readFileSync(path.join(root, "main.cpp"), "utf8");
const breakpointLine = source.split("\n").findIndex(line => line.includes("nMarker += 1")) + 1;
const checks = path.join(__dirname, "XQt4PrinterChecks.py").replaceAll("\\", "/");
const commands = ["set pagination off", "set confirm off", ...qtDebugSetupCommands(kit).map(command => command.text), "break main.cpp:" + breakpointLine, "run", `python exec(compile(open(${JSON.stringify(checks)}, 'rb').read(), ${JSON.stringify(checks)}, 'exec'))`, "show host-charset", "print sText", "print qNames", "print qMap", "print qStringVariant", "continue"];
const commandFile = path.join(root, "checks.gdb"); fs.writeFileSync(commandFile, commands.join("\n") + "\n");
const result = run(debuggerPathForKit(kit), ["-nx", "-batch", "-x", commandFile, executable]);
fs.writeFileSync(path.join(root, "gdb-results.txt"), result);
assert(result.includes("QT4_PRINTER_CHECKS_PASSED"), result);
assert(result.includes("Qt 한글 😀"));
console.log(result.split("\n").filter(line => /PASSED|host character|\$\d+ =/.test(line)).join("\n"));
module.exports = { root, kit, executable, breakpointLine };
