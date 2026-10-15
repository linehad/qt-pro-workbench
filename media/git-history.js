(() => {
    const vscode = acquireVsCodeApi();
    const element = id => document.getElementById(id);
    const saved = vscode.getState() || {};
    const actions = { A: "추가", M: "수정", D: "삭제", R: "이름 변경", C: "복사", T: "종류 변경" };
    let commits = [];
    let selected = null;
    let isLoading = false;
    let hasMore = false;
    let isDirectory = false;
    let selectedPath = null;
    let paneRatios = saved.paneRatios;
    element("filter").value = saved.filter || "";
    element("from").value = saved.from || "";
    element("to").value = saved.to || "";

    const status = (text, isError = false) => { element("status").textContent = text; element("status").classList.toggle("error", isError); };
    const dateValue = id => window.GitHistoryCalendar.value(element(id));
    const remember = () => vscode.setState({ filter: element("filter").value, from: dateValue("from"), to: dateValue("to"), hash: selected?.hash, paneRatios });
    window.GitHistoryLayout.initialize(paneRatios, ratios => { paneRatios = ratios; remember(); });
    const changeName = commit => actions[commit.change?.[0]] || commit.change || "";
    const dateLabel = commit => new Date(commit.date).toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    const dateKey = commit => { const date = new Date(commit.date); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); };
    const cell = (row, text, className = "") => { const td = document.createElement("td"); td.textContent = text; td.title = text; td.className = className; row.append(td); };
    const updateButtons = () => {
        for (const id of ["compare", "working", "revision"]) { element(id).disabled = !selected; }
        element("more").hidden = !hasMore;
        element("more").disabled = isLoading;
        element("refresh").disabled = isLoading;
        element("latest").disabled = isDirectory && !selectedPath;
    };
    const open = action => { if (selected) { vscode.postMessage({ type: "open", hash: selected.hash, action, filePath: selectedPath }); status("화면을 열고 있습니다…"); } };

    const renderChanges = commit => {
        element("changes").replaceChildren();
        const changes = commit.changes || [{ filePath: commit.filePath, previousPath: commit.previousPath, change: commit.change }];
        element("change-count").textContent = `${changes.length}개`;
        selectedPath = changes[0]?.filePath || null;
        for (const change of changes) {
            const row = document.createElement("tr");
            row.dataset.path = change.filePath; row.classList.toggle("selected", selectedPath === change.filePath);
            const pathCell = document.createElement("td");
            const button = document.createElement("button"); button.type = "button"; button.className = "path-link"; button.textContent = change.filePath;
            button.addEventListener("click", () => { selectedPath = change.filePath; for (const item of element("changes").children) { item.classList.toggle("selected", item.dataset.path === selectedPath); } open("previous"); });
            pathCell.append(button); row.append(pathCell);
            cell(row, changeName(change)); cell(row, /^[RC]/.test(change.change || "") ? change.previousPath || "" : "");
            element("changes").append(row);
        }
    };

    const select = commit => {
        selected = commit;
        for (const row of element("rows").children) { row.classList.toggle("selected", row.dataset.hash === commit.hash); row.setAttribute("aria-selected", String(row.dataset.hash === commit.hash)); }
        element("selected").textContent = commit.hash;
        element("metadata").textContent = `${commit.author} · ${dateLabel(commit)}`;
        element("message").textContent = commit.subject;
        renderChanges(commit);
        updateButtons(); remember(); status("더블클릭 또는 수정 전 / 수정 후 비교로 변경 내용을 엽니다.");
        vscode.postMessage({ type: "select", hash: commit.hash });
    };

    const render = () => {
        const filter = element("filter").value.toLocaleLowerCase();
        const from = dateValue("from");
        const to = dateValue("to");
        const visible = commits.filter(commit => {
            const date = dateKey(commit);
            if (from && date < from) { return false; }
            if (to && date > to) { return false; }
            return [commit.subject, commit.author, commit.hash, commit.filePath, commit.previousPath, ...(commit.changes || []).flatMap(change => [change.filePath, change.previousPath])].join(" ").toLocaleLowerCase().includes(filter);
        });
        if (!visible.some(commit => commit.hash === selected?.hash)) {
            if (visible.length) { select(visible[0]); }
            else {
                selected = null; selectedPath = null; element("changes").replaceChildren(); element("change-count").textContent = "0개";
                element("selected").textContent = "커밋을 선택하세요."; element("metadata").textContent = ""; element("message").textContent = "";
            }
        }
        element("rows").replaceChildren();
        for (const commit of visible) {
            const row = document.createElement("tr"); row.tabIndex = 0; row.dataset.hash = commit.hash; row.setAttribute("aria-selected", String(selected?.hash === commit.hash));
            row.classList.toggle("selected", selected?.hash === commit.hash);
            cell(row, commit.hash.slice(0, 8), "hash"); cell(row, isDirectory ? `${commit.changes?.length || 0}개 파일` : changeName(commit)); cell(row, commit.author); cell(row, dateLabel(commit)); cell(row, commit.subject);
            row.addEventListener("click", () => select(commit));
            row.addEventListener("dblclick", () => { select(commit); if ((commit.changes?.length || 0) > 1) { status("아래 변경 경로에서 비교할 파일을 선택하세요."); } else { open("previous"); } });
            row.addEventListener("keydown", event => {
                if (event.key === "Enter") { event.preventDefault(); select(commit); open("previous"); }
                if (event.key === "ArrowDown") { event.preventDefault(); const next = row.nextElementSibling; if (next) { next.focus(); next.click(); } }
                if (event.key === "ArrowUp") { event.preventDefault(); const previous = row.previousElementSibling; if (previous) { previous.focus(); previous.click(); } }
            });
            element("rows").append(row);
        }
        element("count").textContent = `표시 ${visible.length}개 / 불러온 이력 ${commits.length}개`;
        element("empty").hidden = visible.length !== 0;
        let emptyText = isDirectory ? "이 폴더의 Git 커밋 이력이 없습니다." : "이 파일의 Git 커밋 이력이 없습니다.";
        if (commits.length) { emptyText = hasMore ? "검색 조건에 맞는 이력이 없습니다. 이전 이력을 더 불러올 수 있습니다." : "검색 조건에 맞는 이력이 없습니다."; }
        element("empty").textContent = emptyText;
        updateButtons(); remember();
    };

    window.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "history") {
            commits = message.commits; hasMore = message.hasMore; isDirectory = !!message.isDirectory;
            element("title").textContent = `Git 이력 조회 · ${message.file.split(/[\\/]/).at(-1)}`;
            element("path").textContent = `${isDirectory ? "폴더" : "파일"}: ${message.file}`; element("path").title = `${message.file}\n${message.repositoryRoot}`;
            if (message.reset) {
                selected = commits.find(commit => commit.hash === saved.hash) || commits[0] || null;
                element("changes").replaceChildren(); element("change-count").textContent = "0개"; selectedPath = null;
                if (selected) { select(selected); } else { element("selected").textContent = "커밋 이력이 없습니다."; element("message").textContent = ""; element("metadata").textContent = ""; }
            }
            render();
        }
        if (message.type === "detail" && message.hash === selected?.hash) { element("message").textContent = message.message; }
        if (message.type === "loading") {
            isLoading = message.value; updateButtons();
            if (isLoading) { status("이력을 읽고 있습니다…"); }
            else if (!element("status").classList.contains("error")) { status(selected ? "커밋을 더블클릭하거나 파일 경로를 누르면 수정 전 / 수정 후를 비교합니다." : ""); }
        }
        if (message.type === "opened") { status(message.action === "revision" ? "이 버전의 소스를 열었습니다." : "수정 전 / 수정 후 비교 화면을 열었습니다."); }
        if (message.type === "error") { status(message.message, true); }
    });
    for (const id of ["filter", "from", "to"]) { element(id).addEventListener("input", render); }
    element("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
    element("more").addEventListener("click", () => vscode.postMessage({ type: "more" }));
    element("compare").addEventListener("click", () => open("previous"));
    element("latest").addEventListener("click", () => { vscode.postMessage({ type: "latest", hash: selected?.hash, filePath: selectedPath }); status("최신 커밋과 현재 파일을 비교하고 있습니다…"); });
    element("working").addEventListener("click", () => open("working"));
    element("revision").addEventListener("click", () => open("revision"));
    vscode.postMessage({ type: "ready" });
})();
