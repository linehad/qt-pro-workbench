import * as fs from "node:fs";
import * as path from "node:path";
import type { CMakeModel, CMakeTarget } from "./XCMakeTypes";

const CLIENT = "client-qt-pro-workbench";

interface ReplyReference { jsonFile?: string; }
interface ReplyIndex { reply?: Record<string, Record<string, ReplyReference>>; }
interface CodeModelReply { paths: { source: string; build: string }; configurations: { name: string; targets: { jsonFile: string }[] }[]; }
interface CMakeFilesReply { inputs: { path: string; isGenerated?: boolean; isCMake?: boolean }[]; }
interface ToolchainsReply { toolchains: { language: string; compiler?: { path?: string } }[]; }
interface CachedModel { signature: string; model: CMakeModel; }
const MODELS = new Map<string, CachedModel>();

function ownsProject(source: string, projectPath?: string): boolean {
    if (!projectPath) { return true; }
    return path.resolve(source).toLowerCase() === path.resolve(path.dirname(projectPath)).toLowerCase();
}

export function prepareCMakeQuery(buildDirectory: string): void {
    const directory = path.join(buildDirectory, ".cmake", "api", "v1", "query", CLIENT);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ["codemodel-v2", "toolchains-v1", "cmakeFiles-v1"]) { fs.writeFileSync(path.join(directory, name), "", "utf8"); }
}

function readReply<T>(directory: string, name: string): T {
    if (typeof name !== "string") { throw new Error("CMake 응답 파일 이름을 확인하세요."); }
    if (path.basename(name) !== name || !name.endsWith(".json")) { throw new Error("CMake 응답 파일 경로를 확인하세요."); }
    const file = path.join(directory, name);
    if (fs.statSync(file).size > 16 * 1024 * 1024) { throw new Error("CMake 응답 파일이 너무 큽니다."); }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function readCMakeModel(buildDirectory: string, configuration: "debug" | "release", projectPath?: string): CMakeModel | undefined {
    const directory = path.join(buildDirectory, ".cmake", "api", "v1", "reply");
    if (!fs.existsSync(directory)) { return undefined; }
    const indexName = fs.readdirSync(directory).filter(name => /^index-.*\.json$/.test(name)).sort().at(-1);
    if (!indexName) { return undefined; }
    const key = JSON.stringify([path.resolve(buildDirectory).toLowerCase(), configuration]);
    const signature = `${indexName}:${fs.statSync(path.join(directory, indexName)).mtimeMs}`;
    const cached = MODELS.get(key);
    if (cached?.signature === signature) { return ownsProject(cached.model.source, projectPath) ? cached.model : undefined; }
    const index = readReply<ReplyIndex>(directory, indexName);
    const reply = index.reply?.[CLIENT];
    const modelReference = reply?.["codemodel-v2"]?.jsonFile;
    if (!modelReference) { return undefined; }
    const model = readReply<CodeModelReply>(directory, modelReference);
    if (!ownsProject(model.paths.source, projectPath)) { return undefined; }
    const selected = model.configurations.find(entry => entry.name.toLowerCase() === configuration) ?? model.configurations.find(entry => !entry.name);
    if (!selected) { return undefined; }
    const targets = selected.targets.map(entry => readReply<CMakeTarget>(directory, entry.jsonFile));
    const files = reply["cmakeFiles-v1"]?.jsonFile ? readReply<CMakeFilesReply>(directory, reply["cmakeFiles-v1"].jsonFile!) : undefined;
    const tools = reply["toolchains-v1"]?.jsonFile ? readReply<ToolchainsReply>(directory, reply["toolchains-v1"].jsonFile!) : undefined;
    const inputs = (files?.inputs ?? []).filter(entry => !entry.isGenerated && !entry.isCMake).map(entry => path.resolve(model.paths.source, entry.path));
    const compilers = Object.fromEntries((tools?.toolchains ?? []).map(entry => [entry.language, entry.compiler?.path ?? ""]));
    const result = { source: model.paths.source, build: model.paths.build, targets, inputs, compilers };
    MODELS.set(key, { signature, model: result });
    if (MODELS.size > 40) { MODELS.delete(MODELS.keys().next().value!); }
    return result;
}
