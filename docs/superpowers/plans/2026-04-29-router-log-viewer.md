# Router Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live log viewer for border routers, accessible via a "View Logs" button in the topology detail pane.

**Architecture:** Extract the terminal output UI from the setup wizard into a shared `TerminalOutput` component. Store the SCION project folder in the session module so the log viewer can resolve `<folder>/logs/<routerName>.log`. A Rust `start_log_stream` command spawns `tail -n 200 -f` and streams lines via Tauri events; `stop_log_stream` kills the process. A new `/app/logs/$routerName` route inside the AppShell renders the viewer using the shared component.

**Tech Stack:** React 19, TypeScript, Mantine 9, TanStack Router, Tauri 2, Rust + tokio, `tail` (Linux)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/TerminalOutput.tsx` | Create | Shared scrollable terminal output with optional header bar |
| `src/lib/session.ts` | Modify | Add `setFolder` / `getFolder` alongside existing topology storage |
| `src/lib/session.test.ts` | Create | Unit tests for session module |
| `src/routes/setup.tsx` | Modify | Use `TerminalOutput`; call `session.setFolder` on success |
| `src-tauri/Cargo.toml` | Modify | Add `uuid` crate |
| `src-tauri/src/lib.rs` | Modify | `LogStreams` managed state, `start_log_stream`, `stop_log_stream` |
| `src/routes/app/logs.tsx` | Create | `RouterLogsRoute` — log viewer page |
| `src/router.tsx` | Modify | Register `/app/logs/$routerName` route |
| `src/components/TopologyView.tsx` | Modify | Add "View Logs" button to `RouterDetails` |

---

### Task 1: Extract TerminalOutput component

**Files:**
- Create: `src/components/TerminalOutput.tsx`
- Modify: `src/routes/setup.tsx`

- [ ] **Step 1: Create `src/components/TerminalOutput.tsx`**

```tsx
import { useEffect, useRef } from "react";
import {
  Box,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Text,
} from "@mantine/core";

interface TerminalOutputProps {
  lines: string[];
  title?: string;
  loading?: boolean;
}

