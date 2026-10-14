import type { Bookmark, BookmarkEdit } from "./XBookmarkTypes";

function moveLine(line: number, edit: BookmarkEdit): number | undefined {
    const { start, end } = edit.range;
    const inserted = (edit.text.match(/\n/g) ?? []).length;
    const removed = end.line - start.line;
    if (line < start.line) { return line; }
    if (line > end.line) { return line + inserted - removed; }
    if (line === end.line && line > start.line) { return start.line + inserted; }
    if (line === start.line) {
        if (start.character > 0) { return line; }
        if (!removed) { return end.character === 0 ? line + inserted : line; }
        return edit.text.length ? start.line : undefined;
    }
    return undefined;
}

export function moveBookmarks(bookmarks: Bookmark[], edits: readonly BookmarkEdit[]): Bookmark[] {
    // VS Code ranges refer to the document before the event; apply the last edit first.
    const ordered = [...edits].sort((left, right) => right.range.start.line - left.range.start.line || right.range.start.character - left.range.start.character);
    const occupied = new Set<number>();
    const moved: Bookmark[] = [];
    for (const bookmark of bookmarks) {
        let line: number | undefined = bookmark.line;
        for (const edit of ordered) {
            line = moveLine(line, edit);
            if (line === undefined) { break; }
        }
        if (line === undefined || occupied.has(line)) { continue; }
        occupied.add(line);
        moved.push({ ...bookmark, line });
    }
    return moved;
}
