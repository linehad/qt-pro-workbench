import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { controlDirectory } from "./XLocalControlClient";

export function installControlCli(extensionPath: string): string {
    const directory = path.join(path.dirname(controlDirectory()), "control-api");
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ["XControlCli.js", "XControlCatalog.js", "XControlValidation.js", "XLocalControlClient.js"]) {
        fs.copyFileSync(path.join(extensionPath, "out", name), path.join(directory, name));
    }
    fs.copyFileSync(path.join(extensionPath, "media", "control", "QtControl.ps1"), path.join(directory, "QtControl.ps1"));
    fs.writeFileSync(path.join(directory, "runtime.json"), JSON.stringify({ executable: process.execPath }), "utf8");
    fs.copyFileSync(path.join(extensionPath, "CODEX-CONTROL.md"), path.join(directory, "CODEX-CONTROL.md"));
    return path.join(directory, "QtControl.ps1");
}

function copySkillResources(source: string, directory: string): void {
    fs.mkdirSync(directory, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) { copySkillResources(path.join(source, entry.name), target); continue; }
        if (!entry.isFile()) { throw new Error(`스킬 리소스는 파일 또는 폴더여야 합니다: ${entry.name}`); }
        // User-customized UI metadata and invocation policy survive managed instruction updates.
        if (entry.name === "openai.yaml" && fs.existsSync(target)) { continue; }
        fs.copyFileSync(path.join(source, entry.name), target);
    }
}

function previousManagedSkills(codexDirectory: string): string[] {
    const root = path.resolve(codexDirectory, "skills");
    return ["qt-pro-control", "vscode-control"].map(name => path.join(root, name)).filter(directory => {
        if (path.dirname(directory) !== root || !fs.existsSync(directory)) { return false; }
        if (fs.lstatSync(directory).isSymbolicLink()) { return false; }
        const file = path.join(directory, "SKILL.md");
        if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) { return false; }
        return fs.readFileSync(file, "utf8").includes("<!-- Managed by Qt Pro Workbench control API v1. -->");
    });
}

function archivePreviousSkills(codexDirectory: string, directories: string[]): void {
    if (!directories.length) { return; }
    const root = path.resolve(codexDirectory, "skills");
    const backup = path.resolve(codexDirectory, "skill-backups", `vscode-qt-control-${randomUUID()}`);
    fs.mkdirSync(backup, { recursive: true });
    for (const directory of directories) {
        // Archive only verified managed folders directly beneath the personal skill root.
        if (path.dirname(path.resolve(directory)) !== root) { throw new Error("이전 스킬 경로가 개인 스킬 폴더 밖에 있습니다."); }
        const target = path.join(backup, path.basename(directory));
        if (path.dirname(target) !== backup) { throw new Error("스킬 백업 경로가 잘못되었습니다."); }
        fs.renameSync(directory, target);
    }
}

export function installControlSkill(extensionPath: string): string {
    const codexDirectory = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    const directory = path.join(codexDirectory, "skills", "vscode-qt-control");
    const target = path.join(directory, "SKILL.md");
    if (fs.existsSync(target)) {
        const existing = fs.readFileSync(target, "utf8");
        if (!existing.includes("<!-- Managed by Qt Pro Workbench control API v1. -->")) { throw new Error(`동명의 사용자 스킬은 덮어쓰지 않습니다: ${target}`); }
    }
    const legacy = previousManagedSkills(codexDirectory);
    const metadata = path.join(directory, "agents/openai.yaml");
    const hadMetadata = fs.existsSync(metadata);
    const wasExplicitOnly = legacy.some(source => {
        const file = path.join(source, "agents/openai.yaml");
        return fs.existsSync(file) && /^\s*allow_implicit_invocation:\s*false\s*(?:#.*)?$/m.test(fs.readFileSync(file, "utf8"));
    });
    copySkillResources(path.join(extensionPath, "media", "control", "skill"), directory);
    if (!hadMetadata && wasExplicitOnly) { fs.writeFileSync(metadata, fs.readFileSync(metadata, "utf8").replace("allow_implicit_invocation: true", "allow_implicit_invocation: false"), "utf8"); }
    archivePreviousSkills(codexDirectory, legacy);
    return target;
}
