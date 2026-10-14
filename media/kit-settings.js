(() => {
    const vscode = acquireVsCodeApi();
    const element = id => document.getElementById(id);
    const basicFields = ["name", "qmakePath", "compilerDirectory", "makePath", "debuggerPath", "spec", "cmakePath", "cmakeGenerator", "cmakeMakePath", "cmakePlatform", "cmakeToolchainFile", "cCompilerPath", "cxxCompilerPath", "debuggerType"];
    const extraFields = ["qmakeArguments", "makeArguments", "environment"];
    let kits = [];
    let selectedId;
    let debuggerDefaults = {};
    const current = () => kits.find(kit => kit.id === selectedId);
    const notify = message => { element("message").textContent = message; };
    const formatArguments = values => values.map(value => value && !/[\s"]/.test(value) ? value : '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"').join(" ");
    const draft = kit => ({ ...kit, qmakeArgumentsText: (kit.qmakeArguments ?? []).join("\n"), makeArgumentsText: formatArguments(kit.makeArguments ?? []), environmentText: Object.entries(kit.environment ?? {}).map(([name, value]) => `${name}=${value}`).join("\n") });
    const busy = value => {
        element("editor").disabled = value;
        for (const id of ["kits", "add", "duplicate", "remove", "discover", "save", "reload"]) { element(id).disabled = value; }
        if (!value) {
            element("duplicate").disabled = !current();
            element("remove").disabled = !current();
        }
    };
    const renderList = () => {
        element("kits").replaceChildren();
        for (const kit of kits) {
            const option = document.createElement("option");
            option.value = kit.id;
            option.textContent = kit.name || "이름 없는 키트";
            element("kits").append(option);
        }
        element("kits").value = selectedId ?? "";
    };
    const fill = () => {
        const kit = current();
        element("editor").hidden = !kit;
        element("empty").hidden = !!kit;
        element("duplicate").disabled = !kit;
        element("remove").disabled = !kit;
        if (!kit) { return; }
        for (const field of basicFields) { element(field).value = kit[field] ?? ""; }
        element("debuggerType").value = kit.debuggerType || "gdb";
        for (const field of extraFields) { element(field).value = kit[`${field}Text`]; }
        const defaultDebugger = debuggerDefaults[kit.id];
        element("debuggerPath").placeholder = defaultDebugger ?? "자동";
        element("debuggerPathHint").textContent = defaultDebugger ? `비우면 ${defaultDebugger}` : "비우면 키트에 맞는 기본 GDB를 사용합니다.";
    };
    const add = kit => {
        kits.push(draft(kit));
        selectedId = kit.id;
        renderList(); fill();
        notify("저장되지 않은 변경 사항");
        element("name").focus();
    };
    const lines = text => text.split(/\r?\n/).filter(line => line.length > 0);
    const environment = text => {
        const result = Object.create(null);
        const names = new Set();
        for (const line of lines(text)) {
            const separator = line.indexOf("=");
            if (separator < 1) { throw new Error("환경변수는 NAME=value 형식으로 입력하세요."); }
            const name = line.slice(0, separator).trim();
            if (names.has(name.toUpperCase())) { throw new Error(`환경변수가 중복됩니다: ${name}`); }
            names.add(name.toUpperCase());
            result[name] = line.slice(separator + 1);
        }
        return Object.keys(result).length ? result : undefined;
    };
    const settings = kit => {
        const result = { id: kit.id };
        for (const field of basicFields) { result[field] = kit[field] ?? ""; }
        const qmakeArguments = lines(kit.qmakeArgumentsText);
        result.qmakeArguments = qmakeArguments.length ? qmakeArguments : undefined;
        result.makeArguments = kit.makeArgumentsText.trim() || undefined;
        result.environment = environment(kit.environmentText);
        return result;
    };
    element("kits").addEventListener("change", event => { selectedId = event.target.value; fill(); });
    element("settings").addEventListener("input", event => {
        const kit = current();
        if (!kit) { return; }
        const field = event.target.id;
        if (basicFields.includes(field)) { kit[field] = event.target.value; }
        if (extraFields.includes(field)) { kit[`${field}Text`] = event.target.value; }
        if (field === "name") { renderList(); }
        if (field === "compilerDirectory") { delete debuggerDefaults[kit.id]; element("debuggerPath").placeholder = "자동"; element("debuggerPathHint").textContent = "비우면 키트에 맞는 기본 GDB를 사용합니다."; }
        notify("저장되지 않은 변경 사항");
    });
    element("add").addEventListener("click", () => add({ id: crypto.randomUUID(), name: "새 키트", spec: "win32-g++" }));
    element("duplicate").addEventListener("click", () => {
        const kit = current();
        if (!kit) { return; }
        // Preserve unsaved text, including fields that are not yet valid.
        const copy = { ...kit, id: crypto.randomUUID(), name: `${kit.name} (복사)` };
        kits.push(copy); selectedId = copy.id; renderList(); fill(); notify("저장되지 않은 변경 사항");
    });
    element("remove").addEventListener("click", () => {
        const index = kits.findIndex(kit => kit.id === selectedId);
        if (index < 0) { return; }
        kits.splice(index, 1);
        selectedId = kits[Math.min(index, kits.length - 1)]?.id;
        renderList(); fill(); notify("저장하면 이 키트가 목록에서 삭제됩니다.");
    });
    for (const type of ["discover", "reload"]) { element(type).addEventListener("click", () => { busy(true); vscode.postMessage({ type }); }); }
    for (const button of document.querySelectorAll("[data-browse]")) {
        button.addEventListener("click", () => vscode.postMessage({ type: "browse", kitId: selectedId, field: button.dataset.browse }));
    }
    element("settings").addEventListener("submit", event => {
        event.preventDefault();
        try { const values = kits.map(settings); busy(true); vscode.postMessage({ type: "save", kits: values }); }
        catch (error) { notify(error.message); }
    });
    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "kits" || message.type === "saved") {
            kits = message.kits.map(draft);
            debuggerDefaults = message.debuggerDefaults ?? {};
            if (!current()) { selectedId = message.selectedKitId; }
            if (!current()) { selectedId = kits[0]?.id; }
            busy(false); renderList(); fill();
            notify(message.type === "saved" ? "저장했습니다." : "");
        }
        if (message.type === "discovered") {
            const canonical = value => value.replaceAll("\\", "/").toLowerCase();
            let added = 0;
            for (const kit of message.kits) {
                if (kits.some(item => item.id === kit.id || kit.qmakePath && canonical(item.qmakePath ?? "") === canonical(kit.qmakePath))) { continue; }
                if (kits.some(item => item.id === kit.id)) { kit.id = crypto.randomUUID(); }
                kits.push(draft(kit)); added++;
            }
            if (!current()) { selectedId = kits[0]?.id; }
            busy(false); renderList(); fill();
            notify(added ? `${added}개 키트를 추가했습니다. 저장을 눌러 적용하세요.` : "추가로 발견된 Qt / CMake 키트가 없습니다.");
        }
        if (message.type === "path") {
            const kit = kits.find(item => item.id === message.kitId);
            if (!kit) { return; }
            kit[message.field] = message.value;
            for (const [field, value] of Object.entries(message.defaults ?? {})) { if (!kit[field]) { kit[field] = value; } }
            if (message.field === "compilerDirectory") { delete debuggerDefaults[kit.id]; }
            if (current() === kit) { fill(); }
            notify("저장되지 않은 변경 사항");
        }
        if (message.type === "error") { busy(false); notify(message.message); }
    });
    busy(true);
    vscode.postMessage({ type: "ready" });
})();
