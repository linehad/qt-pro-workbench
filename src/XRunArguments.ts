export function parseRunArguments(commandLine: string): string[] {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    let started = false;
    for (let index = 0; index < commandLine.length; index++) {
        const character = commandLine[index];
        if (/\s/.test(character) && !quoted) {
            if (started) { values.push(value); value = ""; started = false; }
            continue;
        }
        started = true;
        let slashes = 0;
        while (commandLine[index] === "\\") { slashes++; index++; }
        if (commandLine[index] === '"') {
            value += "\\".repeat(Math.floor(slashes / 2));
            if (slashes % 2 === 1) { value += '"'; continue; }
            if (quoted && commandLine[index + 1] === '"') { value += '"'; index++; continue; }
            quoted = !quoted;
            continue;
        }
        value += "\\".repeat(slashes);
        if (slashes > 0) { index--; continue; }
        if (index < commandLine.length) { value += commandLine[index]; }
    }
    if (quoted) { throw new Error("명령행 인수의 큰따옴표를 닫아 주세요."); }
    if (started) { values.push(value); }
    return values;
}

export function formatRunArguments(argumentsList: string[]): string {
    return argumentsList.map(value => {
        if (value && !/[\s"]/.test(value)) { return value; }
        return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
    }).join(" ");
}
