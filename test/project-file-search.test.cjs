const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { findProjectFile } = require("../out/XProjectFileSearch");

test("file following keeps a shared file in its selected project and ignores unrelated folders", () => {
    const filePath = path.resolve("shared/Header.h");
    const roots = ["Alpha", "Beta"].map(label => ({ kind: "project", label, projectPath: path.resolve(label + ".pro") }));
    const branches = new Map();
    for (const root of roots) {
        const group = { ...root, kind: "group", label: "Headers", files: [filePath] };
        const unrelated = { ...root, kind: "group", label: "Sources", files: [path.resolve("not-current.cpp")] };
        branches.set(root, [unrelated, group]);
        branches.set(group, [{ ...root, kind: "file", label: "Header.h", filePath }]);
        branches.set(unrelated, []);
    }
    const children = node => { assert.notEqual(node.label, "Sources", "Unrelated folders should not be expanded"); return branches.get(node) ?? []; };
    assert.equal(findProjectFile(roots, children, filePath, roots[1]).projectPath, roots[1].projectPath);
    assert.equal(findProjectFile(roots, children, filePath, roots[0]).projectPath, roots[0].projectPath);
    assert.equal(findProjectFile(roots, () => [], path.resolve("missing.txt")), undefined);
});
