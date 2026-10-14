const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { executableFromMakefile, buildExecutables, defaultExecutable } = require("../out/XBuildOutput");

test("qmake output resolves exact target including DESTDIR, make references, spaces and non-app projects", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-output-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const makefile = path.join(root, "Makefile");
    fs.writeFileSync(makefile, 'DESTDIR = ../custom output/ #avoid trailing-slash linebreak\nTARGET = CorrectApp.exe\nDESTDIR_TARGET = $(DESTDIR)$(TARGET)\n');
    assert.equal(executableFromMakefile(makefile), path.resolve(root, "../custom output/CorrectApp.exe"));
    fs.writeFileSync(makefile, 'DESTDIR_TARGET = "../custom output/NamedApp.exe"\n');
    assert.equal(executableFromMakefile(makefile), path.resolve(root, "../custom output/NamedApp.exe"));
    fs.writeFileSync(makefile, 'TARGET = Library.dll\n');
    assert.equal(executableFromMakefile(makefile), undefined);
});

test("SUBDIRS follows nested named Makefiles, selected configuration and skips DLLs and unrelated EXEs", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-subdirs-output-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    write("Makefile", "MAKEFILE = Makefile\nSUBTARGETS = \\\n sub-group \\\n sub-library\nsub-group: group/$(MAKEFILE).Group FORCE\nsub-library: library/$(MAKEFILE).Plugin FORCE\n");
    write("group/Makefile.Group", "SUBTARGETS = sub-worker sub-repeat sub-cycle\nsub-worker: ../worker\\ folder/Makefile.Worker FORCE\nsub-repeat: ../worker\\ folder/Makefile.Worker FORCE\nsub-cycle: ../Makefile FORCE\n");
    write("worker folder/Makefile.Worker.Debug", "DESTDIR_TARGET = ../products/debug/Worker.exe\n");
    write("worker folder/Makefile.Worker.Release", "DESTDIR_TARGET = ../products/release/Worker.exe\n");
    write("library/Makefile.Plugin.Debug", "DESTDIR_TARGET = ../products/debug/Plugin.dll\n");
    write("library/Makefile.Plugin.Release", "DESTDIR_TARGET = ../products/release/Plugin.dll\n");
    write("Unrelated.exe", "");
    for (const configuration of ["debug", "release"]) {
        const plan = { projectPath: path.join(root, "parent.pro"), buildDirectory: root, configuration };
        const expected = path.join(root, "products", configuration, "Worker.exe");
        assert.deepEqual(buildExecutables(plan), [expected]);
        assert.equal(defaultExecutable(plan), expected);
    }
});

test("multiple applications require a target choice and library-only projects have no default", t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qt-subdirs-choice-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, "Makefile"), "SUBTARGETS = first second\nfirst: Makefile.First FORCE\nsecond: Makefile.Second FORCE\n");
    fs.writeFileSync(path.join(root, "Makefile.First.Debug"), "DESTDIR_TARGET = output/First.exe\n");
    fs.writeFileSync(path.join(root, "Makefile.Second.Debug"), "DESTDIR_TARGET = output/Second.exe\n");
    const plan = { projectPath: path.join(root, "parent.pro"), buildDirectory: root, configuration: "debug" };
    assert.deepEqual(buildExecutables(plan), [path.join(root, "output/First.exe"), path.join(root, "output/Second.exe")]);
    assert.equal(defaultExecutable(plan), undefined);
    fs.writeFileSync(path.join(root, "Makefile.First.Debug"), "TARGET = First.dll\n");
    fs.writeFileSync(path.join(root, "Makefile.Second.Debug"), "TARGET = Second.dll\n");
    assert.deepEqual(buildExecutables(plan), []);
    assert.equal(defaultExecutable(plan), undefined);
});
