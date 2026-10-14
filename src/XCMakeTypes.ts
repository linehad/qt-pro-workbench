export interface CMakeCompileGroup {
    language: string;
    includes?: { path: string }[];
    defines?: { define: string }[];
    compileCommandFragments?: { fragment: string }[];
    languageStandard?: { standard: string };
}

export interface CMakeTarget {
    name: string;
    nameOnDisk?: string;
    type: string;
    paths: { source: string; build: string };
    artifacts?: { path: string }[];
    sources?: { path: string; compileGroupIndex?: number; isGenerated?: boolean }[];
    compileGroups?: CMakeCompileGroup[];
}

export interface CMakeModel {
    source: string;
    build: string;
    targets: CMakeTarget[];
    inputs: string[];
    compilers: Record<string, string>;
}
