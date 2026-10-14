# Qt projects, connection and build control

Use Qt Pro's installed official API bridge for the existing VS Code window. No MCP registration is needed.

```powershell
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_list_instances
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation help
```

Choose `instanceId` from each entry's **state.activeProject / state.workspace**, not list order. The script is installed on Qt Pro activation. Re-query after reload; instance and session IDs expire. Distinguish an empty successful response from a sandbox/pipe error. If VS Code is known to run but sandbox access fails, use normal permission handling within the authorized task.

`help` supplies the installed version's schemas. Requests return an envelope with `ok` and `result` or `error`; errors exit with code 1. Use `-InstanceId` and `-ArgumentsJson`, or a UTF-8 `-RequestFile` shaped as `{"operation":"qt_get_state","arguments":{"instanceId":"..."}}`. Run the wrapper in a child PowerShell process because it calls `exit`. Do not expose discovery tokens.

Read `qt_get_state` before changing a project, kit, build or run configuration. Use IDs from its current lists. `qt_select_project` accepts an absolute `.pro` or `CMakeLists.txt` and opens/activates it without a picker. `qt_select_kit` selects `kitId`; build/run selection uses `configurationId`. Retain the user's selections unless the task calls for a change.

Resolve executables through saved Run settings and actual build outputs. For CMake, inspect `buildSystem`, `buildDirectory`, `automaticExecutable` and File API targets. Do not guess the first EXE in an output directory. Clarify a target if multiple executable outputs remain ambiguous.

`qt_build` accepts build, configure/qmake, clean, rebuild and deploy. The result is a job record with `id`. Poll `qt_get_job` with that `jobId` until succeeded/failed, initially about once per second and less often for long unchanged builds. Read bounded `qt_get_log` pages with `afterCursor` and advance `nextCursor`. Do not change selection while a job is active or launch an old executable after a failed build.

Qt 4.8.1 defaults to its matching 32-bit QtSDK toolchain and Python-enabled GDB 7.2. Respect an explicitly selected debugger. Newer Qt kits use their own tools. Qt Creator settings are imported once; subsequent changes are made through Kit Settings rather than rewriting Creator or extension internal files.

For a debug launch or breakpoint/variable task, additionally read [debugging.md](debugging.md). A command to open a source file does not activate that file's project for build/run.
