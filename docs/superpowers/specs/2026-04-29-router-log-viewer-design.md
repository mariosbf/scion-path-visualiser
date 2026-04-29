# Router Log Viewer Design

**Date:** 2026-04-29
**Feature:** Live log viewer for border routers, accessible from the topology detail pane

## Overview

Clicking a border router node in the topology view opens a detail pane. A "View Logs" button in that pane navigates to a dedicated log viewer page (`/app/logs/:routerName`) inside the existing AppShell layout. The page streams the router's log file live using `tail -f` on the Rust side, displaying output in the shared `TerminalOutput` component extracted from the setup wizard.

---

## Shared Component: `TerminalOutput`

Extract the terminal UI from `LoadingStep` in `src/routes/setup.tsx` into a new standalone component.

**File:** `src/components/TerminalOutput.tsx`

```tsx
interface TerminalOutputProps {
  lines: string[];
  title?: string;   // optional header bar text
  loading?: boolean; // show spinner in header bar when true
}
```

Renders a `Paper` with:
- An optional header bar (title + spinner) — shown when `title` is provided
- A line-numbered monospace code block using Mantine `Code`

`LoadingStep` becomes a thin wrapper: it owns the `lines`, `title`, and `loading` state, and passes them to `TerminalOutput`. No behaviour changes to the setup wizard.

---

## Session: Store SCION Folder

The log viewer needs the original SCION project folder path to resolve `<folder>/logs/<routerName>.log`. The session module currently only stores topology.

**File:** `src/lib/session.ts`

Add `folder: string | null` alongside `topology`. Expose `setFolder` / `getFolder`.

**File:** `src/routes/setup.tsx` — `LoadingStep`

After `pushRecent` calls succeed, call `session.setFolder(folder)` before `session.setTopology(...)`.

---

## Rust Backend

### Managed State

```rust
struct LogStreams(Mutex<HashMap<String, tokio::process::Child>>);
```

Registered via `.manage(LogStreams(Mutex::new(HashMap::new())))` in `run()`.

### Command: `start_log_stream`

```rust
#[tauri::command]
#[specta::specta]
async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogStreams>,
    folder: String,
    router_name: String,
) -> Result<String, String>
```

1. Builds log path: `<folder>/logs/<router_name>.log`
2. Spawns `tail -n 200 -f <log_path>` with stdout piped
3. Generates a UUID stream ID
4. Stores the child in `LogStreams` under the stream ID
5. Spawns a detached tokio task that reads stdout line-by-line and emits `"log-output"` events with payload `LogOutputPayload { stream_id, line }`
6. Returns the stream ID

### Command: `stop_log_stream`

```rust
#[tauri::command]
#[specta::specta]
async fn stop_log_stream(
    state: tauri::State<'_, LogStreams>,
    stream_id: String,
) -> Result<(), String>
```

Removes the child from the map and calls `child.kill().await`.

### Event payload type

```rust
#[derive(Serialize)]
struct LogOutputPayload {
    stream_id: String,
    line: String,
}
```

Tauri events are not specta-typed — `Serialize` is sufficient. The frontend uses `listen<{ stream_id: string; line: string }>("log-output", ...)` directly.

Both commands registered in `collect_commands![]`.

### Mutex safety in `stop_log_stream`

Cannot hold the `MutexGuard` across `.kill().await`. Correct pattern:

```rust
let mut child = {
    let mut map = state.0.lock().unwrap();
    map.remove(&stream_id).ok_or("Stream not found")?
}; // lock dropped here
child.kill().await.map_err(|e| e.to_string())
```

---

## Routing

**File:** `src/router.tsx`

New route as a child of `appRoute`:

```ts
const routerLogsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/logs/$routerName",
  component: RouterLogsRoute,
});
```

Added to `appRoute.addChildren([appIndexRoute, topologyRoute, routerLogsRoute])`.

---

## Log Viewer Page

**File:** `src/routes/app/logs.tsx`

Component: `RouterLogsRoute`

- Reads `routerName` from `useParams()`
- Reads `folder` from `session.getFolder()`; redirects to `/setup` if null
- On mount: calls `commands.startLogStream(folder, routerName)`, stores stream ID, listens to `"log-output"` events, filters by stream ID, appends lines
- On unmount: calls `commands.stopLogStream(streamId)`, unlistens

**Layout (inside AppShell.Main):**

```
┌─────────────────────────────────────────────────────┐
│ ← Topology  |  br1-ff00_0_110-1  Logs        ● Live │  ← header bar
│─────────────────────────────────────────────────────│
│ AS 1-ff00:0:110  Interface 22076  logs/br1-…-1.log  │  ← meta strip
│─────────────────────────────────────────────────────│
│  1 │ [2026-04-29 12:00:01] INFO  Starting router…   │
│  2 │ [2026-04-29 12:00:01] DEBUG Loaded config…     │  ← TerminalOutput
│  … │ …                                              │
└─────────────────────────────────────────────────────┘
```

- **Header bar**: back link (`← Topology` via `useNavigate`), router name, animated live dot
- **Meta strip**: AS ID, interface ID, log file path — passed as route search params or derived from `RouterNodeData`
- **TerminalOutput**: receives `lines[]`, no title/loading (header bar handles status)

### Passing router metadata to the log page

`RouterDetails` passes `asId` and `interfaceId` alongside `routerName` when navigating, using TanStack Router search params:

```ts
navigate({
  to: "/app/logs/$routerName",
  params: { routerName: node.routerName },
  search: { asId: node.asId, interfaceId: node.interfaceId },
})
```

The log route declares these as optional search params and uses them for the meta strip.

---

## RouterDetails Change

**File:** `src/components/TopologyView.tsx`

Add a "View Logs" button at the bottom of `RouterDetails`:

```tsx
<Button
  variant="light"
  leftSection={<IconFileText size={14} />}
  onClick={() =>
    navigate({
      to: "/app/logs/$routerName",
      params: { routerName: node.routerName },
      search: { asId: node.asId, interfaceId: node.interfaceId },
    })
  }
>
  View Logs
</Button>
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/TerminalOutput.tsx` | Create | Shared terminal output UI (extracted from setup wizard) |
| `src/routes/setup.tsx` | Modify | Use `TerminalOutput` component; call `session.setFolder` on success |
| `src/lib/session.ts` | Modify | Add `folder` storage (`setFolder` / `getFolder`) |
| `src/routes/app/logs.tsx` | Create | `RouterLogsRoute` — log viewer page |
| `src/router.tsx` | Modify | Add `/app/logs/$routerName` route |
| `src/components/TopologyView.tsx` | Modify | Add "View Logs" button to `RouterDetails` |
| `src-tauri/src/lib.rs` | Modify | Add `LogStreams` state, `start_log_stream`, `stop_log_stream` commands |

---

## Out of Scope

- Log filtering or search
- Viewing logs for non-router processes (control service, daemon, etc.)
- Persisting or exporting log output
- Handling log rotation (if the file is replaced, `tail -f` on Linux follows by default)
