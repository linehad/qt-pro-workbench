import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

let runtimeDirectory: string | undefined;

export function installDebugRuntime(extension: string, storage: string): string {
    const files = ["out/XDebugPipe.js", "out/XRunArguments.js", "media/debug/XQt4Printers.py", "media/debug/XQt4Values.py", "media/debug/XQt4Containers.py", "media/debug/InterruptProcess.ps1"];
    const payload = files.map(file => ({ name: path.basename(file), content: fs.readFileSync(path.join(extension, file)) }));
    const hash = createHash("sha256");
    for (const file of payload) { hash.update(file.name).update("\0").update(file.content); }
    const directory = path.join(storage, "debug-runtime", hash.digest("hex"));
    fs.mkdirSync(directory, { recursive: true });
    for (const file of payload) {
        const destination = path.join(directory, file.name);
        if (fs.existsSync(destination) && fs.readFileSync(destination).equals(file.content)) { continue; }
        fs.writeFileSync(destination, file.content);
    }
    // In-use helpers survive extension upgrades; different contents get a different directory.
    runtimeDirectory = directory;
    return directory;
}

export function debugPipePath(): string { return path.join(runtimeDirectory ?? __dirname, "XDebugPipe.js"); }
export function debugSupportDirectory(): string { return runtimeDirectory ?? path.resolve(__dirname, "../media/debug"); }
