export interface Bookmark {
    id: string;
    filePath: string;
    line: number;
    text: string;
    label?: string;
}

export type BookmarkNode = { kind: "file"; filePath: string } | { kind: "bookmark"; bookmark: Bookmark };

export interface BookmarkEdit {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    text: string;
}
