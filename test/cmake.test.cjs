const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { makeBuildPlan } = require("../out/XBuildPlan");
const { getBuildConfigurations } = require("../out/XConfigurations");
const { readCMakeModel, prepareCMakeQuery } = require("../out/XCMakeFileApi");
const { parseCMakeProject } = require("../out/XCMakeProject");
const { cmakeConfigurations } = require("../out/XCMakeIntelliSense");
const { buildExecutables } = require("../out/XBuildOutput");
const { validateCMakeCache } = require("../out/XCMakePlan");
const { validateKits } = require("../out/XKitSettings");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmake-qa-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const tool = name => { const file = path.join(root, name); fs.writeFileSync(file, "fixture"); return file; };
    const project = tool("CMakeLists.txt");
    const kit = { id: "kit", name: "CMake GCC 64-bit", qmakePath: "", compilerDirectory: root, makePath: tool("mingw32-make.exe"), cmakePath: tool("cmake.exe"), cmakeGenerator: "Ninja", cmakeMakePath: tool("ninja.exe"), cCompilerPath: tool("gcc.exe"), cxxCompilerPath: tool("g++.exe") };
    return { root, project, kit, tool };
}

test("CMake-only kits and configurations use CMake arguments, isolate mode/kit directories and reject cache or managed-option conflicts", t => {
    const { root, project, kit } = fixture(t);
    assert.equal(validateKits([kit])[0].qmakePath, "");
    const prefs = { configuration: "debug", buildSystem: "cmake" };
    const plan = makeBuildPlan(project, kit, prefs, root);
    const release = makeBuildPlan(project, kit, { ...prefs, configuration: "release" }, root);
    const other = makeBuildPlan(project, { ...kit, id: "other" }, prefs, root);
    assert.notEqual(plan.buildDirectory, root);
    assert.notEqual(plan.buildDirectory, release.buildDirectory);
    assert.notEqual(plan.buildDirectory, other.buildDirectory);
    assert(plan.qmakeArguments.includes("-DCMAKE_BUILD_TYPE=Debug"));
    assert(plan.makeArguments.includes("--parallel"));
    assert(!plan.makeArguments.some(arg => arg.startsWith("-j")));
    assert.equal(plan.environment.QTDIR, undefined);
    const profiles = getBuildConfigurations(prefs, kit);
    profiles.items[0].settings.qmakeArguments = "-DCMAKE_CXX_COMPILER=unrelated.exe";
    assert.throws(() => makeBuildPlan(project, kit, { ...prefs, buildProfiles: { kit: profiles } }, root), /키트 설정/);
    profiles.items[0].settings.qmakeArguments = "-D CMAKE_CXX_COMPILER=unrelated.exe";
    assert.throws(() => makeBuildPlan(project, kit, { ...prefs, buildProfiles: { kit: profiles } }, root), /키트 설정/);
    profiles.items[0].settings.qmakeArguments = "--toolchain unrelated.cmake";
    assert.throws(() => makeBuildPlan(project, kit, { ...prefs, buildProfiles: { kit: profiles } }, root), /키트 설정/);
    plan.buildDirectory = path.join(root, "cache-test");
    fs.mkdirSync(plan.buildDirectory, { recursive: true });
    fs.writeFileSync(path.join(plan.buildDirectory, "CMakeCache.txt"), `CMAKE_HOME_DIRECTORY:INTERNAL=${root}\nCMAKE_GENERATOR:INTERNAL=MinGW Makefiles\n`);
    assert.throws(() => validateCMakeCache(plan), /새 빌드 폴더/);
});

test("CMake File API follows the owned latest reply, exact executable targets, and per-source compile groups; opening never runs CMake", t => {
    const { root, project, kit, tool } = fixture(t);
    fs.writeFileSync(project, 'project(Qa)\nadd_subdirectory(child)\nexecute_process(COMMAND should_not_run)\n');
    fs.mkdirSync(path.join(root, "child")); fs.writeFileSync(path.join(root, "child/CMakeLists.txt"), "project(Child)");
    const source = tool("main.cpp");
    const header = tool("config.h");
    const plan = makeBuildPlan(project, kit, { configuration: "debug" }, root);
    plan.buildDirectory = path.join(root, "file-api-test");
    assert.equal(parseCMakeProject(project).children.length, 1);
    prepareCMakeQuery(plan.buildDirectory);
    const reply = path.join(plan.buildDirectory, ".cmake/api/v1/reply"); fs.mkdirSync(reply, { recursive: true });
    const json = (name, value) => fs.writeFileSync(path.join(reply, name), JSON.stringify(value));
    json("model.json", { paths: { source: root, build: plan.buildDirectory }, configurations: [{ name: "Debug", targets: [{ jsonFile: "app.json" }, { jsonFile: "lib.json" }] }] });
    json("app.json", { name: "App", type: "EXECUTABLE", paths: { source: ".", build: "." }, nameOnDisk: "App.exe", artifacts: [{ path: "custom/App.exe" }, { path: "custom/App.pdb" }], sources: [{ path: "main.cpp", compileGroupIndex: 0 }, { path: "config.h" }], compileGroups: [{ language: "CXX", includes: [{ path: root }], defines: [{ define: "QA=1" }], languageStandard: { standard: "20" } }] });
    json("lib.json", { name: "Lib", type: "SHARED_LIBRARY", artifacts: [{ path: "unrelated.dll" }] });
    json("tools.json", { toolchains: [{ language: "CXX", compiler: { path: kit.cxxCompilerPath } }] });
    json("files.json", { inputs: [{ path: "CMakeLists.txt" }] });
    json("index-001.json", { reply: { "client-qt-pro-workbench": { "codemodel-v2": { jsonFile: "model.json" }, "toolchains-v1": { jsonFile: "tools.json" }, "cmakeFiles-v1": { jsonFile: "files.json" } } } });
    assert.equal(readCMakeModel(plan.buildDirectory, "release", project), undefined);
    assert.deepEqual(buildExecutables(plan), [path.join(plan.buildDirectory, "custom/App.exe")]);
    const config = cmakeConfigurations(plan).get(source.toLowerCase());
    assert.equal(config.standard, "c++20"); assert.deepEqual(config.defines, ["QA=1"]);
    assert(cmakeConfigurations(plan).has(header.toLowerCase()));
    const parsed = parseCMakeProject(project, plan); assert(parsed.groups.get("Sources").includes(source));
    json("index-002.json", { reply: { "client-qt-pro-workbench": { "codemodel-v2": { jsonFile: "../outside.json" } } } });
    assert.throws(() => readCMakeModel(plan.buildDirectory, "debug", project), /응답 파일 경로/);
});
