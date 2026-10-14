import * as fs from "node:fs";
import * as path from "node:path";
import type { QtKit } from "./XProjectTypes";
import { parseRunArguments } from "./XRunArguments";

interface ExistingBuild {
    directory: string;
}

function canonical(value: string, directory: string): string {
    return path.resolve(directory, value.replace(/^"(.*)"$/, "$1")).toLowerCase();
}

function readMakefile(filePath: string): string {
    try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

function isMatchingMakefile(text: string, projectPath: string, kit: QtKit, directory: string): boolean {
    const project = text.match(/^# Project:\s*(.+)$/m)?.[1]?.trim();
    const qmake = text.match(/^QMAKE\s*=\s*(.+)$/m)?.[1]?.trim();
    if (!project || !qmake) { return false; }
    if (canonical(project, directory) !== canonical(projectPath, directory)) { return false; }
    return canonical(qmake, directory) === canonical(kit.qmakePath, directory);
}

export function selectedMakefile(directory: string, configuration: "debug" | "release"): string {
    const name = configuration === "debug" ? "Makefile.Debug" : "Makefile.Release";
    return fs.existsSync(path.join(directory, name)) ? name : "Makefile";
}

export function qmakeArgumentsMatch(directory: string, configuration: "debug" | "release", argumentsList: string[]): boolean {
    if (!argumentsList.length) { return true; }
    const text = readMakefile(path.join(directory, selectedMakefile(directory, configuration)));
    const command = text.match(/^# Command:\s*(.+)$/m)?.[1] ?? readMakefile(path.join(directory, "Makefile")).match(/^# Command:\s*(.+)$/m)?.[1];
    if (!command) { return false; }
    try {
        const values = parseRunArguments(command);
        let start = 0;
        for (const argument of argumentsList) {
            const index = values.indexOf(argument, start);
            if (index < 0) { return false; }
            start = index + 1;
        }
        return true;
    } catch { return false; }
}

function configurationMatches(text: string, configuration: "debug" | "release"): boolean {
    const flags = text.match(/^CXXFLAGS\s*=\s*(.+)$/m)?.[1] ?? "";
    const defines = text.match(/^DEFINES\s*=\s*(.+)$/m)?.[1] ?? "";
    if (/\bQT_NO_DEBUG\b/.test(defines)) { return configuration === "release"; }
    if (/(?:^|\s)-g(?:\s|$)/.test(flags)) { return configuration === "debug"; }
    if (/(?:^|\s)-O[0-9s](?:\s|$)/.test(flags)) { return configuration === "release"; }
    const command = text.match(/^# Command:\s*(.+)$/m)?.[1] ?? "";
    const modes = [...command.matchAll(/CONFIG\+=(debug|release)(?=\s|"|$)/g)];
    return modes.at(-1)?.[1] === configuration;
}

export function existingBuild(projectPath: string, kit: QtKit, configuration: "debug" | "release", candidates: string[]): ExistingBuild | undefined {
    for (const directory of candidates) {
        const name = selectedMakefile(directory, configuration);
        const text = readMakefile(path.join(directory, name));
        if (!isMatchingMakefile(text, projectPath, kit, directory)) { continue; }
        if (name === "Makefile" && !configurationMatches(text, configuration)) { continue; }
        return { directory };
    }
    return undefined;
}
