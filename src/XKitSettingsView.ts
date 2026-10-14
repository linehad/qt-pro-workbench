import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as vscode from "vscode";
import { discoverKits, loadKits } from "./XKitStore";
import { saveKits } from "./XKitSettings";
import { debuggerPathForKit } from "./XDebugConfiguration";

interface KitSettingsViewInfo {
    extensionUri: vscode.Uri;
    kitsPath: string;
    selectedKitId?: string;
    onSaved: () => Promise<void>;
}

export function openKitSettingsView(info: KitSettingsViewInfo): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel("qtProKitSettings", "Qt 키트 설정", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(info.extensionUri, "media")] });
    const webview = panel.webview;
    const nonce = crypto.randomBytes(16).toString("hex");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "kit-settings.css"));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(info.extensionUri, "media", "kit-settings.js"));
    let previousContents = fs.readFileSync(info.kitsPath, "utf8");
    const sendKits = async (type = "kits"): Promise<void> => {
        const kits = loadKits(info.kitsPath);
        await webview.postMessage({ type, kits, selectedKitId: info.selectedKitId, debuggerDefaults: Object.fromEntries(kits.map(kit => [kit.id, debuggerPathForKit({ ...kit, debuggerPath: undefined })])) });
    };
    const pathInput = (id: string, label: string, hint = ""): string => `<label for="${id}">${label}</label><div><div class="path"><input id="${id}" autocomplete="off"><button type="button" data-browse="${id}">찾아보기…</button></div><small id="${id}Hint">${hint}</small></div>`;
    webview.html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<header><h1>Qt / CMake 키트 설정</h1><p>프로젝트에 사용할 컴파일러와 빌드 도구를 구성하세요.</p></header>
<main><aside><label for="kits">등록된 키트</label><select id="kits" size="9" aria-label="등록된 키트"></select><div class="toolbar"><button id="add" type="button">추가</button><button id="duplicate" type="button">복제</button><button id="remove" type="button">삭제</button></div><button id="discover" type="button">설치된 Qt / CMake 자동 찾기</button></aside>
<section><p id="empty">키트를 추가하거나 설치된 Qt를 자동으로 찾아보세요.</p><form id="settings"><fieldset id="editor"><div class="fields">
<label for="name">키트 이름</label><input id="name" autocomplete="off">
${pathInput("qmakePath", "Qt · qmake", "qmake 프로젝트에 필요 · CMake 전용 키트는 비워도 됩니다.")}
${pathInput("compilerDirectory", "컴파일러", "컴파일러의 bin 폴더 (GCC, Clang 또는 MSVC)")}
${pathInput("makePath", "빌드 도구", "mingw32-make.exe")}
${pathInput("cmakePath", "CMake", "cmake.exe · Qt 없이 CMake만 사용하는 키트도 가능합니다.")}
<label for="cmakeGenerator">CMake 생성기</label><input id="cmakeGenerator" list="generators" placeholder="MinGW Makefiles"><datalist id="generators"><option value="MinGW Makefiles"><option value="Ninja"><option value="Ninja Multi-Config"><option value="Visual Studio 17 2022"><option value="Visual Studio 18 2026"><option value="NMake Makefiles"></datalist>
${pathInput("cmakeMakePath", "CMake 빌드 도구", "Ninja는 ninja.exe, MinGW Makefiles는 mingw32-make.exe. 비우면 자동 선택합니다.")}
${pathInput("cCompilerPath", "C 컴파일러", "gcc.exe / clang.exe / cl.exe")}
${pathInput("cxxCompilerPath", "C++ 컴파일러", "g++.exe / clang++.exe / cl.exe")}
${pathInput("cmakeToolchainFile", "CMake toolchain 파일", "선택 사항 · 교차 컴파일 등은 이 파일의 컴파일러 설정을 사용합니다.")}
<label for="cmakePlatform">CMake 플랫폼 (-A)</label><input id="cmakePlatform" placeholder="Visual Studio: x64 / Win32 / ARM64 (그 외에는 비움)">
<label for="debuggerType">디버거 종류</label><select id="debuggerType"><option value="gdb">GDB (MinGW / GCC)</option><option value="msvc">MSVC (Visual Studio)</option></select>
${pathInput("debuggerPath", "디버거 · GDB", "비우면 키트에 맞는 기본 GDB를 사용합니다.")}
<label for="spec">qmake spec</label><input id="spec" placeholder="예: win32-g++ (비우면 Qt 기본값)">
</div><details><summary>추가 설정</summary><div class="fields"><label for="qmakeArguments">qmake 인수</label><div><textarea id="qmakeArguments" rows="3"></textarea><small>인수 하나를 한 줄에 입력하세요. 공백이 포함되어도 따옴표로 감싸지 않습니다.</small></div><label for="makeArguments">make 인수</label><div><input id="makeArguments" placeholder="-j${os.availableParallelism()}"><small>인수를 한 줄로 입력합니다. 비우면 CPU 수에 맞춰 병렬 빌드합니다 (-j${os.availableParallelism()}).</small></div><label for="environment">환경변수</label><div><textarea id="environment" rows="4" placeholder="NAME=value"></textarea><small>한 줄에 NAME=value 하나씩 입력합니다. 선택한 키트의 프로세스에만 적용됩니다.</small></div></div></details></fieldset></form></section></main>
<footer><button type="submit" form="settings" class="primary" id="save">저장</button><button type="button" id="reload">다시 불러오기</button><span id="message" role="status" aria-live="polite"></span><p>저장한 키트는 모든 프로젝트에서 사용할 수 있습니다. 프로젝트의 키트 선택 메뉴에서 적용하세요.</p></footer><script nonce="${nonce}" src="${script}"></script></body></html>`;
    const listener = webview.onDidReceiveMessage(async message => {
        try {
            if (message?.type === "ready") { await sendKits(); return; }
            if (message?.type === "reload") { previousContents = fs.readFileSync(info.kitsPath, "utf8"); await sendKits(); return; }
            if (message?.type === "save") {
                saveKits(info.kitsPath, message.kits, previousContents);
                previousContents = fs.readFileSync(info.kitsPath, "utf8");
                await info.onSaved();
                await sendKits("saved");
                return;
            }
            if (message?.type === "discover") {
                const additional = vscode.workspace.getConfiguration("qt-core").get<{ path: string }[]>("additionalQtPaths") ?? [];
                await webview.postMessage({ type: "discovered", kits: discoverKits(additional.map(item => item.path)) });
                return;
            }
            if (message?.type !== "browse") { return; }
            const fields = ["qmakePath", "compilerDirectory", "makePath", "debuggerPath", "cmakePath", "cmakeMakePath", "cCompilerPath", "cxxCompilerPath", "cmakeToolchainFile"];
            if (!fields.includes(message.field)) { return; }
            const directory = message.field === "compilerDirectory";
            const fileFilters: Record<string, string[]> = message.field === "cmakeToolchainFile" ? { "CMake toolchain": ["cmake", "txt"] } : { Executable: ["exe"] };
            const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: directory, canSelectFiles: !directory, filters: directory ? undefined : fileFilters });
            if (!chosen?.[0]) { return; }
            const value = chosen[0].fsPath;
            const defaults: Record<string, string> = {};
            if (directory) {
                const make = path.join(value, "mingw32-make.exe");
                if (fs.existsSync(make)) { defaults.makePath = make; }
            }
            await webview.postMessage({ type: "path", kitId: message.kitId, field: message.field, value, defaults });
        } catch (error) { await webview.postMessage({ type: "error", message: (error as Error).message }); }
    });
    panel.onDidDispose(() => listener.dispose());
    return panel;
}
