# Diagnose the observed failure

Use the error and bounded build/debug logs to select the relevant case. Avoid rerunning the whole application to diagnose a loader or configuration failure.

| Symptom | What to establish and do |
| --- | --- |
| No reachable window | Check `qt_list_instances` in an allowed shell, Qt Pro activation and the actual intended VS Code window. Sandbox denial is different from a successful empty list. Reloaded windows have new IDs. |
| `MODULE_NOT_FOUND` for an old `ynlim.qt-pro-workbench-<version>/out/XDebugPipe.js` | An existing window may still run an older extension after VSIX update removed its folder. Use **Developer: Reload Window** when it fits the user's current session, then re-query instances. Version 0.12.1+ copies helpers and their dependencies into `%LOCALAPPDATA%/QtProWorkbench/debug-runtime/<content hash>/`. Do not hardcode another extension version or patch `launch.json` to a guessed path. |
| `ImportError` / no Qt printers | Inspect Python setup-command errors and GDB identity. Qt 4.8.1 uses QtSDK's Python-enabled GDB 7.2 and packaged XQt4Printers, XQt4Values and XQt4Containers. Keep helper paths short: the legacy Python loader can fail on long paths. Do not assume modern Qt formatting is covered by the Qt 4 printers. |
| Raw QString internals / pointer only | Check the selected kit, executable symbols and successful printer registration. Read an in-scope local through current frame/scopes, then evaluate the same plain variable. Optimized-out values or unreadable memory are not a failed launch. |
| Unverified breakpoint / no stop | Check exact source path, selected Run target and matching debug symbols. A stale or different-root EXE can contain similarly named sources. Resolve qmake outputs or CMake File API targets; do not pick the first EXE in a folder. |
| Stale stop/frame/reference | Re-read state and stack after execution changes. Do not reuse identifiers from a previous stop or another window. |
| Pause fails on legacy GDB | Use `qt_debug_control` pause. Qt Pro validates the debugger's process ID and executable before its 32-bit Windows break helper. Do not send interrupts to a guessed PID or kill a process by name. |
| Compiler/startup reports missing DLL | Keep the Qt/MinGW environment together. For a standalone Qt 4 test, load the available `qt4-build` skill: inspect imports, copy matching dependencies into owned test output and verify startup. Do not replace system DLLs or mix newer MinGW objects/runtimes. |
| VSIX double-click opens Microsoft VSIX Installer | Install from VS Code's Extensions view → Install from VSIX, or the official `code --install-extension <path>`. Visual Studio's installer is a different product. |

Reloading a user window can interrupt a live debug session. Inspect current state first and respect the task's scope. For UI-only commands use an available editor-control capability, or give the exact action if none exists; do not claim an unseen reload succeeded.
