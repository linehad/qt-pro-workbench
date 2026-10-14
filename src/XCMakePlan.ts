import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getBuildSettings, applyBuildEnvironment } from "./XBuildSettings";
import { parseRunArguments } from "./XRunArguments";
import { findCMakeTool } from "./XCMakeTools";
import type { BuildPlan, ProjectPreferences, QtKit } from "./XProjectTypes";

function configureArguments(text: string): string[] {
    const args = parseRunArguments(text);
    const managed = /^-D(?:CMAKE_BUILD_TYPE|CMAKE_(?:C|CXX)_COMPILER|CMAKE_MAKE_PROGRAM|CMAKE_TOOLCHAIN_FILE|CMAKE_GENERATOR|CMAKE_HOME_DIRECTORY)(?::[^=]+)?=/i;
    const reserved = (arg: string): boolean => {
        if (/^-(?:S|B|G|A|T|C|P)/.test(arg)) { return true; }
        if (/^--(?:preset|toolchain|build|install|workflow|open)(?:=|$)/.test(arg)) { return true; }
        if (managed.test(arg)) { return true; }
        return !arg.startsWith("-") && args.indexOf(arg) === 0;
    };
    const definitions = args.map((arg, index) => arg === "-D" ? "-D" + (args[index + 1] ?? "") : arg);
    if (definitions.some(reserved)) {
        throw new Error("소스·빌드 폴더, 생성기, 컴파일러와 toolchain은 프로젝트/키트 설정에서 지정하세요. 추가 CMake 인수에는 -DNAME=value 등을 사용하세요.");
    }
    return args;
}

function cmakeMakeProgram(kit: QtKit, generator: string): string | undefined {
    if (kit.cmakeMakePath) { return kit.cmakeMakePath; }
    if (generator.includes("Ninja")) { return findCMakeTool("ninja.exe"); }
    if (generator === "MinGW Makefiles") { return kit.makePath; }
    return undefined;
}

export function makeCMakePlan(projectPath: string, kit: QtKit, preferences: ProjectPreferences, storagePath: string, environment: Record<string, string>): BuildPlan {
    const settings = getBuildSettings({ ...preferences, buildSystem: "cmake" }, kit);
    const projectDirectory = path.dirname(projectPath);
    const identity = crypto.createHash("sha256").update(JSON.stringify([path.resolve(storagePath).toLowerCase(), path.resolve(projectPath).toLowerCase(), kit.id])).digest("hex").slice(0, 16);
    const custom = settings.buildDirectory.replaceAll("${projectDir}", projectDirectory);
    // Keep generated compiler paths short enough for legacy Windows tools.
    const buildRoot = path.join(process.env.LOCALAPPDATA || storagePath, "QtProWorkbench", "cmake-builds");
    const buildDirectory = custom ? path.resolve(projectDirectory, custom) : path.join(buildRoot, identity, preferences.configuration);
    if (buildDirectory.toLowerCase() === projectDirectory.toLowerCase()) { throw new Error("CMake 빌드 폴더는 소스 폴더와 다른 경로를 지정하세요."); }
    const cmakePath = kit.cmakePath || findCMakeTool("cmake.exe");
    if (!cmakePath) { throw new Error("CMake를 설치하거나 키트 설정에서 cmake.exe 경로를 지정하세요."); }
    const generator = kit.cmakeGenerator || "MinGW Makefiles";
    const mode = preferences.configuration === "debug" ? "Debug" : "Release";
    const args = ["-S", projectDirectory, "-B", buildDirectory, "-G", generator, `-DCMAKE_BUILD_TYPE=${mode}`, "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"];
    const cxx = kit.cxxCompilerPath || path.join(kit.compilerDirectory, kit.debuggerType === "msvc" ? "cl.exe" : "g++.exe");
    const c = kit.cCompilerPath || path.join(kit.compilerDirectory, kit.debuggerType === "msvc" ? "cl.exe" : "gcc.exe");
    if (kit.cmakePlatform) { args.push("-A", kit.cmakePlatform); }
    if (kit.cmakeToolchainFile) { args.push(`-DCMAKE_TOOLCHAIN_FILE=${kit.cmakeToolchainFile}`); }
    else if (!generator.startsWith("Visual Studio")) { args.push(`-DCMAKE_C_COMPILER=${c}`, `-DCMAKE_CXX_COMPILER=${cxx}`); }
    const make = cmakeMakeProgram(kit, generator);
    if (make) { args.push(`-DCMAKE_MAKE_PROGRAM=${make}`); }
    if (kit.qmakePath) { args.push(`-DCMAKE_PREFIX_PATH=${path.dirname(path.dirname(kit.qmakePath))}`, `-DQT_QMAKE_EXECUTABLE=${kit.qmakePath}`); }
    args.push(...configureArguments(settings.qmakeArguments));
    const buildArgs = ["--build", buildDirectory, "--config", mode];
    const extraBuild = parseRunArguments(settings.makeArguments);
    const extraClean = parseRunArguments(settings.cleanArguments);
    for (const values of [extraBuild, extraClean]) {
        const isManaged = (value: string): boolean => ["--preset", "--build", "--config"].includes(value) || /^(?:--preset=|--build=|--config=)/.test(value);
        if (values.some(isManaged)) { throw new Error("CMake 빌드 폴더와 Debug/Release는 활성 빌드 구성에서 선택하세요."); }
    }
    return { projectPath, buildSystem: "cmake", configuration: preferences.configuration, buildDirectory, outputDirectory: buildDirectory, kit,
        qmakeArguments: args, makeArguments: [...buildArgs, ...extraBuild], cleanArguments: [...buildArgs, "--target", "clean", ...extraClean],
        cmakePath, environment: applyBuildEnvironment(environment, settings.environment) };
}

export function validateCMakeCache(plan: BuildPlan): void {
    const file = path.join(plan.buildDirectory, "CMakeCache.txt");
    if (!fs.existsSync(file)) { return; }
    const text = fs.readFileSync(file, "utf8");
    const cache = (name: string): string => text.match(new RegExp(`^${name}:[^=]*=(.*)$`, "m"))?.[1].trim() ?? "";
    const expected: Record<string, string> = { CMAKE_HOME_DIRECTORY: path.dirname(plan.projectPath), CMAKE_GENERATOR: plan.kit.cmakeGenerator || "MinGW Makefiles", CMAKE_GENERATOR_PLATFORM: plan.kit.cmakePlatform || "" };
    for (const argument of plan.qmakeArguments) {
        const match = argument.match(/^-D(CMAKE_(?:C|CXX)_COMPILER|CMAKE_TOOLCHAIN_FILE|CMAKE_MAKE_PROGRAM)=(.*)$/);
        if (match) { expected[match[1]] = match[2]; }
    }
    if (!plan.kit.cmakeToolchainFile && cache("CMAKE_TOOLCHAIN_FILE")) { throw new Error("기존 CMake 캐시에 다른 toolchain 파일이 있습니다. 새 빌드 폴더를 지정하세요."); }
    for (const [key, value] of Object.entries(expected)) {
        const normalize = (item: string): string => item.replaceAll("\\", "/").toLowerCase();
        if (cache(key) && normalize(cache(key)) !== normalize(value)) { throw new Error(`CMake 캐시의 ${key}가 선택한 키트와 다릅니다. 새 빌드 폴더를 지정하세요.`); }
    }
}
