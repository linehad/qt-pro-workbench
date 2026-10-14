const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { discoverKits } = require("../out/XKitStore");
const { kitEnvironment } = require("../out/XBuildPlan");
const kit = discoverKits()[0];
const root = fs.mkdtempSync(path.join(__dirname, "gui-visibility-qa-"));
fs.writeFileSync(path.join(root, "gui.pro"), "TEMPLATE = app\nTARGET = GuiVisibility\nQT = core gui sql\nCONFIG -= console\nSOURCES = main.cpp\n");
fs.writeFileSync(path.join(root, "main.cpp"), `#include <QApplication>
#include <QWidget>
#include <QFile>
#include <QTextStream>
#include <QSqlDatabase>
#include <QPluginLoader>
#include <qt_windows.h>
int main(int argc, char **argv)
{
    QApplication qApplication(argc, argv);
    QWidget qWindow;
    qWindow.setWindowTitle("Qt Pro GUI visibility test");
    qWindow.resize(320, 80);
    qWindow.show();
    qApplication.processEvents();
    QFile qResult(argv[1]);
    qResult.open(QIODevice::WriteOnly);
    QTextStream qStream(&qResult);
    STARTUPINFOW stStartup;
    ZeroMemory(&stStartup, sizeof(stStartup));
    stStartup.cb = sizeof(stStartup);
    GetStartupInfoW(&stStartup);
    qStream << "visible=" << IsWindowVisible(qWindow.winId()) << "\\n";
    qStream << "startupFlags=" << stStartup.dwFlags << " show=" << stStartup.wShowWindow << "\\n";
    qStream << "drivers=" << QSqlDatabase::drivers().join(",") << "\\n";
    if (argc > 2) {
        QPluginLoader qLoader(argv[2]);
        bool bLoaded = qLoader.load();
        qStream << "plugin=" << bLoaded << " " << qLoader.errorString() << "\\n";
    }
    return 0;
}
`);
const env = kitEnvironment(kit);
function run(executable, args, cwd, windowsHide) {
    const result = cp.spawnSync(executable, args, { cwd, env, windowsHide, encoding: "utf8", timeout: 30000 });
    if (result.status !== 0) { throw new Error(`${executable}: ${result.status} ${result.error ?? ""}\n${result.stderr}\n${result.stdout}`); }
}
run(kit.qmakePath, ["gui.pro", "CONFIG+=debug"], root, true);
run(kit.makePath, ["-f", "Makefile.Debug", "-j4"], root, true);
const output = path.join(root, "debug");
for (const name of ["QtCored4.dll", "QtGuid4.dll", "QtSqld4.dll"]) { fs.copyFileSync(path.join(path.dirname(kit.qmakePath), name), path.join(output, name)); }
for (const name of ["mingwm10.dll", "libgcc_s_dw2-1.dll"]) { fs.copyFileSync(path.join(kit.compilerDirectory, name), path.join(output, name)); }
for (const name of ["GuiVisibility.exe", "QtCored4.dll", "QtGuid4.dll", "QtSqld4.dll"]) {
    const imports = cp.spawnSync(path.join(kit.compilerDirectory, "objdump.exe"), ["-p", path.join(output, name)], { env, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(imports.status, 0, String(imports.error ?? imports.stderr));
}
for (const name of ["QtCored4.dll", "QtGuid4.dll", "QtSqld4.dll", "mingwm10.dll", "libgcc_s_dw2-1.dll"]) {
    const source = path.join(name.startsWith("Qt") ? path.dirname(kit.qmakePath) : kit.compilerDirectory, name);
    const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(hash(source), hash(path.join(output, name)));
}
const cleanResult = path.join(root, "clean-path.txt");
const clean = cp.spawnSync(path.join(output, "GuiVisibility.exe"), [cleanResult], { cwd: output, env: { ...env, PATH: "C:\\Windows\\System32;C:\\Windows" }, windowsHide: false, encoding: "utf8", timeout: 10000 });
assert.equal(clean.status, 0); assert.match(fs.readFileSync(cleanResult, "utf8"), /^visible=1/m);
for (const windowsHide of [true, false]) {
    const result = path.join(root, `result-${windowsHide}.txt`);
    run(path.join(output, "GuiVisibility.exe"), [result], output, windowsHide);
    console.log(`windowsHide=${windowsHide}\n${fs.readFileSync(result,"utf8")}`);
}
console.log(root);
module.exports = { root };
