import * as fs from "node:fs";
import type { Statement } from "./XQmakeTypes";

export function readText(filePath: string): string {
    const content = fs.readFileSync(filePath);
    if (content[0] === 0xff && content[1] === 0xfe) { return content.subarray(2).toString("utf16le"); }
    const utf8 = content.toString("utf8").replace(/^\uFEFF/, "");
    if (!utf8.includes("\uFFFD")) { return utf8; }
    return new TextDecoder("euc-kr").decode(content);
}

function stripComment(line: string): string {
    let quote = "";
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === "\\" && line[index + 1] === "#") { index += 1; continue; }
        if (quote) {
            if (character === quote) { quote = ""; }
            continue;
        }
        if (character === '"' || character === "'") { quote = character; }
        if (character === "#") { return line.slice(0, index); }
    }
    return line;
}

function logicalLines(content: string): string[] {
    const lines: string[] = [];
    let pending = "";
    for (const raw of content.split(/\r?\n/)) {
        if (raw.trimStart().startsWith("#")) { continue; }
        const line = stripComment(raw).trim();
        if (line.endsWith("\\")) { pending += `${line.slice(0, -1)} `; continue; }
        lines.push(pending + line);
        pending = "";
    }
    if (pending) { lines.push(pending); }
    return lines;
}

export function readStatements(content: string): Statement[] {
    const statements: Statement[] = [];
    const blocks: { id: number; expression: string; skip: boolean }[] = [];
    let scopeId = 0;
    let text = "";
    let quote = "";
    let parentheses = 0;
    let variableBrace = false;
    const flush = (): void => {
        if (blocks.some(block => block.skip)) { text = ""; return; }
        if (text.trim()) { statements.push({ text: text.trim(), isConditional: blocks.length > 0, scopes: blocks.map(({ id, expression }) => ({ id, expression })) }); }
        text = "";
    };
    for (const line of logicalLines(content)) {
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (quote) {
                text += character;
                if (character === quote) { quote = ""; }
                continue;
            }
            if (character === '"' || character === "'") { quote = character; text += character; continue; }
            if (character === "(") { parentheses += 1; }
            if (character === ")") { parentheses = Math.max(0, parentheses - 1); }
            if (character === "{" && text.endsWith("$$")) { variableBrace = true; text += character; continue; }
            if (character === "}" && variableBrace) { variableBrace = false; text += character; continue; }
            if (parentheses > 0 || variableBrace) { text += character; continue; }
            if (character === "{") {
                blocks.push({ id: scopeId++, expression: text.trim(), skip: /(?:defineTest|defineReplace|for)\s*\(/.test(text) });
                text = "";
                continue;
            }
            if (character === "}") { flush(); blocks.pop(); continue; }
            if (character === ";") { flush(); continue; }
            text += character;
        }
        flush();
    }
    return statements;
}

export function splitValues(value: string): string[] {
    const values: string[] = [];
    let current = "";
    let quote = "";
    let parentheses = 0;
    for (const character of value) {
        if (quote) {
            if (character === quote) { quote = ""; } else { current += character; }
            continue;
        }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (character === "(") { parentheses += 1; }
        if (character === ")") { parentheses -= 1; }
        if (/\s/.test(character) && parentheses === 0) {
            if (current) { values.push(current); current = ""; }
            continue;
        }
        current += character;
    }
    if (current) { values.push(current); }
    return values;
}
