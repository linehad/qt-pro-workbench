(() => {
    const vscode = acquireVsCodeApi();
    const element = id => document.getElementById(id);
    let state;
    let dirty = false;
    let pending;
    let tab = document.body.dataset.tab || "build";
    let steps = [];
    let shadowDirectory = "";
    const textFields = ["buildDirectory", "qmakeArguments", "makeArguments", "cleanArguments", "buildEnvironment", "executable", "arguments", "workingDirectory", "runEnvironment", "startupCommands"];
    const notify = text => { element("message").textContent = text; };
    const active = set => set?.items.find(item => item.id === set.activeId);
    const context = () => JSON.stringify([state?.projectPath, state?.kitId, state?.configuration]);
    const setBusy = busy => {
        for (const control of document.querySelectorAll("input, textarea, select, button")) { control.disabled = busy; }
        element("settings").disabled = busy || !state?.kitId;
        if (!busy) {
            element("save").disabled = !state?.kitId;
            updateShadow();
            for (const section of ["build", "deploy", "run"]) {
                const count = state?.[section === "build" ? "builds" : section === "deploy" ? "deploys" : "runs"]?.items.length ?? 0;
                document.querySelector(`[data-section="${section}"][data-action="remove"]`).disabled = count <= 1;
            }
        }
    };
    const showTab = value => {
        tab = value;
        for (const name of ["build", "deploy", "run"]) {
            element(`panel-${name}`).hidden = name !== tab;
            element(`tab-${name}`).setAttribute("aria-selected", String(name === tab));
            element(`tab-${name}`).tabIndex = name === tab ? 0 : -1;
        }
        vscode.setState({ tab });
    };
    const updateShadow = () => {
        const disabled = state?.buildSystem !== "cmake" && !element("shadowBuild").checked;
        element("buildDirectory").disabled = disabled;
        document.querySelector('[data-browse="buildDirectory"]').disabled = disabled;
        if (disabled) { element("buildDirectory").placeholder = state?.projectPath?.replace(/[\\/][^\\/]+$/, "") ?? ""; }
        else { element("buildDirectory").placeholder = state?.buildSystem === "cmake" ? state.buildDirectory : "빌드 폴더 경로"; }
    };
    const updateSummaries = () => {
        if (!state) { return; }
        if (state.buildSystem === "cmake") {
            element("qmakeSummary").textContent = `CMake Configure: ${state.cmakePath} · ${state.configuration} ${element("qmakeArguments").value}`;
            element("makeSummary").textContent = `CMake Build: ${element("makeArguments").value}`;
            element("cleanSummary").textContent = `CMake Clean: --target clean ${element("cleanArguments").value}`;
            return;
        }
        element("qmakeSummary").textContent = `qmake: ${state.qmakePath} ${state.projectPath?.split(/[\\/]/).pop() ?? ""} CONFIG+=${active(state.builds)?.configuration ?? state.configuration} ${element("qmakeArguments").value}`;
        element("makeSummary").textContent = `Make: ${state.makePath} ${element("makeArguments").value}`;
        element("cleanSummary").textContent = `Make: ${state.makePath} ${element("cleanArguments").value}`;
    };
    const changed = () => { dirty = true; notify("저장되지 않은 변경 사항"); updateSummaries(); };
    const fillSelect = (id, items, selected, label, empty) => {
        const select = element(id); select.replaceChildren();
        if (empty) { const option = document.createElement("option"); option.value = ""; option.textContent = empty; select.append(option); }
        for (const item of items ?? []) { const option = document.createElement("option"); option.value = item.id ?? item.projectPath; option.textContent = label(item); select.append(option); }
        select.value = selected ?? "";
    };
    const renderSteps = () => {
        element("noDeploySteps").hidden = steps.length > 0;
        element("deploySteps").replaceChildren();
        for (const [index, step] of steps.entries()) {
            const box = document.createElement("section"); box.className = "box deploy-step";
            const heading = document.createElement("div"); heading.className = "step-heading";
            const title = document.createElement("strong"); title.textContent = `${index + 1}. 파일·폴더 복사`;
            const remove = document.createElement("button"); remove.textContent = "Remove";
            remove.addEventListener("click", () => { steps = steps.filter(item => item.id !== step.id); renderSteps(); changed(); });
            heading.append(title, remove); box.append(heading);
            const fields = document.createElement("div"); fields.className = "fields";
            for (const [field, labelText] of [["source", "원본 파일·폴더:"], ["destination", "대상 폴더:"]]) {
                const label = document.createElement("label"); label.textContent = labelText;
                const input = document.createElement("input"); input.id = `step-${step.id}-${field}`; input.value = step[field]; label.htmlFor = input.id;
                input.addEventListener("input", () => { step[field] = input.value; changed(); });
                const wrapper = document.createElement("div"); wrapper.className = "path";
                const browse = document.createElement("button"); browse.textContent = "Browse…";
                browse.addEventListener("click", () => vscode.postMessage({ type: "browse", field, id: step.id, context: context() }));
                wrapper.append(input, browse); fields.append(label, wrapper);
            }
            box.append(fields); element("deploySteps").append(box);
        }
    };
    const render = value => {
        state = value;
        fillSelect("project", state.projects, state.projectPath, item => item.name + (item.projectPath === state.activeProject ? " · 활성" : ""));
        fillSelect("kit", state.kits, state.kitId, item => item.name, "키트를 선택하세요");
        element("projectPath").textContent = state.projectPath ?? "";
        for (const section of ["build", "deploy", "run"]) {
            const set = state[section === "build" ? "builds" : section === "deploy" ? "deploys" : "runs"];
            fillSelect(`${section}Configuration`, set?.items, set?.activeId, item => item.name);
        }
        const build = active(state.builds);
        const run = active(state.runs);
        for (const field of textFields) { element(field).value = ""; }
        if (build) {
            element("shadowBuild").checked = build.settings.shadowBuild;
            for (const field of ["buildDirectory", "qmakeArguments", "makeArguments", "cleanArguments"]) { element(field).value = build.settings[field]; }
            shadowDirectory = build.settings.buildDirectory;
            if (state.buildSystem !== "cmake" && !build.settings.shadowBuild) { element("buildDirectory").value = state.projectPath.replace(/[\\/][^\\/]+$/, ""); }
            element("buildEnvironment").value = build.settings.environment;
        }
        if (run) {
            for (const field of ["executable", "arguments", "workingDirectory", "startupCommands"]) { element(field).value = run[field] ?? ""; }
            element("runEnvironment").value = run.environment ?? "";
            element("runInTerminal").checked = run.runInTerminal ?? false;
            element("executable").placeholder = run.kind === "custom" ? "실행 파일 경로를 지정하세요" : state.automaticExecutable || "자동 · 프로젝트 빌드 결과";
        }
        element("shadowLabel").hidden = element("shadowCheck").hidden = state.buildSystem === "cmake";
        for (const [id, cmake, qmake] of [["qmakeArguments", "추가 CMake 인수:", "추가 qmake 인수:"], ["makeArguments", "CMake 빌드 인수:", "make 인수:"], ["cleanArguments", "CMake 정리 인수:", "make 인수:"]]) {
            document.querySelector(`label[for="${id}"]`).textContent = state.buildSystem === "cmake" ? cmake : qmake;
        }
        steps = structuredClone(active(state.deploys)?.steps ?? []);
        renderSteps();
        element("automaticExecutable").textContent = state.automaticExecutable ? `프로젝트 빌드 결과: ${state.automaticExecutable}` : "프로젝트에 실행 파일이 여러 개면 Executable을 지정하세요.";
        element("debuggerPath").textContent = state.debuggerPath;
        element("empty").hidden = !!state.kitId;
        dirty = false; pending = undefined; setBusy(false); updateSummaries(); showTab(tab); notify("");
    };
    const draft = () => {
        if (!state?.kitId || !state.builds || !state.deploys || !state.runs) { return undefined; }
        return {
            projectPath: state.projectPath, kitId: state.kitId, configuration: state.configuration,
            buildId: state.builds.activeId, deployId: state.deploys.activeId, runId: state.runs.activeId,
            build: { shadowBuild: element("shadowBuild").checked, buildDirectory: state.buildSystem === "cmake" || element("shadowBuild").checked ? element("buildDirectory").value : shadowDirectory, qmakeArguments: element("qmakeArguments").value, makeArguments: element("makeArguments").value, cleanArguments: element("cleanArguments").value, environment: element("buildEnvironment").value },
            deploy: steps,
            run: { executable: element("executable").value, arguments: element("arguments").value, workingDirectory: element("workingDirectory").value, environment: element("runEnvironment").value, startupCommands: element("startupCommands").value, runInTerminal: element("runInTerminal").checked }
        };
    };
    const send = change => {
        if (pending) { return; }
        pending = crypto.randomUUID();
        const settings = dirty || change.field === "save" ? draft() : undefined;
        setBusy(true); vscode.postMessage({ type: "select", requestId: pending, change: { ...change, draft: settings } });
    };
    for (const button of document.querySelectorAll("[role=tab]")) {
        button.addEventListener("click", () => showTab(button.dataset.tab));
        button.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) { return; }
            const names = ["build", "deploy", "run"];
            const next = names[(names.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
            showTab(next); element(`tab-${next}`).focus(); event.preventDefault();
        });
    }
    element("settings").addEventListener("input", changed);
    element("shadowBuild").addEventListener("change", () => {
        if (element("shadowBuild").checked) { element("buildDirectory").value = shadowDirectory; }
        else { shadowDirectory = element("buildDirectory").value; element("buildDirectory").value = state.projectPath.replace(/[\\/][^\\/]+$/, ""); }
        updateShadow(); changed();
    });
    element("project").addEventListener("change", () => send({ field: "project", value: element("project").value }));
    element("kit").addEventListener("change", () => send({ field: "kit", value: element("kit").value }));
    element("manageKits").addEventListener("click", () => send({ field: "manageKits" }));
    for (const section of ["build", "deploy", "run"]) {
        element(`${section}Configuration`).addEventListener("change", () => send({ field: section, change: { action: "select", id: element(`${section}Configuration`).value } }));
    }
    for (const button of document.querySelectorAll("[data-action]")) {
        button.addEventListener("click", () => send({ field: button.dataset.section, change: { action: button.dataset.action, id: element(`${button.dataset.section}Configuration`).value } }));
    }
    for (const button of document.querySelectorAll("[data-browse]")) { button.addEventListener("click", () => vscode.postMessage({ type: "browse", field: button.dataset.browse, context: context() })); }
    element("resetWorkingDirectory").addEventListener("click", () => { element("workingDirectory").value = ""; changed(); });
    element("addDeployStep").addEventListener("click", () => { steps.push({ id: crypto.randomUUID(), source: "", destination: "" }); renderSteps(); changed(); });
    element("save").addEventListener("click", () => send({ field: "save" }));
    element("reload").addEventListener("click", () => { pending = crypto.randomUUID(); setBusy(true); vscode.postMessage({ type: "reload", requestId: pending }); });
    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "state") {
            if (pending && message.requestId !== pending) { return; }
            if (dirty && !pending) { return; }
            const wasPending = !!pending;
            render(message.state);
            if (wasPending) { notify("적용했습니다."); }
        }
        if (message.type === "tab") { showTab(message.tab); }
        if (message.type === "path") {
            if (message.context !== context()) { return; }
            if (message.id) { const step = steps.find(item => item.id === message.id); if (!step) { return; } step[message.field] = message.value; renderSteps(); }
            else { element(message.field).value = message.value; }
            changed();
        }
        if (message.type === "error") { pending = undefined; setBusy(false); notify(message.message); }
    });
    showTab(tab); setBusy(true); vscode.postMessage({ type: "ready" });
})();
