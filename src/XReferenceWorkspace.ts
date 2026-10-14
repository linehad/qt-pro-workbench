import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type { ReferenceProject, ReferenceSession } from "./XReferenceTypes";
import { sourceIdentity } from "./XReferenceScope";

function inPlaceSessionPath(storage: string): string {
    const id = createHash("sha256").update(vscode.env.sessionId).digest("hex");
    return path.join(storage, "reference-workspaces", `in-place-${id}.session.json`);
}

function sessionPath(storage: string): string | undefined {
    const file = vscode.workspace.workspaceFile?.fsPath;
    if (file) {
        const parent = sourceIdentity(path.dirname(file));
        const isManaged = parent === sourceIdentity(path.join(storage, "reference-workspaces"));
        if (isManaged && /^qt-projects-[a-f0-9-]+\.code-workspace$/.test(path.basename(file))) { return file + ".session.json"; }
    }
    const session = inPlaceSessionPath(storage);
    if (!fs.existsSync(session)) { return undefined; }
    const saved = JSON.parse(fs.readFileSync(session, "utf8")) as ReferenceSession;
    const current = vscode.workspace.workspaceFolders?.map(folder => sourceIdentity(folder.uri.fsPath)).sort() ?? [];
    const expected = saved.workspaceRoots?.map(sourceIdentity).sort() ?? [];
    return current.length && JSON.stringify(current) === JSON.stringify(expected) ? session : undefined;
}

export function loadReferenceSession(storage: string): ReferenceSession | undefined {
    const file = sessionPath(storage);
    if (!file || !fs.existsSync(file)) { return undefined; }
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as ReferenceSession;
    if (value.version !== 1 || !Array.isArray(value.projects)) { return undefined; }
    return value;
}

export function saveReferenceSession(storage: string, projects: string[], activeProject?: string): void {
    const file = sessionPath(storage);
    if (!file) { return; }
    const previous = loadReferenceSession(storage);
    fs.writeFileSync(file, JSON.stringify({ version: 1, documents: [], ...previous, projects, activeProject }, null, 4), "utf8");
}

export async function prepareReferenceWorkspace(storage: string, projects: ReferenceProject[], activeProject: string | undefined, reference: ReferenceSession["reference"]): Promise<boolean> {
    const roots = [...new Map(projects.map(project => [sourceIdentity(project.root), project.root])).values()];
    const folders = vscode.workspace.workspaceFolders;
    if (folders?.length) {
        const missing = roots.filter(root => !folders.some(folder => {
            const relative = path.relative(folder.uri.fsPath, root);
            return !relative.startsWith("..") && !path.isAbsolute(relative);
        }));
        const sessionFile = sessionPath(storage);
        if (sessionFile && missing.length) {
            const previous = loadReferenceSession(storage)!;
            const workspaceRoots = [...folders.map(folder => folder.uri.fsPath), ...missing];
            fs.writeFileSync(sessionFile, JSON.stringify({ ...previous, workspaceRoots }, null, 4), "utf8");
        }
        if (missing.length && !vscode.workspace.updateWorkspaceFolders(folders.length, 0, ...missing.map(root => ({ uri: vscode.Uri.file(root) })))) {
            throw new Error("참조 분석 폴더를 추가할 수 없습니다.");
        }
        return false;
    }
    if (vscode.debug.activeDebugSession) { throw new Error("전체 참조 색인을 처음 준비하려면 디버깅을 종료한 뒤 참조 찾기를 다시 실행하세요."); }
    const directory = path.join(storage, "reference-workspaces");
    fs.mkdirSync(directory, { recursive: true });
    const documents = vscode.workspace.textDocuments.filter(document => document.uri.scheme === "file").map(document => ({ file: document.fileName, dirtyText: document.isDirty ? document.getText() : undefined }));
    const session: ReferenceSession = { version: 1, projects: [...new Set(projects.map(project => project.openedProject))], activeProject, reference, documents, workspaceRoots: roots };
    const file = inPlaceSessionPath(storage);
    fs.writeFileSync(file, JSON.stringify(session, null, 4), "utf8");
    // Update the current workspace directly; opening a workspace can create another window.
    if (!vscode.workspace.updateWorkspaceFolders(0, 0, ...roots.map(root => ({ uri: vscode.Uri.file(root) })))) {
        fs.unlinkSync(file);
        throw new Error("현재 창에 참조 분석 폴더를 추가할 수 없습니다.");
    }
    return true;
}

export async function restoreReferenceDocuments(storage: string): Promise<ReferenceSession["reference"]> {
    const session = loadReferenceSession(storage);
    if (!session?.reference) { return undefined; }
    const reference = session.reference;
    for (const saved of session.documents ?? []) {
        if (!fs.existsSync(saved.file)) { continue; }
        const document = await vscode.workspace.openTextDocument(saved.file);
        if (saved.dirtyText !== undefined && document.getText() !== saved.dirtyText) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), saved.dirtyText);
            await vscode.workspace.applyEdit(edit);
        }
    }
    const file = sessionPath(storage)!;
    fs.writeFileSync(file, JSON.stringify({ ...session, reference: undefined, documents: [] }, null, 4), "utf8");
    const document = await vscode.workspace.openTextDocument(reference.file);
    const position = new vscode.Position(reference.line, reference.character);
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
    return reference;
}
