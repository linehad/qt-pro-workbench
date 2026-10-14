# Qt Pro debugging workflow

Read the installed `help` schemas if argument names differ. Use a shell child process for each request. In examples, replace IDs with values just queried from the intended window.

For an existing paused session, query `qt_list_instances` and choose `instanceId` by `state.activeProject / state.workspace`, then read state. The bridge returns `{ok, result}` or `{ok:false, error}`; unpack `result`. Read [projects.md](projects.md) only if connection setup or project/configuration selection is needed.

```powershell
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_get_state -InstanceId '<window ID>'
```

## Prepare and launch

1. Read current project, `kits` (`id` and `name`), `builds` and `runs`. Prefer the user's selected target. The API's kit list does not include full compiler paths; use Kit Settings for those details. `qt_select_project` opens and activates a `.pro` or `CMakeLists.txt` without a picker; selection does not build. Read state again after each relevant selection.
2. For source breakpoints, choose an executable with matching symbols. Keep a requested Release configuration; explain a missing-symbol limitation instead of silently switching to Debug. `qt_list_breakpoints` supplies stable IDs. `qt_set_breakpoints` adds/updates the requested locations and preserves others; control API lines and columns are **1-based**. Remove only the requested IDs with `qt_remove_breakpoints`.
3. `qt_start_debug` builds, deploys and launches asynchronously. Its `result.id` is the job ID. Poll `qt_get_job` with `{jobId: id}` until `status` is `succeeded` or `failed`; start at roughly 1 second, then back off for longer builds. Read bounded `qt_get_log` pages using `afterCursor` / `nextCursor`. Stop dependent launch/inspection work if a job fails. Do not select another project while a job runs.
4. A successful start job proves the launch completed. Read `qt_get_state.debug` to establish whether the intended session is paused, running or terminated. Starting another session is unnecessary when the requested session already exists.

```powershell
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_set_breakpoints -InstanceId '<window ID>' -ArgumentsJson '{"breakpoints":[{"file":"F:/Work/App/main.cpp","line":80}]}'
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_start_debug -InstanceId '<window ID>'
```

## Inspect the current stop

Use `sessionId`, **current `stopId`** and `threadId` from state. Call `qt_debug_stack` and choose the returned stack frame `id`; pass it as `frameId`. Then `qt_debug_scopes` provides Locals/Arguments `variablesReference`, which `qt_debug_variables` expands. Page results with `start` and `count` (maximum 200). Expand containers only when their returned reference is greater than 0.

Use `qt_debug_evaluate` with the same frame and stop for ordinary watch expressions such as `sText`, `qNames` or `m_stState`. It returns `result`, type and an expandable reference when available. Qt 4 printers cover QString, byte arrays, QVariant and common containers, including Korean text. Report an unavailable value as such; do not infer a value from a pointer address.

```powershell
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_debug_stack -InstanceId '<window ID>' -ArgumentsJson '{"sessionId":"<session ID>","stopId":1}'
& "$env:LOCALAPPDATA\QtProWorkbench\control-api\QtControl.ps1" -Operation qt_debug_evaluate -InstanceId '<window ID>' -ArgumentsJson '{"sessionId":"<session ID>","stopId":1,"frameId":1000,"expression":"sText"}'
```

## Control and verify

| Action | Meaning |
| --- | --- |
| `continue` | Resume the session. |
| `next` | Step over the current source line. |
| `stepIn` | Step into a call when symbols permit. |
| `stepOut` | Return from the current frame. |
| `pause` | Interrupt the running intended session. |
| `stop` | Terminate the intended debug session. |

Call `qt_debug_control` with `sessionId`, action, and the current `stopId` for resume/step. Pause and stop can target a running session without a stop ID. After resume/step, poll state for a **new paused stopId or termination**, then read stack/scopes afresh. Frame IDs and variable references expire on every resume/step; a stale-ID error requires a fresh query, not retrying the old request. After stop, verify termination in state.

Keep the user's requested end state: leave paused for inspection when appropriate; do not stop an existing user session merely to finish a report. If you created temporary breakpoints, remove only your own unless the user asked to keep them.
