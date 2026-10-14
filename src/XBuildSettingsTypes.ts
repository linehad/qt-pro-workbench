export interface BuildSettings {
    shadowBuild: boolean;
    buildDirectory: string;
    qmakeArguments: string;
    makeArguments: string;
    cleanArguments: string;
    environment: string;
}
