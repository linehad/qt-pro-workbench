const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { TXProjectParser } = require("../out/XProjectParser");
const { makeBuildPlan, kitEnvironment } = require("../out/XBuildPlan");
const { partChildren } = require("../out/XProjectNodes");
const { folderChildren, projectNodeId } = require("../out/XProjectFolders");

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-pro-parser-"));
    t.after(() => {
        const relative = path.relative(os.tmpdir(), root);
        assert(!relative.startsWith(".."));
        assert(path.basename(root).startsWith("qt-pro-parser-"));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const write = (name, text) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
    return { root, write };
}

test("includes, quoted paths, scoped alternatives and qrc resources remain read-only", t => {
    const { root, write } = fixture(t);
    write("app.pro", `TARGET = Viewer\nROOT = $$PWD\ninclude(config/common.pri)\nwin32 { SOURCES += win.cpp } else { SOURCES += unix.cpp }\nSOURCES += obsolete.cpp\nSOURCES -= obsolete.cpp\nRESOURCES += assets/app.qrc\n`);
    write("config/common.pri", `SOURCES += "$${"$"}{ROOT}/folder with spaces/main.cpp" \\\n# comment in continued list\n helper.cpp\nHEADERS += $$PWD/common.h\ninclude(nested.pri)\n`);
    write("config/nested.pri", "FORMS += dialog.ui\n");
    write("assets/app.qrc", '<RCC><qresource><file alias="a">icons/a&amp;b.png</file></qresource></RCC>');
    const before = fs.readdirSync(root, { recursive: true });
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    const sources = project.groups.get("Sources");
    assert(sources.includes(path.join(root, "folder with spaces/main.cpp")));
    assert(sources.includes(path.join(root, "helper.cpp")));
    assert(sources.includes(path.join(root, "win.cpp")));
    assert(sources.includes(path.join(root, "unix.cpp")));
    assert(!sources.includes(path.join(root, "obsolete.cpp")));
    assert(project.groups.get("Headers").includes(path.join(root, "config/common.h")));
    assert(project.groups.get("Resources").includes(path.join(root, "assets/icons/a&b.png")));
    assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
});

test("SUBDIRS aliases, variables, wildcards and cycles are bounded", t => {
    const { root, write } = fixture(t);
    write("app.pro", "TEMPLATE = subdirs\nSUBDIRS += engine ui\nengine.file = core/engine.pro\nui.subdir = gui\ninclude(cycle.pri)\nSOURCES += $$files($$PWD/src/*.cpp)\n");
    write("cycle.pri", "include(app.pro)\n");
    write("core/engine.pro", "TEMPLATE = lib");
    write("gui/gui.pro", "TEMPLATE = app");
    write("src/a.cpp", ""); write("src/b.h", "");
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    assert.deepEqual(project.children, [path.join(root, "core/engine.pro"), path.join(root, "gui/gui.pro")]);
    assert.deepEqual(project.groups.get("Sources"), [path.join(root, "src/a.cpp")]);
    assert(project.notes.some(note => note.includes("순환")));
});

test("project commands are never executed; unknown expressions are reported", t => {
    const { root, write } = fixture(t);
    write("app.pro", "system(echo unsafe > touched.txt)\nSOURCES += $$system(echo x.cpp)\nwin32:SOURCES += win.cpp\ndefineReplace(foo) { SOURCES += fake.cpp }\n");
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    assert(!fs.existsSync(path.join(root, "touched.txt")));
    assert(project.groups.get("Sources").includes(path.join(root, "win.cpp")));
    assert(!project.groups.get("Sources").includes(path.join(root, "fake.cpp")));
    assert(project.notes.length > 0);
});

test("build plans default to the project folder and preserve qmake output rules", () => {
    const kit = { id: "one", name: "Qt", qmakePath: "C:/Qt/bin/qmake.exe", compilerDirectory: "C:/Mingw/bin", makePath: "C:/Mingw/bin/mingw32-make.exe" };
    const debug = makeBuildPlan("C:/projects/one/app.pro", kit, { configuration: "debug" }, "C:/personal");
    const release = makeBuildPlan("C:/projects/one/app.pro", kit, { configuration: "release" }, "C:/personal");
    const other = makeBuildPlan("C:/projects/two/app.pro", kit, { configuration: "debug" }, "C:/personal");
    const changedKit = makeBuildPlan("C:/projects/one/app.pro", { ...kit, compilerDirectory: "C:/NewMingw/bin" }, { configuration: "debug" }, "C:/personal");
    assert.equal(debug.buildDirectory, path.dirname("C:/projects/one/app.pro"));
    assert.equal(release.buildDirectory, debug.buildDirectory);
    assert.equal(changedKit.buildDirectory, debug.buildDirectory);
    assert.notEqual(other.buildDirectory, debug.buildDirectory);
    assert(!debug.qmakeArguments.includes("-after"));
    assert(!debug.qmakeArguments.some(argument => /(?:DESTDIR|OBJECTS_DIR|MOC_DIR|RCC_DIR|UI_DIR)=/.test(argument)));
    const environment = kitEnvironment(kit);
    assert(environment.PATH.startsWith([path.dirname(kit.qmakePath), kit.compilerDirectory].join(path.delimiter)));
    assert(!Object.keys(environment).some(key => key !== "PATH" && key.toUpperCase() === "PATH"));
});

test("Qt Creator hierarchy nests included pri files and their own file groups", t => {
    const { root, write } = fixture(t);
    write("app.pro", "SOURCES += main.cpp\ninclude(config/common.pri)\ninclude(build.pri)\nRESOURCES += app.qrc\n");
    write("config/common.pri", "HEADERS += $$PWD/Common/a.h\nSOURCES += $$PWD/Common/a.cpp\ninclude(nested.pri)\n");
    write("config/nested.pri", "HEADERS += $$PWD/nested.h\ninclude(common.pri)\n");
    write("build.pri", "CONFIG += console\n");
    write("app.qrc", "<RCC><qresource><file>images/icon.png</file></qresource></RCC>");
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    const rootNode = { kind: "project", label: "app", projectPath: project.projectPath };
    const children = partChildren(rootNode, project);
    assert.deepEqual(children.map(node => node.label), ["app.pro", "build", "common", "Sources", "Resources"]);
    const common = children.find(node => node.label === "common");
    const commonChildren = partChildren(common, project);
    assert.deepEqual(commonChildren.map(node => node.label), ["common.pri", "nested", "Headers", "Sources"]);
    const headers = commonChildren.find(node => node.label === "Headers");
    assert.deepEqual(folderChildren(headers).map(node => node.label), ["Common"]);
    const nested = partChildren(commonChildren.find(node => node.label === "nested"), project);
    assert.deepEqual(nested.map(node => node.label), ["nested.pri", "Headers"]);
    assert.deepEqual(nested[1].files, [path.join(root, "config/nested.h")]);
    assert.deepEqual(children.find(node => node.label === "Sources").files, [path.join(root, "main.cpp")]);
    assert.equal(project.groups.get("Headers").length, 2);
    const ids = new Set();
    function visit(node) {
        const id = projectNodeId(node);
        assert(!ids.has(id)); ids.add(id);
        if (node.kind === "file") { return; }
        const descendants = node.kind === "group" || node.kind === "folder" ? folderChildren(node) : partChildren(node, project);
        descendants.forEach(visit);
    }
    visit(rootNode);
});

test("reassigning or removing files updates their pri ownership as well as flat lists", t => {
    const { root, write } = fixture(t);
    write("app.pro", "HEADERS = old.h\ninclude(common.pri)\nHEADERS -= removed.h\n");
    write("common.pri", "HEADERS = retained.h removed.h\n");
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    assert.equal(project.parts.get(project.projectPath).groups.has("Headers"), false);
    assert.deepEqual(project.parts.get(path.join(root, "common.pri")).groups.get("Headers"), [path.join(root, "retained.h")]);
    assert.deepEqual(project.groups.get("Headers"), [path.join(root, "retained.h")]);
});

test("known false pri conditions dim only that declaration, preserving active references", t => {
    const { root, write } = fixture(t);
    write("app.pro", 'DBPATH = $$PWD/DBCommon/\nHEADERS += DBCommon/shared.h\ninclude(LogWriter/LogWriter.pri)\n');
    write("LogWriter/LogWriter.pri", 'HEADERS += local.h\nequals(DBPATH, "") {\n  TEMP = $$PWD/../DBCommon/\n  HEADERS += $${TEMP}shared.h\n  include(nested.pri)\n}\nunknownPredicate() { HEADERS += unknown.h }\n');
    write("LogWriter/nested.pri", 'HEADERS += nested.h\n');
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    const shared = path.join(root, "DBCommon/shared.h");
    assert.equal(project.parts.get(project.projectPath).fileActivity.get(shared), true);
    const log = project.parts.get(path.join(root, "LogWriter/LogWriter.pri"));
    assert.equal(log.fileActivity.get(shared), false);
    assert.equal(log.fileActivity.get(path.join(root, "local.h")), true);
    assert.equal(log.fileActivity.get(path.join(root, "unknown.h")), true);
    assert.equal(project.parts.get(path.join(root, "LogWriter/nested.pri")).fileActivity.get(path.join(root, "nested.h")), false);
    assert(project.groups.get("Headers").includes(shared));
});

test("condition results are fixed at block entry and unknown assignments stay conservative", t => {
    const { root, write } = fixture(t);
    write("app.pro", 'MODE = on\nequals(MODE, on) { MODE = off; HEADERS += active.h }\nequals(MODE, on):HEADERS += inactive.h\nunknownPredicate() { MODE = on }\nequals(MODE, off) { HEADERS += uncertain.h }\n');
    const project = new TXProjectParser().parse(path.join(root, "app.pro"));
    const activity = project.parts.get(project.projectPath).fileActivity;
    assert.equal(activity.get(path.join(root, "active.h")), true);
    assert.equal(activity.get(path.join(root, "inactive.h")), false);
    assert.equal(activity.get(path.join(root, "uncertain.h")), true);
});
