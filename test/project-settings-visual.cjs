const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { chromium } = require("C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const assert = require("node:assert/strict");

(async () => {
    const original = Module._load;
    const panel = { webview: { asWebviewUri: value => value, cspSource: "file:", onDidReceiveMessage: () => ({ dispose() {} }) }, onDidChangeViewState: () => ({ dispose() {} }), onDidDispose() {} };
    Module._load = function (name, ...args) { if (name === "vscode") { return { Uri: { joinPath: (...parts) => parts.join("/") }, ViewColumn: { Active: 1 }, window: { createWebviewPanel: () => panel } }; } return original.call(this, name, ...args); };
    const { openProjectSelectionView } = require("../out/XProjectSelectionView");
    openProjectSelectionView({ extensionUri: "unused", tab: "build" });
    Module._load = original;
    const settings = { shadowBuild: false, buildDirectory: "", qmakeArguments: "", makeArguments: "-j28", cleanArguments: "clean -j28", environment: "" };
    const state = {
        projects: [{ projectPath: "F:\\1.4.13_Work\\HydraX\\HydraX.pro", name: "HydraX" }, { projectPath: "F:\\1.4.13_Work\\HydraX_Daemon\\HydraX_Daemon.pro", name: "HydraX_Daemon" }],
        projectPath: "F:\\1.4.13_Work\\HydraX\\HydraX.pro", activeProject: "F:\\1.4.13_Work\\HydraX\\HydraX.pro", configuration: "debug",
        kitId: "qt4", kits: [{ id: "qt4", name: "Qt 4.8.1 / mingw (32-bit)" }],
        builds: { activeId: "debug", items: [{ id: "debug", name: "Debug", configuration: "debug", settings }, { id: "release", name: "Release", configuration: "release", settings }] },
        deploys: { activeId: "default", items: [{ id: "default", name: "Deploy Configuration", steps: [] }] },
        runs: { activeId: "default", items: [{ id: "default", name: "HydraX", kind: "project", executable: "", arguments: "", workingDirectory: "" }] },
        automaticExecutable: "F:\\1.4.13_Work\\Build_OUTPUT_HMI\\debug\\HydraX.exe", buildDirectory: "F:\\1.4.13_Work\\HydraX",
        qmakePath: "C:\\QtSDK\\Desktop\\Qt\\4.8.1\\mingw\\bin\\qmake.exe", makePath: "C:\\QtSDK\\mingw\\bin\\mingw32-make.exe", debuggerPath: "C:\\QtSDK\\pythongdb\\python_2.7based\\gdb-i686-pc-mingw32.exe"
    };
    const css = fs.readFileSync(path.join(__dirname, "../media/project-selection.css"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../media/project-selection.js"), "utf8");
    const mock = `globalThis.qaMessages=[];globalThis.acquireVsCodeApi=()=>({getState:()=>undefined,setState:()=>{},postMessage:m=>{qaMessages.push(m);if(m.type==='ready'){setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state:${JSON.stringify(state)}}})),0);}}});`;
    const html = panel.webview.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").replace(/<link rel="stylesheet"[^>]*>/, `<style>${css}</style>`).replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script>${mock}</script><script>${script}</script>`);
    const preview = path.join(__dirname, "project-settings-preview.html"); fs.writeFileSync(preview, html);
    const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
        await page.goto("file:///" + preview.replaceAll("\\", "/"));
        await page.waitForFunction(() => document.getElementById("project").options.length === 2);
        assert.equal(await page.locator("#buildMode").count(), 0);
        assert.match(await page.locator("#qmakeSummary").textContent(), /CONFIG\+=debug/);
        for (const tab of ["build", "deploy", "run"]) {
            await page.locator("#tab-" + tab).click();
            await page.screenshot({ path: path.join(__dirname, "project-settings-" + tab + ".png"), fullPage: true });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
        }
        await page.locator("#tab-build").click(); await page.locator("#makeArguments").fill("-j4");
        await page.locator("#tab-run").click(); await page.locator("#tab-build").click(); assert.equal(await page.locator("#makeArguments").inputValue(), "-j4");
        await page.setViewportSize({ width: 520, height: 1100 }); await page.screenshot({ path: path.join(__dirname, "project-settings-narrow.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.locator("#buildConfiguration").selectOption("release");
        const switchMessage = await page.evaluate(() => qaMessages.at(-1));
        assert.equal(switchMessage.change.draft.configuration, "debug");
        assert.equal(switchMessage.change.draft.build.makeArguments, "-j4");
        assert.equal(Object.hasOwn(switchMessage.change.draft, "buildMode"), false);
        const releaseState = structuredClone(state); releaseState.configuration = "release"; releaseState.builds.activeId = "release";
        await page.evaluate(message => window.dispatchEvent(new MessageEvent("message", { data: message })), { type: "state", state: releaseState, requestId: switchMessage.requestId });
        assert.match(await page.locator("#qmakeSummary").textContent(), /CONFIG\+=release/);
        await page.locator("#save").click();
        const saveMessage = await page.evaluate(() => qaMessages.at(-1));
        assert.equal(saveMessage.change.draft.configuration, "release");
        assert.equal(saveMessage.change.draft.buildId, "release");
        assert.equal(Object.hasOwn(saveMessage.change.draft, "buildMode"), false);
        console.log("Visual forms rendered at 1440 px and 520 px; tab drafts retained; no overflow; one build selector controls the mode.");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
