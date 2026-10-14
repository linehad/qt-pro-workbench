import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { BuildPlan } from "./XProjectTypes";
import type { DeployStep } from "./XConfigurationTypes";

interface CopyEntry {
    source: string;
    target: string;
    directory: boolean;
}

export function resolveDeployPath(value: string, plan: BuildPlan, executable?: string): string {
    const variables: Record<string, string | undefined> = {
        projectDir: path.dirname(plan.projectPath), buildDir: plan.buildDirectory,
        configuration: plan.configuration, executable, outputDir: executable ? path.dirname(executable) : undefined
    };
    const resolved = value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        if (!variables[name]) { throw new Error(`배포 경로의 변수 값을 확인하세요: ${name}. 실행 파일이 여러 개면 경로를 직접 지정하세요.`); }
        return variables[name]!;
    });
    return path.resolve(path.dirname(plan.projectPath), resolved);
}

async function optionalStat(file: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
    try { return await fs.lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; } throw error; }
}

function identity(file: string): string { return process.platform === "win32" ? file.toLowerCase() : file; }

async function validateTarget(target: string, directory: boolean): Promise<void> {
    let current = target;
    let first = true;
    while (true) {
        const entry = await optionalStat(current);
        if (entry) {
            if (entry.isSymbolicLink()) { throw new Error(`배포 대상에 링크를 사용할 수 없습니다: ${current}`); }
            const shouldBeDirectory = first ? directory : true;
            if (entry.isDirectory() !== shouldBeDirectory) { throw new Error(`배포 대상의 파일·폴더 종류가 다릅니다: ${current}`); }
        }
        const parent = path.dirname(current);
        if (parent === current) { return; }
        current = parent; first = false;
    }
}

async function preflight(steps: DeployStep[], plan: BuildPlan, executable?: string): Promise<CopyEntry[]> {
    const entries = new Map<string, CopyEntry>();
    const collect = async (source: string, target: string): Promise<void> => {
        const entry = await fs.lstat(source);
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) { throw new Error(`배포 원본은 일반 파일·폴더여야 합니다: ${source}`); }
        const directory = entry.isDirectory();
        const previous = entries.get(identity(target));
        if (previous && identity(previous.source) !== identity(source)) { throw new Error(`배포 대상이 중복됩니다: ${target}`); }
        await validateTarget(target, directory);
        entries.set(identity(target), { source, target, directory });
        if (directory) {
            for (const name of await fs.readdir(source)) { await collect(path.join(source, name), path.join(target, name)); }
        }
    };
    for (const step of steps) {
        const source = resolveDeployPath(step.source, plan, executable);
        const destination = resolveDeployPath(step.destination, plan, executable);
        const target = path.join(destination, path.basename(source));
        const sourceEntry = await optionalStat(source);
        if (!sourceEntry) { throw new Error(`배포 원본을 찾을 수 없습니다: ${source}`); }
        if (sourceEntry.isDirectory()) {
            const relative = path.relative(identity(source), identity(target));
            if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) { throw new Error(`원본 폴더 안으로 배포할 수 없습니다: ${target}`); }
        }
        await collect(source, target);
    }
    for (const entry of entries.values()) {
        let parent = path.dirname(entry.target);
        while (parent !== path.dirname(parent)) {
            const planned = entries.get(identity(parent));
            if (planned && !planned.directory) { throw new Error(`배포 파일과 폴더가 충돌합니다: ${parent}`); }
            parent = path.dirname(parent);
        }
    }
    return [...entries.values()];
}

async function fileHash(file: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(file)) { hash.update(bytes); }
    return hash.digest("hex");
}

export async function deployFiles(steps: DeployStep[], plan: BuildPlan, executable?: string, report: (message: string) => void = () => {}): Promise<{ copied: number; unchanged: number }> {
    const entries = await preflight(steps, plan, executable);
    let copied = 0;
    let unchanged = 0;
    for (const entry of entries) {
        if (entry.directory) { await fs.mkdir(entry.target, { recursive: true }); continue; }
        const targetEntry = await optionalStat(entry.target);
        const sourceEntry = await fs.stat(entry.source);
        if (identity(entry.source) === identity(entry.target) || (targetEntry?.size === sourceEntry.size && await fileHash(entry.source) === await fileHash(entry.target))) {
            unchanged++; continue;
        }
        await fs.mkdir(path.dirname(entry.target), { recursive: true });
        try { await fs.copyFile(entry.source, entry.target); }
        catch (error) { throw new Error(`배포 파일 복사 실패: ${entry.target}\n${(error as Error).message}`); }
        copied++; report(`${entry.source} → ${entry.target}`);
    }
    return { copied, unchanged };
}
