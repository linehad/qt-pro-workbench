const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { importPublisherSettings } = require("../out/XPublisherMigration");

test("publisher migration restores preferences and each workspace once without overwriting new choices", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-publisher-"));
    const state = values => ({ get: key => values[key], update: async (key, value) => { values[key] = value; } });
    const globalValues = { recentProjects: ["new.pro"] };
    const workspaceValues = {};
    const context = { globalStorageUri: { fsPath: root }, storageUri: { fsPath: path.join(root, "workspace-a/ynlim.qt-pro-workbench") }, globalState: state(globalValues), workspaceState: state(workspaceValues) };
    await importPublisherSettings(context);
    fs.writeFileSync(path.join(root, "publisher-migration.json"), JSON.stringify({ globalState: { recentProjects: ["old.pro"], "project:old.pro": { configuration: "release", kitId: "old-kit" } }, workspaceStates: { "workspace-a": { projects: ["old.pro"], activeProject: "old.pro" } } }));
    await importPublisherSettings(context);
    assert.deepEqual(globalValues.recentProjects, ["new.pro"]);
    assert.equal(globalValues["project:old.pro"].kitId, "old-kit");
    assert.equal(workspaceValues.activeProject, "old.pro");
    delete workspaceValues.activeProject;
    await importPublisherSettings(context);
    assert.equal(workspaceValues.activeProject, undefined);
    // Only files created by this test are removed; no recursive directory deletion.
    fs.unlinkSync(path.join(root, "publisher-migration.json"));
    fs.rmdirSync(root);
});
