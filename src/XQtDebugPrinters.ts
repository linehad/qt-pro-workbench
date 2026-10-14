import * as path from "node:path";
import { debugSupportDirectory } from "./XDebugRuntime";
import type { QtKit } from "./XProjectTypes";

interface DebugSetupCommand { description: string; text: string; ignoreFailures: boolean; }

export function qtDebugSetupCommands(kit: QtKit): DebugSetupCommand[] {
    const qtVersion = path.basename(path.dirname(path.dirname(path.dirname(kit.qmakePath))));
    if (qtVersion !== "4.8.1") { return []; }
    const directory = debugSupportDirectory().replaceAll("\\", "/");
    const literal = JSON.stringify(directory).replace(/[^\x20-\x7e]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    return [
        { description: "Use UTF-8 for debugger strings", text: "set charset UTF-8", ignoreFailures: false },
        { description: "Load Qt 4 value printers", text: `python import sys; sys.dont_write_bytecode = True; sys.path.insert(0, u${literal}); import XQt4Printers; XQt4Printers.register_printers()`, ignoreFailures: false }
    ];
}
