import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Bookmark } from "./XBookmarkTypes";

export function bookmarkFileIdentity(filePath: string): string {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function loadBookmarks(storagePath: string): Bookmark[] {
    const file = path.join(storagePath, "bookmarks.json");
    if (!fs.existsSync(file)) { return []; }
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (stored.version !== 1 || !Array.isArray(stored.bookmarks)) { throw new Error("북마크 저장 파일 형식이 잘못되었습니다."); }
    const ids = new Set<string>();
    const locations = new Set<string>();
    return stored.bookmarks.map((value: Bookmark) => {
        if (!value || typeof value !== "object") { throw new Error("북마크 항목을 확인하세요."); }
        if (typeof value.id !== "string" || !value.id) { throw new Error("북마크 ID를 확인하세요."); }
        if (typeof value.filePath !== "string" || !path.isAbsolute(value.filePath)) { throw new Error("북마크 파일 경로를 확인하세요."); }
        if (!Number.isInteger(value.line) || value.line < 0) { throw new Error("북마크 줄 번호를 확인하세요."); }
        if (typeof value.text !== "string") { throw new Error("북마크 내용을 확인하세요."); }
        if (value.label !== undefined && typeof value.label !== "string") { throw new Error("북마크 이름을 확인하세요."); }
        const location = JSON.stringify([bookmarkFileIdentity(value.filePath), value.line]);
        if (ids.has(value.id) || locations.has(location)) { throw new Error("중복된 북마크 항목이 있습니다."); }
        ids.add(value.id); locations.add(location);
        return { id: value.id, filePath: value.filePath, line: value.line, text: value.text, label: value.label };
    });
}

export function saveBookmarks(storagePath: string, bookmarks: Bookmark[]): void {
    fs.mkdirSync(storagePath, { recursive: true });
    const file = path.join(storagePath, "bookmarks.json");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, bookmarks }, null, 4), "utf8");
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) { fs.unlinkSync(temporary); }
    }
}
