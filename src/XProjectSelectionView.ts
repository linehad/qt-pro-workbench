import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { ProjectSelectionChange, ProjectSelectionState, SettingsTab } from "./XProjectSelectionTypes";

interface ProjectSelectionViewInfo {
    extensionUri: vscode.Uri;
    tab: SettingsTab;
    state: () => ProjectSelectionState;
    select: (change: ProjectSelectionChange) => Promise<void>;
}

export function openProjectSelectionView(info: ProjectSelectionViewInfo): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel("qtProProjectSelection", "Qt · Project Settings", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(info.extensionUri, "media")] });
    const webview = panel.webview;
    const nonce = crypto.randomBytes(16).toString("hex");
    const resource = (name: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", name));
    const tools = (section: string, label: string): string => `<div class="configuration"><label for="${section}Configuration">${label}</label><select id="${section}Configuration"></select><button data-action="add" data-section="${section}">Add…</button><button data-action="remove" data-section="${section}">Remove</button><button data-action="rename" data-section="${section}">Rename…</button><button data-action="clone" data-section="${section}">Clone…</button></div>`;
    const field = (id: string, label: string, browse = false, placeholder = ""): string => `<label for="${id}">${label}</label><div class="path"><input id="${id}" placeholder="${placeholder}" autocomplete="off">${browse ? `<button data-browse="${id}">Browse…</button>` : ""}</div>`;
    webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource("project-selection.css")}"></head><body data-tab="${info.tab}">
<main><header><h1>Project Settings</h1><div class="selectors"><label for="project">Project</label><select id="project"></select><label for="kit">Kit</label><select id="kit"></select><button id="manageKits">키트 관리…</button></div><p id="projectPath" class="hint"></p></header>
<nav role="tablist" aria-label="Project settings"><button role="tab" id="tab-build" data-tab="build" aria-controls="panel-build">Build Settings</button><button role="tab" id="tab-deploy" data-tab="deploy" aria-controls="panel-deploy">Deploy Settings</button><button role="tab" id="tab-run" data-tab="run" aria-controls="panel-run">Run Settings</button></nav>
<fieldset id="settings"><section id="panel-build" role="tabpanel" aria-labelledby="tab-build">
${tools("build", "Active build configuration:")}
<h2>General</h2><div class="box fields"><label id="shadowLabel" for="shadowBuild">Shadow build:</label><div id="shadowCheck" class="check"><input id="shadowBuild" type="checkbox"></div>${field("buildDirectory", "Build directory:", true)}</div>
<h2>Build Steps</h2><details class="box" open><summary id="qmakeSummary">qmake</summary><div class="fields"><label for="qmakeArguments">추가 qmake 인수:</label><input id="qmakeArguments" autocomplete="off"></div></details><details class="box" open><summary id="makeSummary">Make</summary><div class="fields"><label for="makeArguments">make 인수:</label><input id="makeArguments" autocomplete="off"></div></details>
<h2>Clean Steps</h2><details class="box"><summary id="cleanSummary">Make clean</summary><div class="fields"><label for="cleanArguments">make 인수:</label><input id="cleanArguments" autocomplete="off"></div></details>
<h2>Build Environment</h2><details class="box"><summary>Use System Environment + Kit Environment</summary><div class="fields"><label for="buildEnvironment">추가 환경변수:</label><div><textarea id="buildEnvironment" rows="5" placeholder="NAME=value"></textarea><small>한 줄에 NAME=value 하나씩 입력합니다.</small></div></div></details>
</section><section id="panel-deploy" role="tabpanel" aria-labelledby="tab-deploy" hidden>
${tools("deploy", "Active deployment configuration:")}
<p id="noDeploySteps" class="hint">No Deploy Steps</p><div id="deploySteps"></div><button id="addDeployStep">Add Deploy Step · 파일·폴더 복사</button>
<p class="hint">원본 파일·폴더를 대상 폴더 안에 같은 이름으로 복사합니다. 변경 없는 파일은 건너뜁니다.<br>등록된 단계는 실행·디버그 전에 적용됩니다. 상대 경로의 기준은 프로젝트 폴더입니다.</p><p class="hint">경로 변수: <code>\${projectDir}</code> <code>\${buildDir}</code> <code>\${outputDir}</code> <code>\${executable}</code> <code>\${configuration}</code></p>
</section><section id="panel-run" role="tabpanel" aria-labelledby="tab-run" hidden>
${tools("run", "Active run configuration:")}
<div class="box fields">${field("executable", "Executable:", true, "자동 · 프로젝트 빌드 결과")}${field("arguments", "Command line arguments:")}${field("workingDirectory", "Working directory:", true, "%{RunConfig:Executable:Path}")}<span></span><div><button id="resetWorkingDirectory">실행 파일 폴더로 초기화</button></div><span></span><label class="check"><input id="runInTerminal" type="checkbox">Run in terminal</label></div><p id="automaticExecutable" class="hint"></p>
<h2>Environment</h2><details class="box"><summary>Use Build Environment</summary><div class="fields"><label for="runEnvironment">추가 환경변수:</label><textarea id="runEnvironment" rows="5" placeholder="NAME=value"></textarea></div></details>
<h2>Debugger Settings</h2><details class="box" open><summary>C++ · GDB</summary><div class="fields"><span>C++ debugger:</span><span id="debuggerPath"></span><label for="startupCommands">Additional startup commands:</label><div><textarea id="startupCommands" rows="5"></textarea><small>GDB 시작 명령을 한 줄에 하나씩 입력합니다.</small></div></div></details>
</section></fieldset>
<footer><button id="save" class="primary">저장</button><button id="reload">다시 불러오기</button><span id="message" role="status" aria-live="polite"></span></footer><p id="empty" class="hint" hidden>프로젝트와 키트를 선택하세요.</p>
</main><script nonce="${nonce}" src="${resource("project-selection.js")}"></script></body></html>`;
    const sendState = async (requestId?: string): Promise<void> => { await webview.postMessage({ type: "state", state: info.state(), requestId }); };
    let pending = Promise.resolve();
    const listener = webview.onDidReceiveMessage(message => {
        pending = pending.then(async () => {
            try {
                if (message?.type === "ready" || message?.type === "reload") { await sendState(message.requestId); return; }
                if (message?.type === "select") {
                    if (!message.change || typeof message.change !== "object") { throw new Error("선택 값을 확인하세요."); }
                    await info.select(message.change); await sendState(message.requestId); return;
                }
                if (message?.type !== "browse") { return; }
                if (!["buildDirectory", "executable", "workingDirectory", "source", "destination"].includes(message.field)) { return; }
                const folder = ["buildDirectory", "workingDirectory", "destination"].includes(message.field);
                const choices = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: folder || message.field === "source", canSelectFiles: !folder, filters: message.field === "executable" ? { Executable: ["exe"] } : undefined });
                if (choices?.[0]) { await webview.postMessage({ type: "path", field: message.field, id: message.id, context: message.context, value: choices[0].fsPath }); }
            } catch (error) { await webview.postMessage({ type: "error", message: (error as Error).message }); }
        });
    });
    const visible = panel.onDidChangeViewState(event => { if (event.webviewPanel.visible) { void sendState().catch(() => {}); } });
    panel.onDidDispose(() => { listener.dispose(); visible.dispose(); });
    return panel;
}
