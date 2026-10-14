import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { QtKit } from "./XProjectTypes";

export function findCMakeTool(name: string): string | undefined {
    const directories = (process.env.PATH ?? "").split(path.delimiter);
    directories.push("C:/Program Files/CMake/bin", "C:/Strawberry/c/bin");
    try {
        for (const entry of fs.readdirSync("C:/Qt/Tools")) { directories.push(path.join("C:/Qt/Tools", entry, "bin")); }
    } catch { /* Qt Tools is optional. */ }
    return directories.map(directory => path.join(directory.replace(/^"|"$/g, ""), name)).find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}

export function discoverCMakeKits(): QtKit[] {
    const cmakePath = findCMakeTool("cmake.exe");
    if (!cmakePath) { return []; }
    const roots = ["C:/QtSDK/mingw/bin", "C:/Strawberry/c/bin"];
    try { roots.push(...fs.readdirSync("C:/Qt/Tools").filter(name => /mingw/i.test(name)).map(name => path.join("C:/Qt/Tools", name, "bin"))); }
    catch { /* Standalone CMake kits do not require Qt. */ }
    const ninja = findCMakeTool("ninja.exe");
    return roots.filter(directory => fs.existsSync(path.join(directory, "g++.exe"))).map(compilerDirectory => ({
        id: "cmake-" + crypto.createHash("sha256").update(path.resolve(compilerDirectory).toLowerCase()).digest("hex").slice(0, 12),
        name: `CMake / ${path.basename(path.dirname(compilerDirectory))}`,
        qmakePath: "", compilerDirectory, makePath: fs.existsSync(path.join(compilerDirectory, "mingw32-make.exe")) ? path.join(compilerDirectory, "mingw32-make.exe") : "", cmakePath,
        cmakeGenerator: ninja ? "Ninja" : "MinGW Makefiles", cmakeMakePath: ninja,
        cCompilerPath: path.join(compilerDirectory, "gcc.exe"), cxxCompilerPath: path.join(compilerDirectory, "g++.exe")
    }));
}
