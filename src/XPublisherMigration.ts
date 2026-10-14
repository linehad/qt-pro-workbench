import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";

interface PublisherMigration {
    globalState: Record<string, unknown>;
    workspaceStates: Record<string, Record<string, unknown>>;
}

async function importState(state: vscode.Memento, values: Record<string, unknown>): Promise<void> {
    if (state.get("publisherMigrationComplete")) { return; }
    for (const [key, value] of Object.entries(values)) {
        if (state.get(key) === undefined) { await state.update(key, value); }
    }
    await state.update("publisherMigrationComplete", true);
}

export async function importPublisherSettings(context: vscode.ExtensionContext): Promise<void> {
    const migrationPath = path.join(context.globalStorageUri.fsPath, "publisher-migration.json");
    if (!fs.existsSync(migrationPath)) { return; }
    const migration = JSON.parse(fs.readFileSync(migrationPath, "utf8")) as PublisherMigration;
    await importState(context.globalState, migration.globalState);
    if (!context.storageUri) { return; }
    const workspaceId = path.basename(path.dirname(context.storageUri.fsPath));
    const workspaceState = migration.workspaceStates[workspaceId];
    if (workspaceState) { await importState(context.workspaceState, workspaceState); }
}
