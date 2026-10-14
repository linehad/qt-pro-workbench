(() => {
    const vscode = acquireVsCodeApi();
    const element = id => document.getElementById(id);
    const fields = ["qmakeArguments", "makeArguments", "cleanArguments", "environment"];
    let projectDirectory = "";
    let shadowDirectory = "";
    let suggestedDirectory = "";
    const notify = message => { element("message").textContent = message; };
    const showDirectory = () => {
        const shadow = element("shadowBuild").checked;
        element("buildDirectory").value = shadow ? shadowDirectory || suggestedDirectory : projectDirectory;
        element("buildDirectory").disabled = !shadow;
        element("browseDirectory").disabled = !shadow;
    };
    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "settings") {
            element("project").textContent = message.project;
            element("kit").textContent = message.kit;
            projectDirectory = message.projectDirectory;
            suggestedDirectory = message.suggestedDirectory;
            shadowDirectory = message.settings.buildDirectory;
            element("shadowBuild").checked = message.settings.shadowBuild;
            for (const field of fields) { element(field).value = message.settings[field]; }
            showDirectory();
        }
        if (message.type === "path") { shadowDirectory = message.value; showDirectory(); notify("저장되지 않은 변경 사항"); }
        if (message.type === "saved") { notify("저장했습니다."); }
        if (message.type === "error") { notify(message.message); }
    });
    element("shadowBuild").addEventListener("change", showDirectory);
    element("buildDirectory").addEventListener("input", () => { shadowDirectory = element("buildDirectory").value; });
    element("settings").addEventListener("input", () => notify("저장되지 않은 변경 사항"));
    element("browseDirectory").addEventListener("click", () => vscode.postMessage({ type: "browseDirectory" }));
    element("settings").addEventListener("submit", event => {
        event.preventDefault();
        const settings = Object.fromEntries(fields.map(field => [field, element(field).value]));
        settings.shadowBuild = element("shadowBuild").checked;
        settings.buildDirectory = settings.shadowBuild ? element("buildDirectory").value : shadowDirectory;
        vscode.postMessage({ type: "save", settings });
    });
    vscode.postMessage({ type: "ready" });
})();
