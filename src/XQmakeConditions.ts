import type { ConditionState } from "./XQmakeTypes";

export function combineConditions(left: ConditionState, right: ConditionState): ConditionState {
    if (left === false || right === false) { return false; }
    if (left === undefined || right === undefined) { return undefined; }
    return true;
}

export function evaluateCondition(expression: string, variables: Map<string, string[]>): ConditionState {
    const condition = expression.trim();
    if (!condition) { return true; }
    if (condition.startsWith("!")) {
        const result = evaluateCondition(condition.slice(1), variables);
        return result === undefined ? undefined : !result;
    }
    const empty = condition.match(/^isEmpty\(\s*([\w.]+)\s*\)$/);
    if (empty) { return variables.has(empty[1]) ? variables.get(empty[1])!.length === 0 : undefined; }
    const equals = condition.match(/^(?:equals|isEqual)\(\s*([\w.]+)\s*,\s*(.*?)\s*\)$/);
    if (!equals) { return undefined; }
    const values = variables.get(equals[1]);
    if (!values) { return undefined; }
    const expected = equals[2].replace(/^(["'])(.*)\1$/, "$2");
    if (expected.includes("$")) { return undefined; }
    return values.join(" ") === expected;
}

export function updateKnownValues(variables: Map<string, string[]>, assignment: { name: string; operator: string; values: string[]; state: ConditionState }): void {
    const { name, operator, values, state } = assignment;
    if (state === false) { return; }
    if (state === undefined || values.some(value => value.includes("$"))) { variables.delete(name); return; }
    if (operator === "=") { variables.set(name, values); return; }
    const previous = variables.get(name);
    if (!previous) { return; }
    if (operator === "+=" || operator === "*=") { variables.set(name, [...new Set([...previous, ...values])]); return; }
    if (operator === "-=") { variables.set(name, previous.filter(value => !values.includes(value))); return; }
    variables.delete(name);
}
