export interface StatementScope {
    id: number;
    expression: string;
}

export interface Statement {
    text: string;
    isConditional: boolean;
    scopes: StatementScope[];
}

export type ConditionState = boolean | undefined;
