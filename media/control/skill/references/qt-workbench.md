# Qt Pro editor operations and preferences

Use the current bridge `help` for external operations and current installed commands/keybindings for editor-only actions. Names below are the Qt Pro 0.12.1+ defaults; user keybinding overrides take precedence.

## Project and configuration

The status bar's **project ▾** opens Project Settings for the active project/kit. The adjacent **Debug / Release ▾** switches saved build configurations directly. Build, Deploy and Run Settings share that project/kit selection. Kit Settings manages compiler/GDB/CMake paths. Qt Creator Desktop kit settings are imported once and persisted; later Creator edits should not overwrite the extension's existing settings.

Project follow means **selecting the currently viewed file in the tree**, while keeping the build/run active project. `qtPro.revealActiveFile` reveals it; `qtPro.toggleAutoReveal` toggles automatic following. Do not change active build target simply because the user opens another source file.

| Task | Default shortcut or command |
| --- | --- |
| Open Qt project file | Qt Pro: Open Project (.pro / CMakeLists.txt), `qtPro.openProject` |
| Project Settings | Project status bar ▾, `qtPro.selectActiveProject` |
| Build configuration | Debug / Release status bar ▾, `qtPro.selectConfiguration` |
| Build / Deploy / Run Settings | `qtPro.configureBuild`, `qtPro.configureDeploy`, `qtPro.configureRun` |
| Run | Ctrl+F5, `qtPro.run` |
| Debug | F5, `qtPro.debug` |
| Definitions / declarations | F12 or Ctrl+click; alternate navigation goes between declaration and definition when there is no different definition target. |
| Previous location | Alt+Left |
| Qt Pro references | Shift+F12 or Shift+Alt+F12, **Qt Pro: 모든 참조 찾기 (열린 프로젝트)**, `qtPro.findReferences` |
| Explicit name search | **Qt Pro: 열린 프로젝트에서 이름 검색**, `qtPro.findName` |
| Bookmark toggle | Ctrl+Alt+K or line-number context menu, `qtPro.toggleBookmark` |
| Next / previous bookmark | Ctrl+Alt+L / Ctrl+Alt+J |
| Reload after extension update | **Developer: Reload Window**, `workbench.action.reloadWindow` |

Command IDs are for an existing supported extension-host caller, not shell commands. The Qt Pro control bridge exposes project/configuration selection, build and debugging; it does not expose these arbitrary editor commands.

## Reference scope

Semantic references use the C/C++ language provider and show actual uses in **References**. Include only opened `.pro` / CMake projects and children in the current source's repository root. Another opened project under `F:/1.4.13_Work` is included; similarly named files under a separate `F:/HydraX_main` root are excluded. Closed projects are excluded. Repository root uses the nearest `.git`, `.svn` or `.hg`; without those markers it is the project folder.

Explicit name search scans text in **all opened projects**, including another root, and still excludes closed projects. Do not describe it as semantic reference resolution. Native VS Code reference menus are separate from the Qt Pro commands and may have different scope.

For folderless `.pro` windows, the first Qt Pro reference search adds analysis folders to the current window because C/C++ needs folders for a full browse index. It does not open another VS Code window. The first folder change restarts the extension host; project selection and unsaved file content are restored from personal session data. Initial setup is deferred while a debugger is active so it is not interrupted. A later project from another root adds an analysis folder. Initial indexing can take time; refresh References when an actual omission remains.

To verify a reported omission, compare the returned semantic locations with the specific known call site. A text search can diagnose whether a use exists; do not substitute literal hits for semantic references. Example previously verified: `TFins::ExecuteCpuUnitDataReadSerial` in OriaCs.pro includes Fins.cpp:586, Fins.h:118 and FinsOriaCs.cpp:32.
