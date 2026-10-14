export type QtCreatorValue = string | number | boolean | QtCreatorMap | QtCreatorValue[];
export interface QtCreatorMap { [key: string]: QtCreatorValue; }
export interface QtCreatorSettings { directory: string; files: Record<string, QtCreatorMap>; }
export interface QtCreatorImportResult { added: number; updated: number; sources: string[]; skipped: string[]; }
