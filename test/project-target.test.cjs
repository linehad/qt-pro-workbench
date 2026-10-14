const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { projectPathForTarget, rootProjectForPath } = require("../out/XProjectTarget");
const manifest = require("../package.json");

test("clicked .pro path takes precedence over its enclosing project and active-project fallback", () => {
    const parent = path.resolve("projects/mother.pro");
    const child = path.resolve("projects/child/child.pro");
    assert.equal(projectPathForTarget({ kind: "file", projectPath: parent, filePath: child }), child);
    assert.equal(projectPathForTarget({ kind: "file", projectPath: parent, filePath: parent }), parent);
    assert.equal(projectPathForTarget({ scheme: "file", fsPath: child }), child);
    assert.equal(projectPathForTarget(), undefined);
    assert.throws(() => projectPathForTarget({ scheme: "file", fsPath: "settings.pri" }), /\.pro/);
    assert.throws(() => projectPathForTarget({ scheme: "https", fsPath: child }), /로컬/);
});

test("toolbar Run and F5 resolve a child to its opened root without confusing independent projects", () => {
    const mother = path.resolve("projects/mother.pro");
    const child = path.resolve("projects/child/child.pro");
    const other = path.resolve("other/other.pro");
    const graph = new Map([[mother, [child]], [child, [mother]], [other, []]]);
    const children = project => graph.get(project) ?? [];
    assert.equal(rootProjectForPath(child, [mother, other], children), mother);
    assert.equal(rootProjectForPath(other, [mother, other], children), other);
    assert.equal(rootProjectForPath(child, [child], children), child);
});

test("build actions appear on .pro file menus, not project folder rows", () => {
    for (const command of ["qtPro.build", "qtPro.qmake", "qtPro.clean", "qtPro.rebuild"]) {
        const tree = manifest.contributes.menus["view/item/context"].filter(item => item.command === command);
        assert.equal(tree.length, 1);
        assert.equal(tree[0].when, "view == qtProProjects && viewItem == qtProProjectFile");
        for (const menu of ["explorer/context", "editor/title/context"]) {
            const entry = manifest.contributes.menus[menu].find(item => item.command === command);
            assert(entry?.when.includes("resourceExtname == .pro"));
            assert(entry?.when.includes("resourceScheme == file"));
        }
    }
});
