const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
    const report = { passed: false, tasks: [], errors: [] };
    const originalPick = vscode.window.showQuickPick;
    const originalError = vscode.window.showErrorMessage;
    const originalCreate = vscode.window.createWebviewPanel;
    const listener = vscode.tasks.onDidStartTask(event => { if (event.execution.task.source === "Qt Pro") { report.tasks.push(event.execution.task.name); } });
    let panel;
    let uiResult;
    let timeout;
    let root;
    vscode.window.showErrorMessage = async message => { report.errors.push(message); return undefined; };
    vscode.window.showQuickPick = async choices => (await Promise.resolve(choices)).find(item => item.kit?.name.startsWith("Qt 4.8.1"));
    try {
        await vscode.extensions.getExtension("ynlim.qt-pro-workbench").activate();
        const { discoverKits } = require("../out/XKitStore");
        const { loadBuildConfigurations } = require("../out/XBuildSettings");
        const { makeBuildPlan } = require("../out/XBuildPlan");
        const kit = discoverKits()[0];
        root = fs.mkdtempSync(path.join(__dirname, "build-settings-qa-"));
        const project = path.join(root, "app.pro");
        fs.writeFileSync(project, 'TEMPLATE = app\nTARGET = SettingsSmoke\nQT = core\nCONFIG += console\nSOURCES = main.cpp\n');
        fs.writeFileSync(path.join(root, "main.cpp"), "int main() { return 0; }\n");
        await vscode.commands.executeCommand("qtPro.openProject", vscode.Uri.file(project));
        await vscode.commands.executeCommand("qtPro.selectKit");
        let ready;
        const initialized = new Promise(resolve => { ready = resolve; });
        vscode.window.createWebviewPanel = (...args) => {
            panel = originalCreate(...args);
            const post = panel.webview.postMessage.bind(panel.webview);
            const onMessage = panel.webview.onDidReceiveMessage.bind(panel.webview);
            panel.webview.postMessage = message => { if (message.type === "state") { ready(message); } return post(message); };
            panel.webview.onDidReceiveMessage = callback => onMessage(message => { if (message.type === "qaResult") { uiResult?.(message); } return callback(message); });
            return panel;
        };
        await vscode.commands.executeCommand("qtPro.configureBuild", vscode.Uri.file(project));
        const settingsMessage = await Promise.race([initialized, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Build settings did not initialize")), 15000); })]);
        clearTimeout(timeout);
        assert.equal(settingsMessage.state.builds.items.find(item => item.id === settingsMessage.state.builds.activeId).settings.shadowBuild, false);
        assert.equal(path.dirname(settingsMessage.state.projectPath).toLowerCase(), root.toLowerCase());
        const uiTest = new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Build settings form timeout")), 15000);
            uiResult = message => message.passed ? resolve() : reject(new Error(message.error));
        });
        const nonce = panel.webview.html.match(/nonce="([^"]+)"/)[1];
        const script = fs.readFileSync(path.resolve(__dirname, "../media/project-selection.js"), "utf8").replace("const vscode = acquireVsCodeApi();", "const vscode = acquireVsCodeApi(); globalThis.qaApi = vscode;");
        const exercise = `let started=false; const el=id=>document.getElementById(id); window.addEventListener('message', event=>{ try {
            if(event.data.type==='state'&&!started){ started=true; if(!el('buildDirectory').disabled){throw new Error('Default must be in-source');} el('shadowBuild').checked=true; el('shadowBuild').dispatchEvent(new Event('change')); if(el('buildDirectory').disabled){throw new Error('Shadow folder must be editable');} el('buildDirectory').value='shadow'; el('buildDirectory').dispatchEvent(new Event('input',{bubbles:true})); el('makeArguments').value='-j2'; el('save').click(); }
            else if(event.data.type==='state'&&started){qaApi.postMessage({type:'qaResult',passed:true});}
            if(event.data.type==='error'){throw new Error(event.data.message);}
        } catch(error){qaApi.postMessage({type:'qaResult',passed:false,error:error.message});} });`;
        panel.webview.html = panel.webview.html.replace(/<script nonce="[^"]+" src="[^"]+"><\/script>/, `<script nonce="${nonce}">${script}</script><script nonce="${nonce}">${exercise}</script>`);
        await uiTest;
        clearTimeout(timeout);
        const storage = path.join(process.env.LOCALAPPDATA, "Temp/qt-pro-build-settings-qa/User/globalStorage/ynlim.qt-pro-workbench");
        const { loadConfigurations } = require("../out/XConfigurationStore");
        const { validateBuildConfigurations } = require("../out/XConfigurations");
        const preferences = { configuration: "debug", buildConfigurations: loadBuildConfigurations(storage, project), buildProfiles: loadConfigurations(storage, project, "build-profiles", validateBuildConfigurations) };
        const plan = makeBuildPlan(project, kit, preferences, storage);
        assert.equal(plan.buildDirectory.toLowerCase(), path.join(root, "shadow").toLowerCase());
        assert.deepEqual(plan.makeArguments, ["-j2"]);
        assert.equal(await vscode.commands.executeCommand("qtPro.build", vscode.Uri.file(project)), true);
        assert(fs.existsSync(path.join(root, "shadow/Makefile")));
        assert(!fs.existsSync(path.join(root, "Makefile")));
        assert.equal(await vscode.commands.executeCommand("qtPro.build", vscode.Uri.file(project)), true);
        assert.deepEqual(report.tasks, ["app.pro: qmake", "app.pro: build", "app.pro: build"]);
        assert.equal(await vscode.commands.executeCommand("qtPro.clean", vscode.Uri.file(project)), true);
        assert(!fs.existsSync(path.join(root, "shadow/debug/main.o")));
        assert.equal(await vscode.commands.executeCommand("qtPro.rebuild", vscode.Uri.file(project)), true);
        assert(fs.existsSync(path.join(root, "shadow/debug/main.o")));
        assert.deepEqual(report.errors, []);
        report.passed = true;
        report.independentSettingsScreen = true;
        report.shadowOnlyWhenEnabled = true;
        report.repeatedBuildSkipsQmake = true;
    } catch (error) { report.error = String(error); throw error; }
    finally {
        clearTimeout(timeout); panel?.dispose(); listener.dispose();
        vscode.window.showQuickPick = originalPick; vscode.window.showErrorMessage = originalError; vscode.window.createWebviewPanel = originalCreate;
        fs.writeFileSync(path.join(__dirname, "build-settings-results.json"), JSON.stringify(report, null, 4));
    }
};
