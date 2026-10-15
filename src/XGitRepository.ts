import * as path from "node:path";
import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { decodeGitContent } from "./XGitEncoding";
import type { GitCommit, GitHistoryPage, GitRevision } from "./XGitTypes";

export { decodeGitContent } from "./XGitEncoding";

export function gitRelativePath(root: string, file: string): string {
    const relative = path.relative(root, file);
    if (!relative || path.isAbsolute(relative)) { throw new Error("저장소 내부 파일을 지정하세요."); }
    if (relative.split(path.sep).includes("..")) { throw new Error("파일이 지정한 Git 저장소 밖에 있습니다."); }
    return relative.split(path.sep).join("/");
}

function parseGitHistory(text: string, selectedPath?: string): GitCommit[] {
    const values = text.split("\0");
    const commits: GitCommit[] = [];
    let index = 0;
    while (index < values.length) {
        if (values[index] !== "") { ++index; continue; }
        const hash = values[++index];
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash ?? "")) { continue; }
        const parents = values[++index].split(" ").filter(Boolean);
        const date = values[++index];
        const author = values[++index];
        const subject = values[++index];
        const commit: GitCommit = { hash, parents, date, author, subject };
        ++index;
        while (index < values.length && values[index] !== "") {
            const change = values[index++].trim();
            const first = values[index++];
            const current = /^[RC]\d+$/.test(change) ? values[index++] : first;
            const matches = selectedPath === first || selectedPath === current;
            if (selectedPath && !matches) { continue; }
            commit.previousPath = first; commit.filePath = current;
            commit.change = change;
            (commit.changes ??= []).push({ previousPath: first, filePath: current, change });
        }
        commits.push(commit);
    }
    return commits;
}

export class TXGitRepository {
    private readonly executable: string;

    private run(directory: string, args: string[]): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            execFile(this.executable, ["--no-optional-locks", "--literal-pathspecs", "-C", directory, "-c", "core.quotepath=false", "-c", "i18n.logOutputEncoding=utf-8", ...args], { encoding: "buffer", windowsHide: true, timeout: 20000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
                if (error) { reject(new Error(`Git 이력을 읽을 수 없습니다: ${stderr.toString("utf8").trim() || error.message}`)); return; }
                resolve(stdout);
            });
        });
    }

    public constructor(executable = "git") { this.executable = executable; }

    public async root(file: string): Promise<string> {
        if (!path.isAbsolute(file)) { throw new Error("Git 이력을 볼 파일의 절대 경로를 지정하세요."); }
        const directory = fs.existsSync(file) && fs.statSync(file).isDirectory() ? file : path.dirname(file);
        const root = (await this.run(directory, ["rev-parse", "--show-toplevel"])).toString("utf8").trim();
        return path.resolve(root);
    }

    public async history(file: string, fileOnly = true, skip = 0, limit = 100): Promise<GitHistoryPage> {
        if (fileOnly && fs.existsSync(file)) {
            if (fs.statSync(file).isDirectory()) { return this.directoryHistory(file, skip, limit); }
        }
        const repositoryRoot = await this.root(file);
        const relative = gitRelativePath(repositoryRoot, file);
        // Git --skip combined with --follow can repeat rename commits; page the followed result.
        const args = ["log", "-z", "--format=%x00%H%x00%P%x00%aI%x00%an%x00%s", `--max-count=${skip + limit + 1}`];
        if (fileOnly) { args.push("--follow", "--name-status", "--", relative); }
        else { args.push("--all"); }
        let commits: GitCommit[];
        try { commits = parseGitHistory((await this.run(repositoryRoot, args)).toString("utf8")).slice(skip); }
        catch (error) {
            if (!String(error).includes("does not have any commits yet")) { throw error; }
            commits = [];
        }
        return { repositoryRoot, filePath: fileOnly ? relative : undefined, commits: commits.slice(0, limit), nextSkip: skip + Math.min(commits.length, limit), hasMore: commits.length > limit };
    }

    public async directoryHistory(directory: string, skip = 0, limit = 100): Promise<GitHistoryPage> {
        const repositoryRoot = await this.root(directory);
        const relative = path.relative(repositoryRoot, directory) === "" ? "." : gitRelativePath(repositoryRoot, directory);
        const args = ["log", "--name-status", "--find-renames", "-z", "--format=%x00%H%x00%P%x00%aI%x00%an%x00%s", `--max-count=${skip + limit + 1}`, "--", relative];
        let commits: GitCommit[];
        try { commits = parseGitHistory((await this.run(repositoryRoot, args)).toString("utf8")).slice(skip); }
        catch (error) {
            if (!String(error).includes("does not have any commits yet")) { throw error; }
            commits = [];
        }
        return { repositoryRoot, directoryPath: relative, commits: commits.slice(0, limit), nextSkip: skip + Math.min(commits.length, limit), hasMore: commits.length > limit };
    }

    public async latest(file: string, encoding: string): Promise<GitRevision> {
        const repositoryRoot = await this.root(file);
        const filePath = gitRelativePath(repositoryRoot, file);
        const hash = (await this.run(repositoryRoot, ["rev-parse", "--verify", "HEAD"])).toString("utf8").trim();
        const entry = await this.run(repositoryRoot, ["ls-tree", "-z", hash, "--", filePath]);
        return { repositoryRoot, filePath, hash, encoding, empty: !entry.length };
    }

    public async revision(info: GitRevision): Promise<string> {
        if (info.empty) { return ""; }
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(info.hash)) { throw new Error("이력 목록에 있는 전체 커밋 해시를 지정하세요."); }
        const file = path.resolve(info.repositoryRoot, info.filePath);
        const relative = gitRelativePath(info.repositoryRoot, file);
        const content = await this.run(info.repositoryRoot, ["cat-file", "blob", `${info.hash}:${relative}`]);
        return decodeGitContent(content, info.encoding);
    }

    public async commit(file: string, hash: string, historicalPath?: string): Promise<{ repositoryRoot: string; commit: GitCommit }> {
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) { throw new Error("이력 목록에 있는 전체 커밋 해시를 지정하세요."); }
        const repositoryRoot = await this.root(file);
        const selectedPath = historicalPath ?? gitRelativePath(repositoryRoot, file);
        gitRelativePath(repositoryRoot, path.resolve(repositoryRoot, selectedPath));
        const text = await this.run(repositoryRoot, ["show", "--name-status", "--find-renames", "--no-ext-diff", "-z", "--format=%x00%H%x00%P%x00%aI%x00%an%x00%s", hash]);
        const commit = parseGitHistory(text.toString("utf8"), selectedPath)[0];
        if (!commit?.filePath) { throw new Error("이 커밋에는 지정한 파일의 변경이 없습니다."); }
        return { repositoryRoot, commit };
    }

    public async message(root: string, hash: string): Promise<string> {
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) { throw new Error("이력 목록에 있는 전체 커밋 해시를 지정하세요."); }
        return (await this.run(root, ["log", "-1", "--format=%B", hash])).toString("utf8").trimEnd();
    }
}
