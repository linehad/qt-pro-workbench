import { spawn } from "node:child_process";
import { parseRunArguments } from "./XRunArguments";

// QtSDK's Windows GDB 7.2 must inherit the environment before it starts.
// Its `set environment` command does not update the launched process environment.
const executable = process.argv[2];
const command = process.argv.slice(3);
let argumentsList = command;
if (executable && command.length === 1) {
    let text = command[0].trim();
    const prefix = text.startsWith(`"${executable}"`) ? `"${executable}"` : executable;
    if (text.startsWith(prefix)) { text = text.slice(prefix.length).trim(); }
    argumentsList = parseRunArguments(text);
} else if (command[0] === executable) { argumentsList = command.slice(1); }
if (!executable) {
    process.stderr.write("Qt Pro: GDB 실행 경로가 없습니다.\n");
    process.exitCode = 1;
} else {
    const debuggerProcess = spawn(executable, argumentsList, { stdio: "inherit", shell: false, windowsHide: true, env: process.env });
    debuggerProcess.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
    debuggerProcess.on("exit", code => { process.exitCode = code ?? 1; });
    process.on("SIGTERM", () => debuggerProcess.kill());
    process.on("SIGINT", () => debuggerProcess.kill());
}
