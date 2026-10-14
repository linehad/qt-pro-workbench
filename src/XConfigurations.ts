import { randomUUID } from "node:crypto";
import { getBuildSettings, validateBuildSettings, buildSettingsKey } from "./XBuildSettings";
import type { ProjectPreferences, QtKit } from "./XProjectTypes";
import type { BuildConfigurationSet, DeployConfigurationSet, NamedConfigurationSet, ConfigurationChange } from "./XConfigurationTypes";

export function configurationName(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || /[\x00-\x1f]/.test(value)) { throw new Error("구성 이름을 입력하세요."); }
    return value.trim();
}

export function validateConfigurationSet<T extends { id: string; name: string }>(value: unknown, validate: (item: T) => T): NamedConfigurationSet<T> {
    const data = value as NamedConfigurationSet<T> | undefined;
    if (!data || !Array.isArray(data.items) || !data.items.length) { throw new Error("구성을 하나 이상 남겨 주세요."); }
    const ids = new Set<string>();
    const names = new Set<string>();
    const items = data.items.map(item => {
        if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) { throw new Error("구성 ID를 확인하세요."); }
        const name = configurationName(item.name);
        if (names.has(name)) { throw new Error("같은 이름의 구성이 있습니다."); }
        ids.add(item.id); names.add(name);
        return validate({ ...item, name });
    });
    if (!ids.has(data.activeId)) { throw new Error("선택한 구성이 목록에 없습니다."); }
    return { activeId: data.activeId, items };
}

export function validateBuildConfigurations(value: unknown): BuildConfigurationSet {
    return validateConfigurationSet(value, item => {
        if (item.configuration !== "debug" && item.configuration !== "release") { throw new Error("Debug 또는 Release를 선택하세요."); }
        return { id: item.id, name: item.name, configuration: item.configuration, settings: validateBuildSettings(item.settings) };
    });
}

export function getBuildConfigurations(preferences: ProjectPreferences, kit: QtKit): BuildConfigurationSet {
    const stored = preferences.buildProfiles?.[kit.id];
    const configurations = stored ? validateBuildConfigurations(stored) : {
        activeId: preferences.configuration,
        items: (["debug", "release"] as const).map(configuration => ({ id: configuration, name: configuration === "debug" ? "Debug" : "Release", configuration, settings: getBuildSettings({ ...preferences, configuration, buildProfiles: undefined }, kit) }))
    };
    if (configurations.items.find(item => item.id === configurations.activeId)?.configuration !== preferences.configuration) {
        configurations.activeId = configurations.items.find(item => item.configuration === preferences.configuration)?.id ?? configurations.activeId;
    }
    return configurations;
}

export function validateDeployConfigurations(value: unknown): DeployConfigurationSet {
    return validateConfigurationSet(value, item => {
        if (!Array.isArray(item.steps)) { throw new Error("배포 단계를 확인하세요."); }
        const ids = new Set<string>();
        const steps = item.steps.map(step => {
            if (!step || typeof step.id !== "string" || !step.id || ids.has(step.id)) { throw new Error("배포 단계 ID를 확인하세요."); }
            if (typeof step.source !== "string" || !step.source.trim() || typeof step.destination !== "string" || !step.destination.trim()) { throw new Error("배포 원본과 대상 폴더를 입력하세요."); }
            if (/[\x00-\x1f]/.test(step.source + step.destination)) { throw new Error("배포 경로에 줄바꿈을 넣을 수 없습니다."); }
            ids.add(step.id);
            return { id: step.id, source: step.source.trim(), destination: step.destination.trim() };
        });
        return { id: item.id, name: item.name, steps };
    });
}

export function getDeployConfigurations(preferences: ProjectPreferences, kitId: string): DeployConfigurationSet {
    return validateDeployConfigurations(preferences.deployConfigurations?.[buildSettingsKey(kitId, preferences.configuration)] ?? { activeId: "default", items: [{ id: "default", name: "Deploy Configuration", steps: [] }] });
}

export function uniqueConfigurationName(items: readonly { name: string }[], proposed: string): string {
    const base = configurationName(proposed);
    let name = base;
    let index = 2;
    while (items.some(item => item.name === name)) { name = `${base} (${index++})`; }
    return name;
}

export function changeConfiguration<T extends { id: string; name: string }>(configurations: NamedConfigurationSet<T>, change: ConfigurationChange): NamedConfigurationSet<T> {
    const result = structuredClone(configurations);
    const item = result.items.find(entry => entry.id === change.id);
    if (!item) { throw new Error("구성이 변경되었습니다. 화면을 다시 불러오세요."); }
    switch (change.action) {
        case "select": result.activeId = item.id; break;
        case "rename": {
            const name = configurationName(change.name);
            if (result.items.some(entry => entry.id !== item.id && entry.name === name)) { throw new Error("같은 이름의 구성이 있습니다."); }
            item.name = name; break;
        }
        case "clone": {
            const clone = { ...structuredClone(item), id: randomUUID(), name: uniqueConfigurationName(result.items, change.name) };
            result.items.push(clone); result.activeId = clone.id; break;
        }
        case "remove": {
            if (result.items.length === 1) { throw new Error("구성을 하나 이상 남겨 주세요."); }
            const index = result.items.indexOf(item);
            result.items.splice(index, 1);
            if (result.activeId === item.id) { result.activeId = result.items[Math.min(index, result.items.length - 1)].id; }
            break;
        }
        default: throw new Error("구성 작업을 확인하세요.");
    }
    return result;
}
