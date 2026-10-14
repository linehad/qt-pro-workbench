const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discoverKits } = require("../out/XKitStore");
const { makeBuildPlan } = require("../out/XBuildPlan");
const { defaultExecutable } = require("../out/XBuildOutput");

const root = path.resolve(__dirname, "output-qa");
const source = path.join(root, "source");
fs.mkdirSync(source, { recursive: true });
fs.writeFileSync(path.join(source, "main.cpp"), "int main() { return 0; }\n");
const base = 'TEMPLATE = app\nTARGET = OutputSmoke\nCONFIG -= qt app_bundle\nCONFIG += console\nSOURCES += main.cpp\n';
const output = 'CONFIG(debug, debug|release): DESTDIR = $$PWD/../custom-output/debug\nCONFIG(release, debug|release): DESTDIR = $$PWD/../custom-output/release\n';
const results = [];
for (const kit of discoverKits()) {
    for (const configuration of ["debug", "release"]) {
        for (const custom of [true, false]) {
            const projectPath = path.join(source, custom ? "custom.pro" : "default.pro");
            fs.writeFileSync(projectPath, base + (custom ? output : ""));
            const plan = makeBuildPlan(projectPath, kit, { configuration }, path.join(root, "storage"));
            fs.mkdirSync(plan.buildDirectory, { recursive: true });
            const options = { cwd: plan.buildDirectory, env: plan.environment, encoding: "utf8", timeout: 90000, windowsHide: true };
            const qmake = spawnSync(kit.qmakePath, plan.qmakeArguments, options);
            assert.equal(qmake.status, 0, qmake.error?.message ?? qmake.stderr + qmake.stdout);
            const executable = defaultExecutable(plan);
            const expectedDirectory = custom ? path.join(root, "custom-output", configuration) : plan.outputDirectory;
            assert.equal(executable?.toLowerCase(), path.join(expectedDirectory, "OutputSmoke.exe").toLowerCase(), kit.name + " " + configuration);
            const make = spawnSync(kit.makePath, plan.makeArguments, options);
            assert.equal(make.status, 0, make.error?.message ?? make.stderr + make.stdout);
            const object = path.join(plan.buildDirectory, "obj/main.o");
            const objectTime = fs.statSync(object).mtimeMs;
            const exeTime = fs.statSync(executable).mtimeMs;
            const unchanged = spawnSync(kit.makePath, plan.makeArguments, options);
            assert.equal(unchanged.status, 0, unchanged.stderr);
            assert.equal(fs.statSync(object).mtimeMs, objectTime, "No-change make must not compile");
            assert.equal(fs.statSync(executable).mtimeMs, exeTime, "No-change make must not link");
            const run = spawnSync(executable, [], { ...options, cwd: path.dirname(executable) });
            assert.equal(run.status, 0, run.error?.message ?? run.stderr);
            results.push({ kit: kit.name, configuration, customOutput: custom, executable, unchangedBuildSkipped: true });
        }
    }
}
fs.writeFileSync(path.join(__dirname, "output-results.json"), JSON.stringify({ passed: true, results }, null, 4));
console.log(`Verified ${results.length} output/incremental-build cases.`);
