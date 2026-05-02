# Service Logs — Design Spec

**Date:** 2026-05-02  
**Status:** Approved

## Overview

Extend the existing border-router log viewer to support three additional SCION service types: control service, SCION daemon, and Hummingbird. Entry point is a new "View Services" button in the AS detail drawer, which pushes a services sub-drawer via Mantine DrawerStack. Each service has a log link navigating to the existing log viewer route.

## Log File Naming

All service log files live in `{folder}/logs/` and follow the pattern `{service_id}.log`:

| Service | Example filename | Source of ID |
|---|---|---|
| Border router | `br1-ff00_0_110-1.log` | `router_name` (existing) |
| Control service | `cs1-ff00_0_110-1.log` | `ControlServiceInfo.name` (existing) |
| SCION daemon | `sd1-ff00_0_110.log` | `sd.toml` → `[general].id` |
| Hummingbird | `hbird1-ff00_0_110.log` | `HbirdInfo.id` (existing) |

## Rust Backend (`src-tauri/src/topology/mod.rs`)

### New types

```rust
#[derive(Debug, Deserialize)]
pub struct RawSdConfig {
    pub general: RawSdGeneral,
}

#[derive(Debug, Deserialize)]
pub struct RawSdGeneral {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ScionDaemonInfo {
    pub id: String,
}
```

### `AsInfo` change

Add `daemon: ScionDaemonInfo` (non-optional — missing `sd.toml` is an error).

### `build_topology` signature change

Accept `sd_map: HashMap<IsdAsnDef, RawSdConfig>` alongside `hbird_map`. Populate `daemon` from `sd_map`; return error if entry missing for any AS.

## Rust Backend (`src-tauri/src/lib.rs`)

In `load_project`, alongside the `hbird.toml` read: read `sd.toml` from each AS directory into `sd_map`. Missing `sd.toml` → error. Pass `sd_map` to `build_topology`.

## Route Generalization

Rename route param `$routerName` → `$serviceName` in:

- `src/router.tsx` — path `/logs/$serviceName`, component renamed to `ServiceLogsRoute`
- `src/routes/app/logs.tsx` — read `params.serviceName`, pass as `router_name` arg to `start_log_stream`

`RouterDetails` "View Logs" button navigates with `{ serviceName: node.routerName }`.

No Rust command signature changes — `start_log_stream(folder, router_name)` already accepts any string.

## Frontend Types (`src/lib/topology.ts`)

Add `daemon_info: ScionDaemonInfo` (non-optional) to `AsNodeData`. Import `ScionDaemonInfo` from `../bindings`. Update `buildGraph` to populate `daemon_info` from `asInfo.daemon`.

## UI: AS Detail Drawer → DrawerStack

### Structure

`TopologyView` wraps its content with Mantine `DrawerStack`. The existing detail `Drawer` becomes the first drawer in the stack.

### `AsDetails` additions

Add a "View Services" button that pushes a second drawer onto the stack with title "Services — {asId}".

### Services sub-drawer content

Each service is rendered as a labeled row with a TanStack Router `<Link>` styled as a Mantine `Anchor`, navigating to `/app/logs/$serviceName`:

- **Control Service** — `control_service.name`
- **SCION Daemon** — `daemon_info.id`
- **Hummingbird** — `hbird_info.id` (row omitted if `hbird_info` is null)

Clicking a log link closes both drawers and navigates to the log viewer.

## Error Handling

- Missing `sd.toml` → `load_project` returns error (surface to user same as missing `topology.json`)
- Hummingbird remains optional — row simply absent from services drawer if null

## Out of Scope

- Discovery service logs (no log file exists for it)
- Dispatcher / supervisord logs
- Dynamic log file discovery
