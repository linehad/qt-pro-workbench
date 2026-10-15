import * as path from "node:path";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { GitCommit, GitHistoryViewInfo } from "./XGitTypes";

export class TXGitHistoryView implements vscode.Disposable {
    private readonly panel: vscode.WebviewPanel;
    private readonly listeners: vscode.Disposable[] = [];
    private readonly commits = new Map<string, GitCommit>();
    private readonly messages = new Map<string, string>();
    private nextSkip = 0;
    private hasMore = false;
    private isLoading = false;
    private isDisposed = false;
    private selectionGeneration = 0;

    private html(): string {
        const webview = this.panel.webview;
        const nonce = randomBytes(16).toString("hex");
        const css = webview.asWebviewUri(vscode.Uri.joinPath(this.info.extensionUri, "media", "git-history.css"));
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.info.extensionUri, "media", "git-history.js"));
        const calendarScript = webview.asWebviewUri(vscode.Uri.joinPath(this.info.extensionUri, "media", "git-history-calendar.js"));
        const layoutScript = webview.asWebviewUri(vscode.Uri.joinPath(this.info.extensionUri, "media", "git-history-layout.js"));
        return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${css}"></head><body>
<main><header><h1 id="title">Git 이력 조회</h1><p id="path"></p></header>
<div class="toolbar"><input id="filter" type="search" aria-label="이력 검색" placeholder="제목·작성자·커밋·경로 검색"><label>시작 <span class="date-input"><input id="from" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" maxlength="10" aria-label="시작 날짜" title="클릭해 날짜 선택" aria-haspopup="dialog" aria-controls="calendar" aria-expanded="false"></span></label><label>끝 <span class="date-input"><input id="to" type="text" inputmode="numeric" placeholder="YYYY-MM-DD" maxlength="10" aria-label="끝 날짜" title="클릭해 날짜 선택" aria-haspopup="dialog" aria-controls="calendar" aria-expanded="false"></span></label><button id="refresh" type="button">새로고침</button></div>
<section id="commit-list" class="commit-list" aria-label="파일 커밋 목록"><table id="commits"><colgroup><col class="hash"><col class="action"><col class="author"><col class="date"><col></colgroup><thead><tr><th>커밋</th><th>작업</th><th>작성자</th><th>날짜</th><th>메시지</th></tr></thead><tbody id="rows"></tbody></table><p id="empty" hidden>이 파일의 Git 커밋 이력이 없습니다.</p></section>
<div class="list-footer"><span id="count"></span><button id="more" type="button" hidden>이전 이력 더 보기</button></div>
<div id="message-splitter" class="history-splitter" role="separator" aria-orientation="horizontal" aria-label="커밋 목록과 메시지 높이 조절" tabindex="0" title="드래그해 높이 조절 · 더블클릭해 기본 비율 복원"></div>
<section id="commit-detail" class="commit-detail" aria-label="선택한 커밋 설명"><div class="detail-heading"><strong id="selected">커밋을 선택하세요.</strong><span id="metadata"></span></div><pre id="message"></pre></section>
<div id="changes-splitter" class="history-splitter" role="separator" aria-orientation="horizontal" aria-label="메시지와 변경 파일 목록 높이 조절" tabindex="0" title="드래그해 높이 조절 · 더블클릭해 기본 비율 복원"></div>
<section id="changed-panel" class="changed-path" aria-label="변경된 파일"><div class="changed-heading">변경 파일 <strong id="change-count">0개</strong></div><div class="changed-table"><table><thead><tr><th>경로</th><th class="action">작업</th><th>이전 경로</th></tr></thead><tbody id="changes"></tbody></table></div></section>
<footer><span id="status" role="status" aria-live="polite">이력을 읽고 있습니다…</span><div class="actions"><button id="compare" type="button" disabled>수정 전 / 수정 후 비교</button><button id="working" type="button" disabled>현재 파일과 비교</button><button id="latest" type="button" disabled>최신 커밋과 비교</button><button id="revision" type="button" disabled>이 버전의 소스 보기</button></div></footer></main>
<div id="calendar" class="calendar" role="dialog" aria-label="날짜 선택" hidden><div class="calendar-heading"><button id="calendar-prev" type="button" aria-label="이전 달">‹</button><select id="calendar-year" aria-label="연도"></select><select id="calendar-month" aria-label="월"></select><button id="calendar-next" type="button" aria-label="다음 달">›</button></div><div class="calendar-weekdays" aria-hidden="true"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div><div id="calendar-days" class="calendar-days"></div><div class="calendar-footer"><button id="calendar-today" type="button">오늘</button><button id="calendar-clear" type="button">지우기</button><button id="calendar-close" type="button">닫기</button></div></div>
<script nonce="${nonce}" src="${layoutScript}"></script><script nonce="${nonce}" src="${calendarScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
    }

    private async post(message: unknown): Promise<void> { if (!this.isDisposed) { await this.panel.webview.postMessage(message); } }

    private async load(reset: boolean): Promise<void> {
        if (this.isLoading) { return; }
        this.isLoading = true;
        await this.post({ type: "loading", value: true });
        try {
            const page = await this.info.load(reset ? 0 : this.nextSkip);
            if (reset) { this.commits.clear(); this.messages.clear(); ++this.selectionGeneration; }
            for (const commit of page.commits) { this.commits.set(commit.hash, commit); }
            this.nextSkip = page.nextSkip; this.hasMore = page.hasMore;
            await this.post({ type: "history", file: this.info.file, repositoryRoot: page.repositoryRoot, isDirectory: this.info.isDirectory, commits: [...this.commits.values()], hasMore: this.hasMore, reset });
        } finally { this.isLoading = false; await this.post({ type: "loading", value: false }); }
    }

    private async select(commit: GitCommit): Promise<void> {
        const generation = ++this.selectionGeneration;
        const message = this.messages.get(commit.hash) ?? await this.info.message(commit.hash);
        this.messages.set(commit.hash, message);
        if (generation === this.selectionGeneration) { await this.post({ type: "detail", hash: commit.hash, message }); }
    }

    private async receive(message: { type?: string; hash?: string; action?: string; filePath?: string }): Promise<void> {
        try {
            if (message?.type === "ready") { await this.load(true); return; }
            if (message?.type === "refresh") { await this.load(true); return; }
            if (message?.type === "more") { if (this.hasMore) { await this.load(false); } return; }
            if (message?.type === "latest" && !this.info.isDirectory) {
                await this.info.openLatest(); await this.post({ type: "opened", action: "latest" }); return;
            }
            const commit = message?.hash ? this.commits.get(message.hash) : undefined;
            if (!commit) { throw new Error("이력 목록에 있는 커밋을 선택하세요."); }
            if (message.type === "select") { await this.select(commit); return; }
            const change = commit.changes?.find(item => item.filePath === message.filePath);
            if (message.filePath && !change) { throw new Error("변경 목록에 있는 파일을 선택하세요."); }
            if (this.info.isDirectory && !change) { throw new Error("변경 목록에서 비교할 파일을 선택하세요."); }
            if (message.type === "latest") {
                await this.info.openLatest(change?.filePath); await this.post({ type: "opened", action: "latest" }); return;
            }
            if (message.type !== "open") { return; }
            if (message.action !== "previous" && message.action !== "working") {
                if (message.action !== "revision") { throw new Error("지원하지 않는 이력 보기 동작입니다."); }
            }
            await this.info.open(change ? { ...commit, ...change } : commit, message.action);
            await this.post({ type: "opened", hash: commit.hash, action: message.action });
        } catch (error) { await this.post({ type: "error", message: (error as Error).message }); }
    }

    public constructor(private readonly info: GitHistoryViewInfo) {
        this.panel = vscode.window.createWebviewPanel("qtProFileHistory", `Git 이력 조회 · ${path.basename(info.file)}`, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(info.extensionUri, "media")] });
        this.listeners.push(this.panel.webview.onDidReceiveMessage(message => this.receive(message)));
        this.listeners.push(this.panel.onDidDispose(() => this.dispose()));
        this.panel.webview.html = this.html();
    }

    public reveal(): void { this.panel.reveal(this.panel.viewColumn); }

    public get viewColumn(): vscode.ViewColumn { return this.panel.viewColumn ?? vscode.ViewColumn.Active; }

    public dispose(): void {
        if (this.isDisposed) { return; }
        this.isDisposed = true;
        for (const listener of this.listeners) { listener.dispose(); }
        this.panel.dispose(); this.info.onDispose();
    }
}
