# Setup Wizard Design

**Date:** 2026-04-27
**Feature:** App launch workflow — SCION folder + topology selection, configuration, and loading

## Overview

When the app launches, the user is taken through a full-screen 4-step wizard before reaching the main app shell. The wizard collects a SCION project folder and topology file, passes through an empty configuration step, then runs `scion.sh` and streams its output live. On success, the user lands on the topology view.

---

## Routing

TanStack Router (manually-defined routes, not file-based):

```
/setup                 → SetupWizard (full-screen, no AppShell)
/app                   → AppShell layout route
  /app/topology        → TopologyView
  /app/               → redirect to /app/topology
```

- `main.tsx` renders `<RouterProvider>` at the root.
- A `beforeLoad` guard on `/` redirects to `/setup`.
- After the wizard completes successfully, the router navigates to `/app/topology`.
- Visiting `/setup` after a session is loaded redirects to `/app`.
- The existing `App.tsx` shell becomes the `/app` layout route. Sidebar nav items will drive child-route navigation in future.

---

## Wizard

Full-screen, no AppShell chrome. Mantine `Stepper` across the top; step content below.

### Step 1 — SCION Folder

- "Browse…" button opens a Tauri directory picker (`open({ directory: true })`).
- Scrollable list of recently used folders below (from store, max 10, most recent first). Clicking one selects it immediately.
- "Next" disabled until a folder is selected.

### Step 2 — Topology

- Single merged list with two labelled sections:
  - **In project**: `.topo` files found by scanning `<selectedFolder>/topology/` (flat scan, non-recursive).
  - **Recent**: topology paths from the store (max 10, most recent first).
- "Browse…" fallback button for files outside the folder.
- "Next" disabled until a selection is made.

### Step 3 — Configuration

- Placeholder text only. No inputs.
- "Next" always enabled. Reserved for future configuration options.

### Step 4 — Loading

- No user input. Entered automatically when the user clicks "Start" on Step 3.
- On mount:
  1. Frontend calls `run_scion(folder, topoFile)` Tauri command.
  2. Listens to `scion-output` events, appends each line to a scrolling monospace terminal box.
  3. On `run_scion` resolving `Ok(copiedGenDir)`: calls `commands.loadProject(copiedGenDir)`.
  4. On `loadProject` success: persists both paths to store, navigates to `/app/topology` passing topology data via router navigation state.
  5. On any failure: shows error inline with a "Back" button that resets the wizard to Step 1 (folder selection).
- No "Next" button — progress is fully automatic.

---

## Persistence

**Library:** `@tauri-apps/plugin-store` (store file: `recent.json` in app data dir)

**Keys:**
- `recent-folders`: `string[]` — max 10, most recent first
- `recent-topologies`: `string[]` — max 10, most recent first

**Module:** `src/lib/store.ts` — two helpers:
- `getRecent(key: "recent-folders" | "recent-topologies"): Promise<string[]>`
- `pushRecent(key, value: string): Promise<void>` — dedupes, prepends, trims to 10

Store is updated only on successful `loadProject`.

---

## Wizard State

Ephemeral — held in the `/setup` route component only, not global:

```ts
interface WizardState {
  folder: string | null;
  topoFile: string | null;
}
```

Passed to step components as props. Discarded on navigation to `/app`.

---

## Topology Handoff

After `loadProject` succeeds in Step 4, the topology data is passed to `/app/topology` via TanStack Router navigation state:

```ts
router.navigate({
  to: "/app/topology",
  state: { topology },
});
```

`TopologyView` reads `topology` from router state on mount and skips the load step. This avoids running `loadProject` twice.

---

## Rust Backend

### New command: `run_scion`

```rust
#[tauri::command]
async fn run_scion(
    window: tauri::Window,
    folder: String,
    topo_file: String,
) -> Result<String, String>  // returns path to copied gen dir on success
```

- Spawns `./scion.sh topology -c <topo_file>` via `tokio::process::Command`, with `current_dir` set to `folder`.
- Reads stdout and stderr line by line, emitting one `scion-output` Tauri event per line.
- On non-zero exit or spawn failure: returns `Err(message)`.
- On success (exit code 0): copies `<folder>/gen/` to a project-owned location in the Tauri app data dir, e.g. `<appDataDir>/projects/<sanitised-folder-name>/gen/`. Returns `Ok(copiedGenDir)`.

The frontend passes `copiedGenDir` to `load_project`.

### Modified command: `load_project`

Signature changes — no longer takes `topo_file`, no longer calls `scion.sh`:

```rust
#[tauri::command]
fn load_project(gen_dir: String) -> Result<Topology, String>
```

Reads `<gen_dir>/AS*/topology.json` via glob (same logic as today, path adjusted). This keeps `load_project` a pure parser with no side effects.

### Capabilities (`src-tauri/capabilities/default.json`)

Add `"store:default"` permission for `plugin-store`. Event emission (`window.emit`) is allowed by default in Tauri 2.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main.tsx` | Modify | Wrap with `<RouterProvider>` |
| `src/router.ts` | Create | TanStack Router instance, route definitions, `/` → `/setup` redirect |
| `src/routes/setup.tsx` | Create | SetupWizard with Mantine Stepper, 4 steps |
| `src/routes/app.tsx` | Create | AppShell layout route (extracted from current `App.tsx`) |
| `src/routes/app/topology.tsx` | Create | TopologyView route (reads topology from router state) |
| `src/App.tsx` | Remove or repurpose | Logic moves to `routes/app.tsx` |
| `src/lib/store.ts` | Create | `getRecent` / `pushRecent` helpers wrapping plugin-store |
| `src-tauri/src/lib.rs` | Modify | Add `run_scion` command, register in `generate_handler!` |
| `src-tauri/capabilities/default.json` | Modify | Add `store:default` permission |
