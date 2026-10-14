const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const userDirectory = path.join(process.env.APPDATA, "Code/User");
const readState = databasePath => {
    if (!fs.existsSync(databasePath)) { return undefined; }
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        const row = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get("personal.qt-pro-workbench");
        return row ? JSON.parse(row.value) : undefined;
    } finally { database.close(); }
};
const globalState = readState(path.join(userDirectory, "globalStorage/state.vscdb")) ?? {};
const workspaceStates = {};
const workspaceRoot = path.join(userDirectory, "workspaceStorage");
for (const directory of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) { continue; }
    const state = readState(path.join(workspaceRoot, directory.name, "state.vscdb"));
    if (state) { workspaceStates[directory.name] = state; }
}
const destination = path.join(userDirectory, "globalStorage/ynlim.qt-pro-workbench");
fs.mkdirSync(destination, { recursive: true });
const oldStorage = path.join(userDirectory, "globalStorage/personal.qt-pro-workbench");
if (fs.existsSync(oldStorage)) { fs.cpSync(oldStorage, destination, { recursive: true, force: false, errorOnExist: false }); }
fs.writeFileSync(path.join(destination, "publisher-migration.json"), JSON.stringify({ globalState, workspaceStates }, null, 4));
console.log(JSON.stringify({ globalKeys: Object.keys(globalState).length, workspaces: Object.keys(workspaceStates).length, destination }));
