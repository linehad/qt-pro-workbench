import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { validateRunSettings } from "./XRunValidation";
import type { ProjectPreferences } from "./XProjectTypes";
import type { RunConfiguration, RunConfigurationChange, RunConfigurationSet } from "./XRunTypes";

export function runSettingsKey(kitId: string, configuration: string): string {
    return JSON.stringify([kitId, configuration]);
}

function validateName(value: unknown): string {
    if (typeof value !== "string") { throw new Error("실행 설정 이름을 입력하세요."); }
    const name = value.trim();
    if (!name || /[\x00-\x1f]/.test(name)) { throw new Error("실행 설정 이름을 확인하세요."); }
    return name;
}

export function normalizeRunConfigurationSet(value: unknown, defaultName = "프로젝트 실행"): RunConfigurationSet {
    if (!value || typeof value !== "object") { throw new Error("실행 설정 목록을 확인하세요."); }
    if (!("items" in value)) {
        const settings = validateRunSettings(value);
        const name = settings.executable ? path.basename(settings.executable, path.extname(settings.executable)) : defaultName;
        return { activeId: "default", items: [{ ...settings, id: "default", name, kind: settings.executable ? "custom" : "project" }] };
    }
    const stored = value as RunConfigurationSet;
    if (!Array.isArray(stored.items) || !stored.items.length) { throw new Error("실행 설정이 하나 이상 필요합니다."); }
    const ids = new Set<string>();
    const items = stored.items.map(item => {
        const settings = validateRunSettings(item);
        if (typeof item.id !== "string" || !item.id) { throw new Error("실행 설정 ID가 잘못되었습니다."); }
        if (ids.has(item.id)) { throw new Error("실행 설정 ID가 중복되었습니다."); }
        if (item.kind !== "project" && item.kind !== "custom") { throw new Error("실행 설정 종류가 잘못되었습니다."); }
        ids.add(item.id);
        return { ...settings, id: item.id, name: validateName(item.name), kind: item.kind };
    });
    if (!ids.has(stored.activeId)) { throw new Error("선택한 실행 설정이 목록에 없습니다."); }
    return { activeId: stored.activeId, items };
}

export function getRunConfigurationSet(preferences: ProjectPreferences, kitId: string, configuration = preferences.configuration, defaultName = "프로젝트 실행"): RunConfigurationSet {
    const stored = preferences.runConfigurations?.[runSettingsKey(kitId, configuration)];
    if (stored) { return normalizeRunConfigurationSet(stored, defaultName); }
    const sameConfiguration = preferences.configuration === configuration && preferences.kitId === kitId;
    const executable = sameConfiguration ? preferences.runExecutable ?? "" : "";
    return normalizeRunConfigurationSet({ executable, arguments: "", workingDirectory: "" }, defaultName);
}

export function activeRunConfiguration(configurations: RunConfigurationSet): RunConfiguration {
    const selected = configurations.items.find(item => item.id === configurations.activeId);
    if (!selected) { throw new Error("선택한 실행 설정이 목록에 없습니다."); }
    return selected;
}

export function uniqueRunConfigurationName(configurations: RunConfigurationSet, proposed: string): string {
    const base = validateName(proposed);
    let name = base;
    let index = 2;
    while (configurations.items.some(item => item.name === name)) { name = `${base} (${index++})`; }
    return name;
}

export function changeRunConfiguration(configurations: RunConfigurationSet, change: RunConfigurationChange): RunConfigurationSet {
    const result = normalizeRunConfigurationSet(configurations);
    if (change.action === "add") {
        if (change.kind !== "project" && change.kind !== "custom") { throw new Error("실행 설정 종류가 잘못되었습니다."); }
        const item = { id: randomUUID(), name: uniqueRunConfigurationName(result, change.name), kind: change.kind, executable: "", arguments: "", workingDirectory: "" };
        result.items.push(item);
        result.activeId = item.id;
        return result;
    }
    const item = result.items.find(entry => entry.id === change.id);
    if (!item) { throw new Error("실행 설정이 삭제되었거나 변경되었습니다. 화면을 다시 열어 주세요."); }
    switch (change.action) {
        case "save": Object.assign(item, validateRunSettings(change.settings)); break;
        case "select": result.activeId = item.id; break;
        case "rename": {
            const name = validateName(change.name);
            if (result.items.some(entry => entry.id !== item.id && entry.name === name)) { throw new Error("같은 이름의 실행 설정이 있습니다."); }
            item.name = name;
            break;
        }
        case "clone": {
            const clone = { ...item, id: randomUUID(), name: uniqueRunConfigurationName(result, change.name) };
            result.items.push(clone);
            result.activeId = clone.id;
            break;
        }
        case "remove": {
            if (result.items.length === 1) { throw new Error("실행 설정을 하나 이상 남겨 주세요."); }
            const index = result.items.indexOf(item);
            result.items.splice(index, 1);
            if (result.activeId === item.id) { result.activeId = result.items[Math.min(index, result.items.length - 1)].id; }
            break;
        }
        default: throw new Error("실행 설정 작업이 올바르지 않습니다.");
    }
    return result;
}