export function TerminalOutput({ lines, title, loading }: TerminalOutputProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <ScrollArea h={500} viewportRef={viewportRef}>
      <Paper radius="md" withBorder style={{ overflow: "hidden" }}>
        {title !== undefined && (
          <>
            <Group justify="space-between" p="sm" bg="gray.9">
              <Text size="sm">{title}</Text>
              {loading && <Loader size="xs" />}
            </Group>
            <Divider />
          </>
        )}
        <Group gap={0} align="stretch">
          <Box
            py="sm"
            px="sm"
            bg="gray.9"
            style={{
              borderRight: "1px solid var(--mantine-color-gray-7)",
              userSelect: "none",
            }}
          >
            {lines.map((_, i) => (
              <Text
                key={i}
                size="xs"
                ff="monospace"
                c="dimmed"
                ta="right"
                lh={1.6}
              >
                {i + 1}
              </Text>
            ))}
          </Box>
          <Code block p="md" bg="gray.9" flex={1}>
            {lines.length > 0 ? lines.join("\n") : "Running…"}
          </Code>
        </Group>
      </Paper>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Update `LoadingStep` in `src/routes/setup.tsx` to use `TerminalOutput`**

Replace these imports in `setup.tsx` — remove `Box`, `Code`, `Divider`, `Group`, `Loader`, `Paper`, `ScrollArea` from the Mantine import (only if they are no longer used elsewhere in the file; keep any still needed). Add the new import:

```tsx
import { TerminalOutput } from "../components/TerminalOutput";
```

Replace the entire JSX return value of `LoadingStep` (the non-error branch) from:

```tsx
  return (
    <ScrollArea h={500} viewportRef={viewportRef}>
      <Paper radius="md" withBorder style={{ overflow: "hidden" }}>
        <Group justify="space-between" p="sm" bg="gray.9">
          <Text size="sm">{title}</Text>
          <Loader size="xs" />
        </Group>
        <Divider />
        <Group gap={0} align="stretch">
          <Box
            py="sm"
            px="sm"
            bg="gray.9"
            style={{
              borderRight: "1px solid var(--mantine-color-gray-7)",
              userSelect: "none",
            }}
          >
            {lines.map((_, i) => (
              <Text
                key={i}
                size="xs"
                ff="monospace"
                c="dimmed"
                ta="right"
                lh={1.6}
              >
                {i + 1}
              </Text>
            ))}
          </Box>
          <Code block p="md" bg="gray.9" flex={1}>
            {lines.length > 0 ? lines.join("\n") : "Running…"}
          </Code>
        </Group>
      </Paper>
    </ScrollArea>
  );
```

to:

```tsx
  return <TerminalOutput lines={lines} title={title} loading />;
```

Also remove the `viewportRef` ref and its scroll `useEffect` from `LoadingStep` — those are now inside `TerminalOutput`. The `lines` and `title` state remain in `LoadingStep`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/TerminalOutput.tsx src/routes/setup.tsx
git commit -m "feat(log-viewer): extract TerminalOutput shared component"
```

---

### Task 2: Add folder to session

**Files:**
- Modify: `src/lib/session.ts`
- Create: `src/lib/session.test.ts`
- Modify: `src/routes/setup.tsx`

- [ ] **Step 1: Write failing tests in `src/lib/session.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { session } from "./session";

describe("session folder", () => {
  it("getFolder returns null initially", () => {
    expect(session.getFolder()).toBeNull();
  });

  it("setFolder / getFolder round-trip", () => {
    session.setFolder("/tmp/scion-project");
    expect(session.getFolder()).toBe("/tmp/scion-project");
  });

  it("setFolder overwrites previous value", () => {
    session.setFolder("/tmp/first");
    session.setFolder("/tmp/second");
    expect(session.getFolder()).toBe("/tmp/second");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/session.test.ts
```

Expected: fails with `session.getFolder is not a function` or similar.

- [ ] **Step 3: Update `src/lib/session.ts`**

Replace the entire file content:

```ts
import type { Topology } from "../bindings";

let topology: Topology | null = null;
let folder: string | null = null;

export const session = {
  setTopology: (t: Topology) => {
    topology = t;
  },
  getTopology: () => topology,
  setFolder: (f: string) => {
    folder = f;
  },
  getFolder: () => folder,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/session.test.ts
```

Expected: 3 tests pass. Note: the "returns null initially" test passes only if the test file is the first to import the session module. Vitest isolates modules per file by default, so this is fine.

- [ ] **Step 5: Call `session.setFolder` in `LoadingStep` on success**

In `src/routes/setup.tsx`, in the `run()` function inside `LoadingStep`'s `useEffect`, find this block:

```ts
      await pushRecent("recent-folders", folder);
      await pushRecent("recent-topologies", topoFile);
      session.setTopology(topoResult.data);
      navigate({ to: "/app/topology" });
```

Replace with:

```ts
      await pushRecent("recent-folders", folder);
      await pushRecent("recent-topologies", topoFile);
      session.setFolder(folder);
      session.setTopology(topoResult.data);
      navigate({ to: "/app/topology" });
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts src/routes/setup.tsx
git commit -m "feat(log-viewer): store SCION folder in session"
```

---

### Task 3: Rust — log streaming commands

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `uuid` to `src-tauri/Cargo.toml`**

Add this line under `[dependencies]`:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 2: Add `LogStreams` managed state to `src-tauri/src/lib.rs`**

After the existing `use` statements at the top of `lib.rs`, add:

```rust
use std::collections::HashMap;
use std::sync::Mutex;

struct LogStreams(Mutex<HashMap<String, tokio::process::Child>>);
```

Note: `HashMap` is already imported via `use std::collections::HashMap;` at the top of the file. Check if it's already there — if so, skip that line.

- [ ] **Step 3: Add the `LogOutputPayload` type and `start_log_stream` command**

Add this after the existing `stream_output` function:

```rust
#[derive(serde::Serialize)]
struct LogOutputPayload {
    stream_id: String,
    line: String,
}

#[tauri::command]
#[specta::specta]
async fn start_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogStreams>,
    folder: String,
    router_name: String,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let log_path = std::path::Path::new(&folder)
        .join("logs")
        .join(format!("{router_name}.log"));

    if !log_path.exists() {
        return Err(format!("Log file not found: {}", log_path.display()));
    }

    let mut child = tokio::process::Command::new("tail")
        .args([
            "-n",
            "200",
            "-f",
            log_path.to_str().ok_or("Log path contains invalid Unicode")?,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn tail: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stream_id = uuid::Uuid::new_v4().to_string();

    {
        let mut map = state.0.lock().unwrap();
        map.insert(stream_id.clone(), child);
    }

    let app_clone = app.clone();
    let sid = stream_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            app_clone
                .emit(
                    "log-output",
                    LogOutputPayload {
                        stream_id: sid.clone(),
                        line,
                    },
                )
                .ok();
        }
    });

    Ok(stream_id)
}
```

- [ ] **Step 4: Add `stop_log_stream` command**

Add immediately after `start_log_stream`:

```rust
#[tauri::command]
#[specta::specta]
async fn stop_log_stream(
    state: tauri::State<'_, LogStreams>,
    stream_id: String,
) -> Result<(), String> {
    let mut child = {
        let mut map = state.0.lock().unwrap();
        map.remove(&stream_id)
            .ok_or_else(|| format!("Stream not found: {stream_id}"))?
    }; // lock dropped here before await
    child
        .kill()
        .await
        .map_err(|e| format!("Failed to kill tail process: {e}"))
}
```

- [ ] **Step 5: Register commands and managed state in `run()`**

In the `Builder` call, update `collect_commands![]` to include the two new commands:

```rust
    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        greet,
        load_project,
        setup_scion_network,
        list_topology_files,
        start_log_stream,
        stop_log_stream
    ]);
```

Add `.manage(LogStreams(Mutex::new(HashMap::new())))` to the Tauri builder chain, before `.invoke_handler(...)`:

```rust
    tauri::Builder::default()
        .plugin(/* existing plugins unchanged */)
        .manage(LogStreams(Mutex::new(HashMap::new())))
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

Also update the test at the bottom of `lib.rs` to include the new commands:

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        use tauri_specta::{collect_commands, Builder};
        Builder::<tauri::Wry>::new()
            .commands(collect_commands![
                super::greet,
                super::load_project,
                super::setup_scion_network,
                super::list_topology_files,
                super::start_log_stream,
                super::stop_log_stream
            ])
            .export(
                specta_typescript::Typescript::default().header("// @ts-nocheck"),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
```

- [ ] **Step 6: Regenerate bindings**

```bash
cd src-tauri && cargo test export_bindings && cd ..
```

Expected: test passes, `src/bindings.ts` updated with `startLogStream` and `stopLogStream`.

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat(log-viewer): add Rust log streaming commands"
```

---

### Task 4: Log viewer route + component

**Files:**
- Create: `src/routes/app/logs.tsx`
- Modify: `src/router.tsx`

- [ ] **Step 1: Create `src/routes/app/logs.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ActionIcon,
  Box,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../../bindings";
import { session } from "../../lib/session";
import { TerminalOutput } from "../../components/TerminalOutput";

interface LogOutputPayload {
  stream_id: string;
  line: string;
}

export function RouterLogsRoute() {
  const navigate = useNavigate();
  const { routerName } = useParams({ strict: false }) as { routerName: string };
  const folder = session.getFolder();
  const topology = session.getTopology();

  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);

  // Resolve AS ID and interface ID from topology for the meta strip
  let asId = "";
  let interfaceId: number | null = null;
  if (topology) {
    for (const link of topology.links) {
      if (link.a.router_name === routerName) {
        asId = link.a.as_id;
        interfaceId = link.a.interface_id;
        break;
      }
      if (link.b.router_name === routerName) {
        asId = link.b.as_id;
        interfaceId = link.b.interface_id;
        break;
      }
    }
  }

  useEffect(() => {
    if (!folder) {
      navigate({ to: "/setup" });
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function start() {
      const unlistenFn = await listen<LogOutputPayload>("log-output", (e) => {
        if (cancelled) return;
        if (e.payload.stream_id !== streamIdRef.current) return;
        setLines((prev) => [...prev, e.payload.line]);
      });

      if (cancelled) {
        unlistenFn();
        return;
      }
      unlisten = unlistenFn;

      const result = await commands.startLogStream(folder!, routerName);
      if (cancelled) return;
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      streamIdRef.current = result.data;
    }

    start();

    return () => {
      cancelled = true;
      unlisten?.();
      if (streamIdRef.current) {
        commands.stopLogStream(streamIdRef.current);
        streamIdRef.current = null;
      }
    };
  }, [folder, routerName, navigate]);

  return (
    <Stack gap={0} style={{ height: "100%" }}>
      {/* Header bar */}
      <Group
        px="md"
        py="xs"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => navigate({ to: "/app/topology" })}
          aria-label="Back to topology"
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Text fw={600} ff="monospace" size="sm">
          {routerName}
        </Text>
        <Text size="sm" c="dimmed">
          Logs
        </Text>
        <Box ml="auto" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Box
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--mantine-color-green-5)",
            }}
          />
          <Text size="xs" c="green">
            Live
          </Text>
        </Box>
      </Group>

      {/* Meta strip */}
      <Group
        px="md"
        py={4}
        gap="xl"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        {asId && (
          <Text size="xs" c="dimmed">
            AS{" "}
            <Text span size="xs" ff="monospace" c="default">
              {asId}
            </Text>
          </Text>
        )}
        {interfaceId !== null && (
          <Text size="xs" c="dimmed">
            Interface{" "}
            <Text span size="xs" ff="monospace" c="default">
              {interfaceId}
            </Text>
          </Text>
        )}
        <Text size="xs" c="dimmed">
          logs/
          <Text span size="xs" ff="monospace" c="default">
            {routerName}.log
          </Text>
        </Text>
      </Group>

      <Divider />

      {/* Log output */}
      <Box flex={1} p="md">
        {error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : (
          <TerminalOutput lines={lines} />
        )}
      </Box>
    </Stack>
  );
}
```

- [ ] **Step 2: Register the route in `src/router.tsx`**

Add the import at the top:

```ts
import { RouterLogsRoute } from "./routes/app/logs";
```

Add the route definition after `topologyRoute`:

```ts
const routerLogsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/logs/$routerName",
  component: RouterLogsRoute,
});
```

Update the route tree to include it:

```ts
const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  appRoute.addChildren([appIndexRoute, topologyRoute, routerLogsRoute]),
]);
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/app/logs.tsx src/router.tsx
git commit -m "feat(log-viewer): add router log viewer route and component"
```

---

### Task 5: Add "View Logs" button to RouterDetails

**Files:**
- Modify: `src/components/TopologyView.tsx`

- [ ] **Step 1: Add imports to `TopologyView.tsx`**

Add to the existing Mantine import:

```tsx
import { Badge, Button, Divider, Drawer, Group, Stack, Text } from "@mantine/core";
```

Add to the existing Tabler icons import:

```tsx
import { IconFileText } from "@tabler/icons-react";
```

Add after the other imports:

```tsx
import { useNavigate } from "@tanstack/react-router";
```

- [ ] **Step 2: Update `RouterDetails` to include the button**

Replace the entire `RouterDetails` function:

```tsx
function RouterDetails({ node }: { node: RouterNodeData }) {
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      <InfoItem label="Router" value={node.routerName} />
      <InfoItem label="AS" value={node.asId} />
      <InfoItem label="Interface ID" value={node.interfaceId} />
      <InfoItem label="Underlay local" value={node.underlayLocal} />
      <InfoItem label="Underlay remote" value={node.underlayRemote} />
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$routerName",
            params: { routerName: node.routerName },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/TopologyView.tsx
git commit -m "feat(log-viewer): add View Logs button to router detail pane"
```

---

## Manual Test Checklist

After all tasks are complete, run `npm run tauri dev` and verify:

- [ ] Setup wizard still works end-to-end (TerminalOutput renders correctly, folder is stored in session)
- [ ] Clicking a border router node opens the detail pane with a "View Logs" button
- [ ] Clicking "View Logs" navigates to `/app/logs/<routerName>` — sidebar stays visible
- [ ] Log viewer header shows router name, live dot, back arrow
- [ ] Meta strip shows AS ID, interface ID, log filename
- [ ] Log lines stream live from `<folder>/logs/<routerName>.log`
- [ ] Navigating back (← arrow) returns to the topology view
- [ ] Navigating away stops the `tail` process (verify via `ps aux | grep tail` — process gone)
- [ ] Opening a router with no log file shows a clear error message
