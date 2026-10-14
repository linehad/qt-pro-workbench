import * as fs from "node:fs";
import { CONTROL_OPERATIONS, validateToolArguments } from "./XControlCatalog";
import { callLocalControl, listControlInstances, readControlDescriptor } from "./XLocalControlClient";
import { controlString } from "./XControlValidation";
import type { ControlRequest } from "./XControlTypes";

export async function executeControlRequest(request: ControlRequest): Promise<unknown> {
    if (request.operation === "help") { return { version: 1, operations: CONTROL_OPERATIONS }; }
    const operation = CONTROL_OPERATIONS.find(item => item.name === request.operation);
    if (!operation) { throw new Error("Unknown Qt Pro control operation. Use -Operation help."); }
    const args = request.arguments ?? {};
    validateToolArguments(operation.inputSchema, args);
    if (operation.name === "qt_list_instances") { return listControlInstances(); }
    return callLocalControl(readControlDescriptor(controlString(args, "instanceId")), request);
}

async function run(): Promise<void> {
    const started = Date.now();
    try {
        const bytes = fs.readFileSync(0);
        if (bytes.length > 1024 * 1024) { throw new Error("Control request too large"); }
        const result = await executeControlRequest(JSON.parse(bytes.toString("utf8")));
        process.stdout.write(JSON.stringify({ ok: true, result, elapsedMs: Date.now() - started }) + "\n");
    } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, error: (error as Error).message, elapsedMs: Date.now() - started }) + "\n");
        process.exitCode = 1;
    }
}

if (require.main === module) { void run(); }
