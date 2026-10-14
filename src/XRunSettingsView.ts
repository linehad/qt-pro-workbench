import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { activeRunConfiguration, changeRunConfiguration } from "./XRunConfigurations";
import { validateRunSettings } from "./XRunValidation";
import type { RunConfigurationChange, RunConfigurationSet } from "./XRunTypes";

interface RunSettingsViewInfo {
    extensionUri: vscode.Uri;
    projectPath: string;
    kitName: string;
    configuration: string;
    defaultExecutable?: string;
    addOnOpen?: boolean;
    state: () => RunConfigurationSet;
    change: (changes: RunConfigurationChange[]) => Promise<void>;
}

async function chooseChange(info: RunSettingsViewInfo, message: { type: string; id: string; targetId?: string }): Promise<RunConfigurationChange | undefined> {
    if (message.type === "select") { return { action: "select", id: message.targetId ?? "" }; }
    if (message.type === "remove") { return { action: "remove", id: message.id }; }
    if (message.type === "add") {
        const choices = [{ label: "Custom Executable", description: "다른 실행 프로그램 지정", runKind: "custom" as const }, { label: "프로젝트 출력", description: "Makefile의 출력 EXE 사용", runKind: "project" as const }];
        const chosen = await vscode.window.showQuickPick(choices, { title: "Add Run Configuration" });
        if (!chosen) { return undefined; }
        const name = chosen.runKind === "custom" ? "Custom Executable" : path.basename(info.projectPath, ".pro");
        return { action: "add", kind: chosen.runKind, name };
    }
    const state = info.state();
    const selected = state.items.find(item => item.id === message.id);
    if (!selected) { throw new Error("실행 설정을 다시 선택하세요."); }
    if (message.type === "clone") { return { action: "clone", id: selected.id, name: selected.name + " 복사" }; }
    if (message.type !== "rename") { throw new Error("실행 설정 작업이 올바르지 않습니다."); }
    const name = await vscode.window.showInputBox({ title: "Rename Run Configuration", value: selected.name, validateInput: value => {
        try { changeRunConfiguration(state, { action: "rename", id: selected.id, name: value }); return undefined; }
        catch (error) { return String(error); }
    } });
    return name === undefined ? undefined : { action: "rename", id: selected.id, name };
}

export function openRunSettingsView(info: RunSettingsViewInfo): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel("qtProRunSettings", `실행 설정 · ${path.basename(info.projectPath)}`, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(info.extensionUri, "media")] });
    const webview = panel.webview;
    const nonce = crypto.randomBytes(16).toString("hex");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "run-settings.css"));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "run-settings.js"));
    webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<main><h1>Run Settings</h1><p id="project"></p><p id="kit"></p>
<div class="configurations"><label for="activeConfiguration">Active run configuration:</label><select id="activeConfiguration"></select><button id="add">Add…</button><button id="remove">Remove</button><button id="rename">Rename…</button><button id="clone">Clone…</button></div>
<form id="settings">
<label for="executable">Executable</label><div class="path"><input id="executable" placeholder="실행 파일 경로 입력"><button type="button" id="browseExecutable">찾아보기…</button><button type="button" id="clearExecutable">자동</button></div>
<label for="arguments">Command line arguments</label><div><input id="arguments" placeholder="비워 두면 인수 없이 실행"><small>예: Run 또는 --mode "test run". 공백이 있는 인수는 큰따옴표로 묶으세요.</small></div>
<label for="workingDirectory">Working directory</label><div class="path"><input id="workingDirectory" placeholder="비우면 실행 파일이 있는 폴더"><button type="button" id="browseDirectory">찾아보기…</button></div>
<div class="wide actions"><button type="submit" class="primary">저장</button><button type="button" id="reset">기본값</button></div>
</form><p id="message" role="status" aria-live="polite"></p></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const sendSettings = async (status = "", refresh = false): Promise<void> => {
        const configurations = info.state();
        await webview.postMessage({ type: "settings", project: info.projectPath, kit: `${info.kitName} · ${info.configuration}`, configurations, settings: activeRunConfiguration(configurations), defaultExecutable: info.defaultExecutable ?? "", status, refresh });
    };
    const handleMessage = async (message: any): Promise<void> => {
        if (message?.type === "ready") {
            await sendSettings();
            if (info.addOnOpen) { info.addOnOpen = false; await webview.postMessage({ type: "addOnOpen" }); }
            return;
        }
        const selectDirectory = message?.type === "browseDirectory";
        if (selectDirectory || message?.type === "browseExecutable") {
            const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: selectDirectory, canSelectFiles: !selectDirectory, filters: selectDirectory ? undefined : { Executable: ["exe"] } });
            await webview.postMessage({ type: "path", id: message.id, field: selectDirectory ? "workingDirectory" : "executable", value: chosen?.[0]?.fsPath });
            return;
        }
        const allowed = ["save", "select", "add", "remove", "rename", "clone"];
        if (!allowed.includes(message?.type)) { return; }
        const changes: RunConfigurationChange[] = [];
        if (message.type !== "remove") { changes.push({ action: "save", id: message.id, settings: validateRunSettings(message.settings) }); }
        if (message.type !== "save") {
            const change = await chooseChange(info, message);
            if (change) { changes.push(change); }
        }
        await info.change(changes);
        await sendSettings(message.type === "save" ? "저장했습니다." : "");
    };
    let pending = Promise.resolve();
    const listener = webview.onDidReceiveMessage(message => {
        pending = pending.then(() => handleMessage(message)).catch(async error => { await webview.postMessage({ type: "error", message: String(error) }); });
    });
    const visible = panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { void sendSettings("", true); } });
    panel.onDidDispose(() => { listener.dispose(); visible.dispose(); });
    return panel;
}
