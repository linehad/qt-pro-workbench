const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { moveBookmarks } = require("../out/XBookmarkPositions");
const { loadBookmarks, saveBookmarks } = require("../out/XBookmarkStore");

const bookmark = line => ({ id: `line-${line}`, filePath: path.resolve("test.cpp"), line, text: `line ${line}` });
const edit = (startLine, startColumn, endLine, endColumn, text) => ({ range: { start: { line: startLine, character: startColumn }, end: { line: endLine, character: endColumn } }, text });

test("bookmarks follow insertions, removals, CRLF and simultaneous edits in original document coordinates", () => {
    const original = [bookmark(2), bookmark(8), bookmark(12)];
    const changes = [edit(0, 0, 0, 0, "before\r\nmore\r\n"), edit(5, 0, 7, 0, ""), edit(10, 1, 10, 1, "\n")];
    assert.deepEqual(moveBookmarks(original, changes).map(item => item.line), [4, 8, 13]);
    assert.deepEqual(original.map(item => item.line), [2, 8, 12]);
    assert.equal(moveBookmarks([bookmark(3)], [edit(3, 0, 3, 0, "new\n")])[0].line, 4);
    assert.equal(moveBookmarks([bookmark(3)], [edit(3, 2, 3, 2, "\n")])[0].line, 3);
    assert.equal(moveBookmarks([bookmark(3)], [edit(3, 0, 3, 4, "replacement\n")])[0].line, 3);
});

test("removing a bookmarked line drops its bookmark but retains the following line's bookmark", () => {
    const moved = moveBookmarks([bookmark(3), bookmark(4), bookmark(5)], [edit(3, 0, 4, 0, "")]);
    assert.deepEqual(moved.map(item => [item.id, item.line]), [["line-4", 3], ["line-5", 4]]);
    const joined = moveBookmarks([bookmark(3), bookmark(4)], [edit(3, 4, 4, 0, "")]);
    assert.equal(joined.length, 1, "Joining bookmarked lines must not leave duplicate markers");
});

test("bookmarks persist outside projects and corrupt data is rejected instead of silently erased", () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "qt-bookmarks-"));
    const file = path.join(storage, "bookmarks.json");
    assert.deepEqual(loadBookmarks(storage), []);
    const marks = [{ ...bookmark(10), label: "Startup" }, bookmark(24)];
    saveBookmarks(storage, marks);
    assert.deepEqual(loadBookmarks(storage).map(item => ({ ...item, label: item.label })), marks.map(item => ({ ...item, label: item.label })));
    assert.equal(fs.readdirSync(storage).length, 1, "Atomic save must not leave temporary files");
    fs.writeFileSync(file, JSON.stringify({ version: 1, bookmarks: [bookmark(-1)] }));
    assert.throws(() => loadBookmarks(storage), /줄 번호/);
    fs.unlinkSync(file); fs.rmdirSync(storage);
});
