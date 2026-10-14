const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { folderChildren, projectNodeId } = require("../out/XProjectFolders");

function group(files, label = "Headers") {
    const projectPath = path.resolve("F:/projects/App/App.pro");
    return { kind: "group", label, groupName: label, projectPath, files: files.map(file => path.resolve(path.dirname(projectPath), file)), ancestors: [projectPath] };
}

function flatten(node, visited = new Set()) {
    const id = projectNodeId(node);
    assert(!visited.has(id), "Tree item IDs must be unique, including repeated folder and file names");
    visited.add(id);
    if (node.kind === "file") { return [node.filePath]; }
    return folderChildren(node).flatMap(child => flatten(child, visited));
}

test("groups retain nested folders and sort folders before files", () => {
    const root = group(["root.h", "Common/DBus/shared.h", "Common/DBus/Types/value.h", "Common/file10.h", "Common/file2.h", "UI/DBus/shared.h"]);
    const children = folderChildren(root);
    assert.deepEqual(children.map(node => [node.kind, node.label]), [["folder", "Common"], ["folder", path.join("UI", "DBus")], ["file", "root.h"]]);
    const common = folderChildren(children[0]);
    assert.deepEqual(common.map(node => node.label), ["DBus", "file2.h", "file10.h"]);
    const dbus = folderChildren(common[0]);
    assert.deepEqual(dbus.map(node => node.label), ["Types", "shared.h"]);
    assert.equal(children[0].files.length, 4);
    assert.deepEqual(flatten(root).sort(), [...root.files].sort());
    assert.deepEqual(flatten(root).sort(), [...root.files].sort(), "Refreshing produces the same tree");
});

test("external files share the parent folder shown by Qt Creator", () => {
    const root = group(["../Firmware_Library/XSystem.h", "../Firmware_Library/network/XNetwork.h", "../../shared/common.h", "../parent.h"]);
    const children = folderChildren(root);
    assert.deepEqual(children.map(node => node.label), [".."]);
    assert.deepEqual(folderChildren(children[0]).map(node => node.label), [path.join("..", "shared"), "Firmware_Library", "parent.h"]);
    assert.deepEqual(flatten(root).sort(), [...root.files].sort());
});

test("same paths in separate file groups or subproject branches have distinct IDs", () => {
    const headers = group(["Common/shared.h"]);
    const sources = group(["Common/shared.h"], "Sources");
    const headerFolder = folderChildren(headers)[0];
    const sourceFolder = folderChildren(sources)[0];
    assert.notEqual(projectNodeId(headerFolder), projectNodeId(sourceFolder));
    assert.notEqual(projectNodeId(folderChildren(headerFolder)[0]), projectNodeId(folderChildren(sourceFolder)[0]));
    assert.notEqual(projectNodeId(headerFolder), projectNodeId({ ...headerFolder, ancestors: ["other.pro", headers.projectPath] }));
});

test("files on another Windows drive keep their root and terminate normally", { skip: process.platform !== "win32" }, () => {
    const root = group(["C:/Qt/include/QtCore/qglobal.h", "C:/Qt/include/QtGui/qimage.h", "root.h"]);
    const children = folderChildren(root);
    assert.equal(children[0].label, "C:\\Qt\\include");
    assert.deepEqual(flatten(root).sort(), [...root.files].sort());
});

test("single external path is compacted while its branching directory is retained", () => {
    const root = group(["local.h", "../DBCommon/XHydraDB.h", "../DBCommon/XHydraDBCommon.h", "../DBCommon/System/XSystemLogDB.h", "../DBCommon/System/Table/XSystemLogDBTable.h"]);
    root.inactiveFiles = new Set(root.files.filter(file => file.includes("DBCommon")));
    const children = folderChildren(root);
    assert.deepEqual(children.map(node => node.label), [path.join("..", "DBCommon"), "local.h"]);
    const db = folderChildren(children[0]);
    assert.deepEqual(db.map(node => node.label), ["System", "XHydraDB.h", "XHydraDBCommon.h"]);
    assert(db.find(node => node.label === "XHydraDB.h").isInactive);
    assert.equal(children[1].isInactive, false);
    assert.deepEqual(flatten(root).sort(), [...root.files].sort());
});
