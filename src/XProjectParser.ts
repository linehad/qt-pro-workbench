import * as fs from "node:fs";
import * as path from "node:path";
import { readStatements, readText } from "./XQmakeText";
import { expandValues } from "./XQmakeValues";
import { combineConditions, evaluateCondition, updateKnownValues } from "./XQmakeConditions";
import type { FileGroup, ProjectData, ProjectPart } from "./XProjectTypes";
import type { ValueContext } from "./XQmakeValues";
import type { ConditionState, Statement } from "./XQmakeTypes";

const FILE_GROUPS: Record<string, FileGroup> = {
    HEADERS: "Headers", SOURCES: "Sources", FORMS: "Forms", RESOURCES: "Resources",
    TRANSLATIONS: "Translations", OTHER_FILES: "Other Files", DISTFILES: "Other Files", RC_FILE: "Other Files"
};

interface AssignmentInfo {
    name: string;
    operator: string;
    values: string[];
    isConditional: boolean;
    filePath: string;
    conditionState: ConditionState;
}

interface ParseFileInfo {
    filePath: string;
    isConditional?: boolean;
    parentPath?: string;
    conditionState?: ConditionState;
}

function xmlText(value: string): string {
    return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export class TXProjectParser {
    private readonly variables = new Map<string, string[]>();
    private readonly knownVariables = new Map<string, string[]>();
    private readonly origins = new Map<string, Map<string, Map<string, boolean>>>();
    private readonly parts = new Map<string, ProjectPart>();
    private readonly watched = new Set<string>();
    private readonly stack = new Set<string>();
    private readonly notes = new Set<string>();
    private projectDirectory = "";

    private context(filePath: string): ValueContext {
        return { variables: this.variables, fileDirectory: path.dirname(filePath), projectDirectory: this.projectDirectory };
    }

    private assign(info: AssignmentInfo): void {
        const { name, operator, values, isConditional, filePath } = info;
        const previous = this.variables.get(name) ?? [];
        if (operator === "-=") {
            if (!isConditional) {
                this.variables.set(name, previous.filter(value => !values.includes(value)));
                for (const value of values) { this.origins.get(name)?.delete(value); }
            }
            return;
        }
        if (operator === "~=") { this.notes.add(`정규식 치환은 평가하지 않습니다: ${name}`); return; }
        const shouldAppend = isConditional || operator !== "=";
        this.variables.set(name, [...new Set(shouldAppend ? [...previous, ...values] : values)]);
        if (!FILE_GROUPS[name]) { return; }
        const origins = shouldAppend ? this.origins.get(name) ?? new Map<string, Map<string, boolean>>() : new Map<string, Map<string, boolean>>();
        for (const value of values) {
            const owners = origins.get(value) ?? new Map<string, boolean>();
            owners.set(filePath, owners.get(filePath) === true || info.conditionState !== false);
            origins.set(value, owners);
        }
        this.origins.set(name, origins);
    }

    private parseStatement(statement: Statement, filePath: string, state: ConditionState): void {
        const { text, isConditional } = statement;
        const include = text.match(/(?:^|:)\s*include\s*\((.*)\)\s*$/);
        if (include) {
            const conditionState = combineConditions(state, evaluateCondition(text.slice(0, include.index), this.knownVariables));
            for (const value of expandValues(include[1].split(",")[0], this.context(filePath))) {
                if (value.includes("$$")) { this.notes.add(`해석하지 못한 include: ${value}`); continue; }
                this.parseFile({ filePath: path.resolve(path.dirname(filePath), value), isConditional: isConditional || include.index! > 0, parentPath: filePath, conditionState });
            }
            return;
        }
        const match = text.match(/(?:^|:)\s*([A-Za-z_][\w.]*)\s*(\+=|-=|\*=|~=|=)\s*(.*)$/);
        if (!match) { return; }
        const values = expandValues(match[3], this.context(filePath));
        const conditionState = combineConditions(state, evaluateCondition(text.slice(0, match.index), this.knownVariables));
        const knownValues = expandValues(match[3], { ...this.context(filePath), variables: this.knownVariables });
        updateKnownValues(this.knownVariables, { name: match[1], operator: match[2], values: knownValues, state: conditionState });
        this.assign({ name: match[1], operator: match[2], values, isConditional: isConditional || match.index! > 0, filePath, conditionState });
    }

    private parseFile(info: ParseFileInfo): void {
        const { filePath, isConditional = false, parentPath } = info;
        const fullPath = path.resolve(filePath);
        if (this.stack.has(fullPath)) { this.notes.add(`순환 include: ${fullPath}`); return; }
        if (this.watched.size > 500) { this.notes.add("include 파일 수 제한(500)에 도달했습니다."); return; }
        this.watched.add(fullPath);
        if (!this.parts.has(fullPath)) { this.parts.set(fullPath, { filePath: fullPath, includes: [], groups: new Map(), fileActivity: new Map() }); }
        const parent = parentPath ? this.parts.get(parentPath) : undefined;
        if (parent && !parent.includes.includes(fullPath)) { parent.includes.push(fullPath); }
        let content: string;
        try { content = readText(fullPath); } catch { this.notes.add(`읽을 수 없는 프로젝트 파일: ${fullPath}`); return; }
        if (/(?:defineReplace|defineTest|for)\s*\(/.test(content)) { this.notes.add(`사용자 함수·반복문은 평가하지 않습니다: ${fullPath}`); }
        this.stack.add(fullPath);
        const scopeStates = new Map<number, ConditionState>();
        for (const statement of readStatements(content)) {
            let state: ConditionState = parentPath ? info.conditionState : true;
            for (const scope of statement.scopes) {
                if (!scopeStates.has(scope.id)) { scopeStates.set(scope.id, evaluateCondition(scope.expression, this.knownVariables)); }
                state = combineConditions(state, scopeStates.get(scope.id));
            }
            this.parseStatement({ ...statement, isConditional: isConditional || statement.isConditional }, fullPath, state);
        }
        this.stack.delete(fullPath);
    }

    private resolveFiles(values: string[]): string[] {
        const files: string[] = [];
        for (const value of values) {
            if (value.includes("$")) { this.notes.add(`해석하지 못한 파일 경로: ${value}`); continue; }
            if (!value) { continue; }
            files.push(path.resolve(this.projectDirectory, value));
        }
        return files;
    }

    private resourceFiles(filePath: string): string[] {
        if (!filePath.toLowerCase().endsWith(".qrc")) { return []; }
        this.watched.add(filePath);
        try {
            const xml = readText(filePath);
            return [...xml.matchAll(/<file\b[^>]*>([\s\S]*?)<\/file>/g)].map(match => path.resolve(path.dirname(filePath), xmlText(match[1].trim())));
        } catch { this.notes.add(`리소스 파일을 읽을 수 없습니다: ${filePath}`); return []; }
    }

    private groups(): Map<FileGroup, string[]> {
        const groups = new Map<FileGroup, string[]>();
        groups.set("Project Files", [...this.watched]);
        for (const [variable, group] of Object.entries(FILE_GROUPS)) {
            const files: string[] = [];
            for (const value of this.variables.get(variable) ?? []) {
                const declaredFiles = this.resolveFiles([value]);
                if (group === "Resources") { declaredFiles.push(...declaredFiles.flatMap(file => this.resourceFiles(file))); }
                files.push(...declaredFiles);
                this.addPartFiles(variable, value, declaredFiles);
            }
            groups.set(group, [...new Set([...(groups.get(group) ?? []), ...files])].sort());
        }
        return groups;
    }

    private addPartFiles(variable: string, value: string, files: string[]): void {
        const group = FILE_GROUPS[variable];
        for (const [owner, isActive] of this.origins.get(variable)?.get(value) ?? []) {
            const part = this.parts.get(owner);
            if (!part) { continue; }
            part.groups.set(group, [...new Set([...(part.groups.get(group) ?? []), ...files])].sort());
            for (const file of files) { part.fileActivity.set(file, part.fileActivity.get(file) === true || isActive); }
        }
    }

    private childProjects(): string[] {
        const children: string[] = [];
        for (const name of this.variables.get("SUBDIRS") ?? []) {
            const aliases = this.variables.get(`${name}.file`) ?? this.variables.get(`${name}.subdir`) ?? [name];
            for (const filePath of this.resolveFiles(aliases)) { children.push(...this.findProjectInDirectory(filePath)); }
        }
        return [...new Set(children)];
    }

    private findProjectInDirectory(filePath: string): string[] {
        if (filePath.toLowerCase().endsWith(".pro")) { return [filePath]; }
        try {
            const files = fs.readdirSync(filePath).filter(name => name.toLowerCase().endsWith(".pro"));
            const preferred = `${path.basename(filePath)}.pro`;
            return files.includes(preferred) ? [path.join(filePath, preferred)] : files.map(name => path.join(filePath, name));
        } catch { this.notes.add(`하위 프로젝트를 찾을 수 없습니다: ${filePath}`); return []; }
    }

    public parse(projectPath: string): ProjectData {
        this.variables.clear(); this.watched.clear(); this.stack.clear(); this.notes.clear();
        this.origins.clear(); this.parts.clear();
        this.knownVariables.clear();
        this.projectDirectory = path.dirname(path.resolve(projectPath));
        this.parseFile({ filePath: projectPath });
        const groups = this.groups();
        const children = this.childProjects();
        return {
            projectPath: path.resolve(projectPath),
            name: path.basename(projectPath, ".pro"),
            template: this.variables.get("TEMPLATE")?.[0] ?? "app",
            groups, parts: new Map(this.parts), children, watchedPaths: [...this.watched], notes: [...this.notes],
            includePaths: this.resolveFiles(this.variables.get("INCLUDEPATH") ?? []),
            defines: this.variables.get("DEFINES") ?? [], config: this.variables.get("CONFIG") ?? []
        };
    }
}
