# VS Code editor operations

Use the official VS Code CLI for operations it exposes. Qt Pro selection/build/debug uses its official API bridge; read [projects.md](projects.md) when needed. Run UI-only commands through an already available editor bridge or supported Computer Use. This skill documents workflows; it does not add an arbitrary remote editor API.

## Locate and target

Resolve `code.cmd` with `Get-Command code.cmd`, or check `$env:LOCALAPPDATA/Programs/Microsoft VS Code/bin/code.cmd`, then `$env:ProgramFiles/Microsoft VS Code/bin/code.cmd`. Verify the file and use `--help` for uncertain flags. Use the existing installation/profile; do not create an empty profile to manipulate the user's editor.

`--reuse-window` targets the **last active window**, not a Qt Pro `instanceId`. Establish the intended window before operations that depend on editor state. Opening a `.pro` as text is different from activating its project for build/run.

Pass literal PowerShell arguments or native argument arrays and use full paths. A sandbox error is not proof that VS Code is unavailable; handle permissions normally within the authorized task.

## CLI operations

The [official CLI](https://code.visualstudio.com/docs/configure/command-line) supports file opening, diff views, extension management and diagnostics. Once `$codeCli` is the verified executable path:

```powershell
& $codeCli --reuse-window --goto 'F:\Work\App\main.cpp:80:1'
& $codeCli --diff 'F:\Work\App\before.cpp' 'F:\Work\App\after.cpp'
& $codeCli --list-extensions --show-versions
& $codeCli --install-extension 'C:\Users\User\Downloads\qt-pro-workbench-0.12.3.vsix' --force
```

Check source existence before opening it; a missing path creates an unsaved file. Install/remove extensions only within the request and query versions afterward. CLI success proves the request was sent/installed; it does not establish current cursor, active project or successful extension activation. Verify through API/UI when relevant.

## Editor-only commands

For Qt Pro settings, navigation and reference scope, read [qt-workbench.md](qt-workbench.md). For debugging, read [debugging.md](debugging.md).

`vscode.commands.executeCommand` runs **inside an extension host**, not PowerShell or a general CLI flag. Qt Pro's `help` lists external operations; it does not dispatch arbitrary editor commands. Do not invent `qt_open_file`, `qt_find_references`, `code --command`, `command:` URL execution or temporary injected extensions.

For a UI-only action, use a currently exposed editor bridge if available; otherwise use supported Computer Use and observe the window. If neither capability exists, complete independent API/CLI work and state the exact remaining UI action. Preserve unsaved edits and live debug sessions when reloading/replacing a workspace. Do not edit workspaceState, databases or kits.json to simulate an editor selection.
