import { isUtf8 } from "node:buffer";
import * as iconv from "iconv-lite";

function encodingLabel(encoding: string): string {
    const aliases: Record<string, string> = { utf8: "utf-8", utf8bom: "utf-8", utf16le: "utf-16le", utf16be: "utf-16be", euckr: "euc-kr", cp949: "euc-kr", cp932: "shift_jis" };
    const label = encoding.toLowerCase();
    return aliases[label] ?? label.replace(/^windows(\d+)$/, "windows-$1").replace(/^iso8859(\d+)$/, "iso-8859-$1");
}

function unicodeEncoding(content: Buffer): string | undefined {
    if (content.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) { return "utf8"; }
    if (content.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) { return "utf16le"; }
    if (content.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) { return "utf16be"; }
    // Source files contain ASCII syntax; alternating zero bytes identify BOM-less UTF-16.
    const length = Math.min(content.length, 4096);
    let evenZeros = 0;
    let oddZeros = 0;
    for (let index = 0; index < length; ++index) {
        if (content[index] !== 0) { continue; }
        if (index % 2) { ++oddZeros; } else { ++evenZeros; }
    }
    if (length >= 4 && content.length % 2 === 0) {
        if (oddZeros > length / 5 && evenZeros < length / 20) { return "utf16le"; }
        if (evenZeros > length / 5 && oddZeros < length / 20) { return "utf16be"; }
    }
    if (isUtf8(content)) { return "utf8"; }
    return undefined;
}

export function detectGitEncoding(content: Buffer, preferred = "utf8"): string {
    const unicode = unicodeEncoding(content);
    if (unicode) { return unicode; }
    const label = encodingLabel(preferred);
    if (label !== "utf-8") { return preferred; }
    // A UTF-8 default is not evidence that legacy Korean source bytes are UTF-8.
    const text = iconv.decode(content, "cp949");
    if (iconv.encode(text, "cp949").equals(content) && /\p{Script=Hangul}/u.test(text)) { return "euckr"; }
    return preferred;
}

export function decodeGitContent(content: Buffer, encoding: string): string {
    return iconv.decode(content, encodingLabel(detectGitEncoding(content, encoding)));
}
