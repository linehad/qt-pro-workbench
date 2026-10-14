import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { validateBuildSettings } from "./XBuildSettings";
import type { BuildSettings } from "./XBuildSettingsTypes";

interface BuildSettingsViewInfo {
    extensionUri: vscode.Uri;
    projectPath: string;
    kitName: string;
    configuration: string;
    settings: BuildSettings;
    save: (settings: BuildSettings) => Promise<void>;
}

export function openBuildSettingsView(info: BuildSettingsViewInfo): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel("qtProBuildSettings", `빌드 설정 · ${path.basename(info.projectPath)}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(info.extensionUri, "media")] });
    const webview = panel.webview;
    const nonce = crypto.randomBytes(16).toString("hex");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "build-settings.css"));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "build-settings.js"));
    webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<main><h1>빌드 설정</h1><p id="project"></p><p id="kit"></p><form id="settings">
<h2>일반</h2><div class="fields"><label for="shadowBuild">Shadow build</label><div class="check"><input type="checkbox" id="shadowBuild"></div>
<label for="buildDirectory">빌드 폴더</label><div class="path"><input id="buildDirectory"><button type="button" id="browseDirectory">찾아보기…</button></div></div>
<h2>빌드 단계</h2><div class="fields"><label for="qmakeArguments">qmake 추가 인수</label><div><input id="qmakeArguments" placeholder='예: "DEFINES+=MY_FEATURE"'><small>선택한 .pro, 키트의 spec, Debug/Release 뒤에 전달됩니다. 프로젝트의 출력·중간 파일 경로는 덮어쓰지 않습니다.</small></div><label for="makeArguments">make 인수</label><input id="makeArguments" placeholder="예: -j8"></div>
<h2>정리 단계</h2><div class="fields"><label for="cleanArguments">make 인수</label><input id="cleanArguments" placeholder="예: clean -j8"></div>
<h2>빌드 환경</h2><div class="fields"><label for="environment">환경변수</label><div><textarea id="environment" rows="4" placeholder="NAME=value"></textarea><small>시스템 환경과 선택한 키트의 도구 경로를 사용합니다. 추가·변경할 변수는 한 줄에 NAME=value 하나씩 입력하세요.</small></div></div>
<div class="actions"><button type="submit" class="primary">저장</button><span id="message" role="status" aria-live="polite"></span></div></form></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const sendSettings = (): void => { void webview.postMessage({ type: "settings", project: info.projectPath, projectDirectory: path.dirname(info.projectPath), suggestedDirectory: path.join(path.dirname(info.projectPath), "build", `${info.kitName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${info.configuration}`), kit: `${info.kitName} · ${info.configuration}`, settings: info.settings }); };
    const listener = webview.onDidReceiveMessage(async message => {
        try {
            if (message?.type === "ready") { sendSettings(); return; }
            if (message?.type === "save") {
                const settings = validateBuildSettings(message.settings);
                await info.save(settings);
                info.settings = settings;
                await webview.postMessage({ type: "saved" });
                return;
            }
            if (message?.type !== "browseDirectory") { return; }
            const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: true, canSelectFiles: false });
            if (chosen?.[0]) { await webview.postMessage({ type: "path", value: chosen[0].fsPath }); }
        } catch (error) { await webview.postMessage({ type: "error", message: (error as Error).message }); }
    });
    panel.onDidDispose(() => listener.dispose());
    return panel;
}
