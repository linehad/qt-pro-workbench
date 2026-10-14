import * as fs from "node:fs";
import * as path from "node:path";
import { splitValues } from "./XQmakeText";

export interface ValueContext {
    variables: Map<string, string[]>;
    fileDirectory: string;
    projectDirectory: string;
}

function readVariable(name: string, context: ValueContext): string[] {
    if (name === "PWD") { return [context.fileDirectory]; }
    if (name === "_PRO_FILE_PWD_") { return [context.projectDirectory]; }
    return context.variables.get(name) ?? [`$${"$"}${name}`];
}

function matchFiles(pattern: string, isRecursive: boolean, context: ValueContext): string[] {
    const absolute = path.resolve(context.projectDirectory, pattern);
    const firstGlob = absolute.search(/[?*]/);
    if (firstGlob < 0) { return fs.existsSync(absolute) ? [absolute] : []; }
    const base = absolute.slice(0, absolute.lastIndexOf(path.sep, firstGlob));
    const wildcard = path.relative(base, absolute).replace(/\\/g, "/");
    const escaped = wildcard.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    const matcher = new RegExp(`^${escaped}$`, process.platform === "win32" ? "i" : "");
    const matches: string[] = [];
    let visited = 0;
    const walk = (directory: string, depth: number): void => {
        if (depth > 24 || visited > 20000) { return; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            visited += 1;
            const fullPath = path.join(directory, entry.name);
            const relative = path.relative(base, fullPath).replace(/\\/g, "/");
            const candidate = isRecursive && !wildcard.includes("/") ? entry.name : relative;
            if (entry.isFile() && matcher.test(candidate)) { matches.push(fullPath); }
            if (!entry.isDirectory()) { continue; }
            if (entry.name === ".git" || entry.name === "node_modules") { continue; }
            if (isRecursive || wildcard.includes("/")) { walk(fullPath, depth + 1); }
        }
    };
    walk(base, 0);
    return matches.sort();
}

function expandFunction(name: string, argumentsText: string, context: ValueContext): string[] | undefined {
    const parts = argumentsText.split(/,\s*/);
    const values = expandValues(parts[0] ?? "", context);
    if (name === "quote" || name === "clean_path") { return [values.join(" ")]; }
    if (name === "files") { return values.flatMap(value => matchFiles(value, parts[1] === "true", context)); }
    if (name === "absolute_path") {
        const base = expandValues(parts[1] ?? "$$PWD", context)[0] ?? context.fileDirectory;
        return values.map(value => path.resolve(base, value));
    }
    if (name === "first" || name === "last") {
        const valuesOfVariable = context.variables.get(parts[0]) ?? [];
        return name === "first" ? valuesOfVariable.slice(0, 1) : valuesOfVariable.slice(-1);
    }
    if (name === "unique") { return [...new Set(context.variables.get(parts[0]) ?? values)]; }
    return undefined;
}

function expandToken(token: string, context: ValueContext, depth = 0): string[] {
    if (depth > 12) { return [token]; }
    const fn = token.match(/^\$\$(\w+)\((.*)\)$/);
    if (fn) { return expandFunction(fn[1], fn[2], context) ?? [token]; }
    const environment = token.match(/\$\$\((\w+)\)/);
    if (environment) {
        const value = process.env[environment[1]];
        return value === undefined ? [token] : expandToken(token.replace(environment[0], value), context, depth + 1);
    }
    const variable = token.match(/\$\$(?:\{([\w.]+)\}|([\w.]+))/);
    if (!variable) { return [token.replace(/\\#/g, "#")]; }
    const replacement = readVariable(variable[1] ?? variable[2], context);
    if (replacement[0] === variable[0]) { return [token]; }
    return replacement.slice(0, 1024).flatMap(value => expandToken(token.replace(variable[0], value), context, depth + 1));
}

export function expandValues(value: string, context: ValueContext): string[] {
    return splitValues(value).flatMap(token => expandToken(token, context)).slice(0, 10000);
}
