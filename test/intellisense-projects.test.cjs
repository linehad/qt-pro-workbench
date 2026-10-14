const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TXProjectParser } = require("../out/XProjectParser");
const { TXIntelliSenseProjects } = require("../out/XIntelliSenseProjects");
const { makeBuildPlan } = require("../out/XBuildPlan");
const { loadProjectPreferences, saveProjectPreferences } = require("../out/XProjectPreferencesStore");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-cpp-projects-"));
    t.after(() => {
        assert.equal(path.dirname(root), os.tmpdir());
        assert(path.basename(root).startsWith("qt-cpp-projects-"));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
    const kit = name => ({ id: name, name, qmakePath: path.join(root, name, "bin", "qmake.exe"), compilerDirectory: path.join(root, name, "compiler"), makePath: path.join(root, name, "compiler", "make.exe") });
    return { root, write, kit };
}

test("personal project selections survive independent metadata updates and Windows path casing", t => {
    const { root, write } = fixture(t);
    const mother = write("Mother/mother.pro", "TEMPLATE = app\n");
    const other = write("Other/other.pro", "TEMPLATE = app\n");
    const storage = path.join(root, "personal-storage");
    assert.equal(loadProjectPreferences(storage, mother), undefined);
    saveProjectPreferences(storage, mother, { configuration: "release", kitId: "qt4" });
    saveProjectPreferences(storage, other, { configuration: "debug", kitId: "qt6" });
    fs.writeFileSync(path.join(storage, "metadata.json"), JSON.stringify({ project: { configuration: "debug" } }));
    assert.deepEqual(loadProjectPreferences(storage, mother.toUpperCase()), { configuration: "release", kitId: "qt4" });
    assert.deepEqual(loadProjectPreferences(storage, other), { configuration: "debug", kitId: "qt6" });
    saveProjectPreferences(storage, mother, { configuration: "debug", kitId: "qt4" });
    assert.equal(loadProjectPreferences(storage, mother).configuration, "debug");
    assert.equal(fs.readdirSync(path.join(storage, "project-selections")).length, 2);
    assert(!fs.existsSync(path.join(path.dirname(mother), ".vscode")));
});

test("C++ configurations cover independent roots and SUBDIRS, inherit kit/mode/shadow directory and retain each project's includes", t => {
    const { root, write, kit } = fixture(t);
    const one = kit("4.8.1"); const two = kit("6.11.0");
    const mother = write("Mother/mother.pro", "TEMPLATE = subdirs\nSUBDIRS = child/child.pro\n");
    const child = write("Mother/child/child.pro", "TEMPLATE = app\nSOURCES += main.cpp\nHEADERS += ../../Shared.h\nINCLUDEPATH += childInclude\nDEFINES += CHILD_ONLY\n");
    const childFile = write("Mother/child/main.cpp", "// child\n");
    const other = write("Other/other.pro", "TEMPLATE = app\nSOURCES += other.cpp\nHEADERS += ../Shared.h\nINCLUDEPATH += otherInclude\nDEFINES += OTHER_ONLY\n");
    const otherFile = write("Other/other.cpp", "// other\n");
    const shared = write("Shared.h", "// shared\n");
    let active = mother;
    const preferences = project => ({ configuration: "release", kitId: project === mother ? one.id : project === other ? two.id : undefined });
    const errors = [];
    const profiles = new TXIntelliSenseProjects({ projects: () => [other, mother], getProject: project => new TXProjectParser().parse(project), preferences, kits: () => [one, two], activeProject: () => active, storagePath: root, reportError: error => errors.push(error) });
    const shadowPlan = { ...makeBuildPlan(mother, one, preferences(mother), root), buildDirectory: path.join(root, "shadow") };
    profiles.refresh(shadowPlan);
    const childConfiguration = profiles.configurationFor(childFile);
    assert(childConfiguration.defines.includes("CHILD_ONLY"));
    assert(childConfiguration.compilerPath.startsWith(one.compilerDirectory));
    assert(childConfiguration.includePath.includes(path.join(root, "shadow", "child", "moc")));
    assert(childConfiguration.includePath.includes(path.join(path.dirname(child), "childInclude")));
    const otherConfiguration = profiles.configurationFor(otherFile);
    assert(otherConfiguration.defines.includes("OTHER_ONLY"));
    assert(otherConfiguration.compilerPath.startsWith(two.compilerDirectory));
    assert(profiles.configurationFor(shared).defines.includes("CHILD_ONLY"));
    active = other; profiles.refresh();
    assert(profiles.configurationFor(shared).defines.includes("OTHER_ONLY"));
    assert(profiles.browseConfiguration().browsePath.includes(childFile.toLowerCase()));
    assert(profiles.browseConfiguration().browsePath.includes(otherFile.toLowerCase()));
    assert.equal(profiles.configurationFor(write("Mother/child/unlisted.cpp", "// unknown\n")), undefined);
    assert.deepEqual(errors, []);
});

test("an editor file in a closed project receives its saved kit without adding a root or changing active build target", t => {
    const { root, write, kit } = fixture(t);
    const qt = kit("4.8.1");
    const closed = write("Closed/closed.pro", "TEMPLATE = app\nSOURCES += nested/main.cpp\nDEFINES += CLOSED_PROJECT\n");
    const source = write("Closed/nested/main.cpp", "// closed project\n");
    const roots = [];
    const profiles = new TXIntelliSenseProjects({ projects: () => roots, getProject: project => new TXProjectParser().parse(project), preferences: project => ({ configuration: "debug", kitId: project === closed ? qt.id : undefined }), kits: () => [qt], activeProject: () => undefined, storagePath: root, reportError: error => { throw error; } });
    profiles.refresh();
    assert(profiles.configurationFor(source).defines.includes("CLOSED_PROJECT"));
    assert.deepEqual(roots, []);
    assert(!profiles.browseConfiguration().browsePath.includes(source.toLowerCase()));
});
