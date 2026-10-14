(() => {
    const vscode = acquireVsCodeApi();
    const fields = ["executable", "arguments", "workingDirectory"];
    const element = id => document.getElementById(id);
    let defaultExecutable = "";
    let automaticExecutable = true;
    let selected;
    let count = 0;
    let isDirty = false;
    let isBusy = false;
    const notify = text => { element("message").textContent = text; };
    const setBusy = busy => {
        isBusy = busy;
        document.querySelectorAll("button, input, select").forEach(item => { item.disabled = busy; });
        element("remove").disabled = busy || count < 2;
    };
    const draft = () => {
        const settings = Object.fromEntries(fields.map(field => [field, element(field).value]));
        if (automaticExecutable) { settings.executable = ""; }
        return settings;
    };
    const send = (type, extra = {}) => {
        if (!selected || isBusy) { return; }
        const settings = draft();
        setBusy(true);
        vscode.postMessage({ type, id: selected.id, settings, ...extra });
    };
    const fill = settings => {
        for (const field of fields) { element(field).value = settings[field]; }
        automaticExecutable = selected.kind === "project" && !settings.executable;
        if (automaticExecutable) { element("executable").value = defaultExecutable; }
        element("clearExecutable").hidden = selected.kind !== "project";
    };
    const dirty = () => { isDirty = true; notify("저장되지 않은 변경 사항"); };
    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "settings") {
            if (message.refresh && (isDirty || isBusy)) { return; }
            element("project").textContent = message.project;
            element("kit").textContent = message.kit;
            defaultExecutable = message.defaultExecutable;
            const configurations = message.configurations;
            selected = configurations.items.find(item => item.id === configurations.activeId);
            count = configurations.items.length;
            const options = configurations.items.map(item => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; return option; });
            element("activeConfiguration").replaceChildren(...options);
            element("activeConfiguration").value = selected.id;
            fill(selected);
            isDirty = false;
            setBusy(false);
            notify(message.status);
        }
        if (message.type === "path") {
            setBusy(false);
            if (message.id !== selected?.id || !message.value) { return; }
            if (!fields.includes(message.field)) { return; }
            element(message.field).value = message.value;
            if (message.field === "executable") { automaticExecutable = false; }
            dirty();
        }
        if (message.type === "error") {
            setBusy(false);
            element("activeConfiguration").value = selected?.id ?? "";
            notify(message.message);
        }
        if (message.type === "addOnOpen") { send("add"); }
    });
    element("activeConfiguration").addEventListener("change", event => send("select", { targetId: event.target.value }));
    for (const type of ["add", "remove", "rename", "clone", "browseExecutable", "browseDirectory"]) { element(type).addEventListener("click", () => send(type)); }
    element("settings").addEventListener("input", dirty);
    element("executable").addEventListener("input", () => { automaticExecutable = selected.kind === "project" && !element("executable").value.trim(); });
    element("settings").addEventListener("submit", event => { event.preventDefault(); send("save"); });
    element("clearExecutable").addEventListener("click", () => { automaticExecutable = true; element("executable").value = defaultExecutable; dirty(); });
    element("reset").addEventListener("click", () => { fill({ executable: "", arguments: "", workingDirectory: "" }); dirty(); });
    setBusy(true);
    vscode.postMessage({ type: "ready" });
})();
