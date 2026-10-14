const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { kitEnvironment } = require("../out/XBuildPlan");
const { discoverKits } = require("../out/XKitStore");
const report = JSON.parse(fs.readFileSync(path.join(__dirname, "project-settings-results.json")));
const kit = discoverKits().find(item => item.name.startsWith("Qt 4.8.1"));
const directory = path.join(report.fixture, "deploy/release");
const executable = path.join(directory, "WorkbenchSmoke.exe");
for (const mode of ["inherit", "space", "equals"]) {
    const env = kitEnvironment(kit); delete env.RUN_CHECK;
    if (mode === "inherit") { env.RUN_CHECK = "probe"; }
    const command = mode === "space" ? "set env RUN_CHECK probe" : "set env RUN_CHECK=probe";
    const args = ["--batch", "-nx", "-ex", command, "-ex", "show env RUN_CHECK", "-ex", "run", executable];
    const run = spawnSync("C:/QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe", args, { cwd: directory, env, encoding: "utf8", windowsHide: true, timeout: 15000 });
    console.log(JSON.stringify({ mode, status: run.status, result: fs.readFileSync(path.join(directory, "run-result.txt"), "utf8"), output: run.stdout.slice(-1000), error: run.stderr.slice(-300) }));
}
