const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discoverKits } = require("../out/XKitStore");
const { makeBuildPlan } = require("../out/XBuildPlan");

const source = path.resolve(__dirname, "smoke source");
const storage = path.resolve(__dirname, "smoke storage");
fs.mkdirSync(source, { recursive: true });
const projectPath = path.join(source, "smoke.pro");
fs.writeFileSync(projectPath, "TEMPLATE = app\nTARGET = QtProSmoke\nQT += core\nQT -= gui\nCONFIG += console\nCONFIG -= app_bundle\nSOURCES += main.cpp\n");
fs.writeFileSync(path.join(source, "main.cpp"), '#include <QtCore/QCoreApplication>\n#include <cstdio>\nint main(int argc, char **argv) { QCoreApplication app(argc, argv); std::printf("QtPro smoke %s\\n", qVersion()); return 0; }\n');
const sourceBefore = fs.readdirSync(source);
const results = [];
for (const kit of discoverKits()) {
    const plan = makeBuildPlan(projectPath, kit, { configuration: "debug" }, storage);
    fs.mkdirSync(plan.outputDirectory, { recursive: true });
    const options = { cwd: plan.buildDirectory, env: plan.environment, encoding: "utf8", timeout: 90000, windowsHide: true };
    const configure = spawnSync(kit.qmakePath, plan.qmakeArguments, options);
    if (configure.status !== 0) { throw new Error(`${kit.name} qmake: ${configure.error ?? configure.stderr}\n${configure.stdout}`); }
    const build = spawnSync(kit.makePath, plan.makeArguments, options);
    if (build.status !== 0) { throw new Error(`${kit.name} make: ${build.error ?? build.stderr}\n${build.stdout}`); }
    const executable = path.join(plan.outputDirectory, "QtProSmoke.exe");
    const run = spawnSync(executable, [], { ...options, cwd: plan.outputDirectory, timeout: 10000 });
    if (run.status !== 0) { throw new Error(`${kit.name} run: ${run.error ?? run.stderr}, code=${run.status}`); }
    const result = { kit: kit.name, configured: true, built: true, runtime: run.stdout.trim() };
    results.push(result); console.log(JSON.stringify(result));
}
if (JSON.stringify(sourceBefore) !== JSON.stringify(fs.readdirSync(source))) { throw new Error("Build wrote files into source directory"); }
fs.writeFileSync(path.resolve(__dirname, "smoke-results.json"), JSON.stringify(results, null, 4));
