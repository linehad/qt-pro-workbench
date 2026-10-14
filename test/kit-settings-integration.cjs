const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, errors: [] };
    const originalCreate = vscode.window.createWebviewPanel;
    const originalPick = vscode.window.showQuickPick;
    let panel;
    let receive;
    let ready;
    let timeout;
    let uiResult;
    const messages = [];
    const initialized = new Promise((resolve, reject) => {
        ready = resolve;
        timeout = setTimeout(() => reject(new Error("Kit settings webview did not initialize")), 15000);
    });
    const storage = path.join(process.env.LOCALAPPDATA, "Temp/qt-pro-kits-qa/User/globalStorage/ynlim.qt-pro-workbench");
    const kitsPath = path.join(storage, "kits.json");
    let originalContents;
    vscode.window.createWebviewPanel = (...args) => {
        panel = originalCreate(...args);
        const onMessage = panel.webview.onDidReceiveMessage.bind(panel.webview);
        const post = panel.webview.postMessage.bind(panel.webview);
        panel.webview.postMessage = message => { messages.push(message); if (message.type === "kits") { ready(); } return post(message); };
        panel.webview.onDidReceiveMessage = callback => {
            receive = callback;
            return onMessage(message => { if (message.type === "qaResult") { uiResult?.(message); } return callback(message); });
        };
        return panel;
    };
    try {
        assert(!vscode.workspace.workspaceFolders?.length);
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        originalContents = fs.readFileSync(kitsPath, "utf8");
        const original = JSON.parse(originalContents);
        await vscode.commands.executeCommand("qtPro.editKits");
        await initialized;
        assert(panel.webview.html.includes('id="qmakePath"'));
        assert(panel.webview.html.includes('id="compilerDirectory"'));
        assert(panel.webview.html.includes('id="debuggerPath"'));
        assert.deepEqual(messages.at(-1).kits, original);
        const activePanel = panel;
        await vscode.commands.executeCommand("qtPro.editKits");
        assert.equal(panel, activePanel, "Repeated command must reuse the settings screen");
        const changed = original.map((kit, index) => index ? kit : { ...kit, name: "QA renamed Qt kit", makeArguments: ["-j", "2"], environment: { QA_SETTING: "preserved value" } });
        await receive({ type: "save", kits: changed });
        assert.equal(messages.at(-1).type, "saved");
        const saved = JSON.parse(fs.readFileSync(kitsPath, "utf8"));
        assert.equal(saved[0].id, original[0].id);
        assert.equal(saved[0].name, "QA renamed Qt kit");
        assert.equal(saved[0].environment.QA_SETTING, "preserved value");
        const project = vscode.Uri.file(path.resolve(__dirname, "smoke source/smoke.pro"));
        await vscode.commands.executeCommand("qtPro.openProject", project);
        vscode.window.showQuickPick = async choices => {
            const items = await Promise.resolve(choices);
            assert(items.some(item => item.label.includes("키트 설정")));
            return items.find(item => item.kit?.name === "QA renamed Qt kit");
        };
        await vscode.commands.executeCommand("qtPro.selectKit");
        const beforeInvalid = fs.readFileSync(kitsPath, "utf8");
        await receive({ type: "save", kits: [{ ...saved[0], qmakePath: path.join(storage, "missing-qmake.exe") }] });
        assert.equal(messages.at(-1).type, "error");
        assert.equal(fs.readFileSync(kitsPath, "utf8"), beforeInvalid);
        await receive({ type: "discover" });
        assert.equal(messages.at(-1).type, "discovered");
        assert(messages.at(-1).kits.length >= 4);
        const uiTest = new Promise((resolve, reject) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => reject(new Error("Kit settings form interaction timeout")), 15000);
            uiResult = message => message.passed ? resolve() : reject(new Error(message.error));
        });
        const nonce = panel.webview.html.match(/nonce="([^"]+)"/)[1];
        const script = fs.readFileSync(path.resolve(__dirname, "../media/kit-settings.js"), "utf8").replace("const vscode = acquireVsCodeApi();", "const vscode = acquireVsCodeApi(); globalThis.qaApi = vscode;");
        const exercise = `
            let started = false;
            const el = id => document.getElementById(id);
            const input = (id, value) => { el(id).value = value; el(id).dispatchEvent(new Event('input', { bubbles: true })); };
            window.addEventListener('message', event => {
                try {
                    if (event.data.type === 'kits' && !started) {
                        started = true;
                        const first = el('kits').value;
                        const count = el('kits').options.length;
                        input('name', 'UI saved Qt kit');
                        input('qmakeArguments', 'CONFIG+=one two');
                        input('environment', 'QA_FORM=value with space');
                        el('duplicate').click();
                        if (el('name').value !== 'UI saved Qt kit (복사)') { throw new Error('Duplicate lost draft name'); }
                        if (el('environment').value !== 'QA_FORM=value with space') { throw new Error('Duplicate lost draft environment'); }
                        el('remove').click();
                        if (el('kits').options.length !== count) { throw new Error('Remove did not update the list'); }
                        el('kits').value = first;
                        el('kits').dispatchEvent(new Event('change'));
                        if (el('name').value !== 'UI saved Qt kit') { throw new Error('Switching kits lost draft edits'); }
                        el('settings').requestSubmit();
                    }
                    if (event.data.type === 'saved') {
                        if (el('message').textContent !== '저장했습니다.') { throw new Error('Save confirmation missing'); }
                        qaApi.postMessage({ type: 'qaResult', passed: true });
                    }
                    if (event.data.type === 'error') { throw new Error(event.data.message); }
                } catch (error) { qaApi.postMessage({ type: 'qaResult', passed: false, error: error.message }); }
            });`;
        panel.reveal();
        panel.webview.html = panel.webview.html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script nonce="${nonce}">${script}</script><script nonce="${nonce}">${exercise}</script>`);
        await uiTest;
        const fromForm = JSON.parse(fs.readFileSync(kitsPath, "utf8"));
        assert.equal(fromForm[0].name, "UI saved Qt kit");
        assert.deepEqual(fromForm[0].qmakeArguments, ["CONFIG+=one two"]);
        assert.equal(fromForm[0].environment.QA_FORM, "value with space");
        report.formEditDuplicateRemoveSave = true;
        const manifest = vscode.extensions.getExtension("ynlim.qt-pro-workbench").packageJSON;
        assert.equal(manifest.contributes.commands.find(command => command.command === "qtPro.build").icon.dark, "media/build.svg");
        assert.equal(manifest.contributes.commands.find(command => command.command === "qtPro.editKits").icon, "$(settings-gear)");
        report.passed = true;
        report.folderless = true;
        report.screenInitialized = true;
        report.kitSelectionUsesSavedSettings = true;
        report.invalidEditsLeaveFileIntact = true;
        report.buildUsesHammerIcon = true;
    } catch (error) {
        report.errors.push(String(error));
        throw error;
    } finally {
        clearTimeout(timeout);
        panel?.dispose();
        vscode.window.createWebviewPanel = originalCreate;
        vscode.window.showQuickPick = originalPick;
        if (originalContents) { fs.writeFileSync(kitsPath, originalContents); }
        fs.writeFileSync(path.join(__dirname, "kit-settings-results.json"), JSON.stringify(report, null, 4));
    }
};
