import * as childProcess from "node:child_process";
import * as vscode from "vscode";

interface ProcessLaunch {
    executable: string;
    argumentsList: string[];
    workingDirectory: string;
    environment: Record<string, string>;
    showWindow?: boolean;
}

export class TXProcessTerminal implements vscode.Pseudoterminal {
    private readonly output = new vscode.EventEmitter<string>();
    private readonly closed = new vscode.EventEmitter<number>();
    private readonly launch: ProcessLaunch;
    private process: childProcess.ChildProcessWithoutNullStreams | undefined;
    private complete!: (exitCode: number) => void;
    private isFinished = false;
    private input = "";

    private write(text: string): void { this.output.fire(text.replace(/\r?\n/g, "\r\n")); }

    private finish(exitCode: number): void {
        if (this.isFinished) { return; }
        this.isFinished = true;
        this.write(`\nProcess finished with exit code ${exitCode}.\n`);
        this.complete(exitCode);
        this.closed.fire(exitCode);
    }

    private stop(): void {
        const processId = this.process?.pid;
        if (!processId || this.isFinished) { this.finish(1); return; }
        if (process.platform === "win32") {
            const stopProcess = childProcess.spawn("taskkill.exe", ["/PID", String(processId), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            stopProcess.on("error", () => this.process?.kill());
        } else { this.process?.kill("SIGTERM"); }
    }

    public readonly onDidWrite = this.output.event;
    public readonly onDidClose = this.closed.event;
    public readonly completion: Promise<number>;

    public constructor(launch: ProcessLaunch) {
        this.launch = launch;
        this.completion = new Promise(resolve => { this.complete = resolve; });
    }

    public open(): void {
        const launch = this.launch;
        this.write(`${launch.executable}\nWorking directory: ${launch.workingDirectory}\n\n`);
        try {
            this.process = childProcess.spawn(launch.executable, launch.argumentsList, {
                cwd: launch.workingDirectory, env: launch.environment, windowsHide: !launch.showWindow, shell: false
            });
            this.process.stdout.setEncoding("utf8"); this.process.stderr.setEncoding("utf8");
            this.process.stdout.on("data", text => this.write(text));
            this.process.stderr.on("data", text => this.write(text));
            this.process.on("error", error => { this.write(String(error)); this.finish(1); });
            this.process.on("close", code => this.finish(code ?? 1));
        } catch (error) { this.write(String(error)); this.finish(1); }
    }

    public close(): void { this.stop(); }

    public handleInput(data: string): void {
        for (const character of data) {
            if (character === "\u0003") { this.stop(); return; }
            if (character === "\r") { this.process?.stdin.write(this.input + "\n"); this.input = ""; this.write("\n"); continue; }
            if (character === "\u007f") { this.input = this.input.slice(0, -1); this.output.fire("\b \b"); continue; }
            this.input += character; this.output.fire(character);
        }
    }
}
