# Topology Visualiser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a SCION project folder, run `scion.sh topology` to generate `gen/`, read the per-AS `topology.json` files, and display the network as an interactive React Flow graph with a details Drawer.

**Architecture:** Rust parses the generated `gen/AS*/topology.json` files, deduplicates links across ASes, and returns a typed `Topology` via a Tauri `invoke` command. The frontend transforms this into React Flow compound nodes (ISD → AS → router circles) using Dagre for layout, with a Mantine Drawer for per-element details.

**Tech Stack:** Rust (`serde_json`, `glob`, `std::process::Command`, `scion-proto`, `specta`), TypeScript (`@xyflow/react`, `@dagrejs/dagre`, `@tauri-apps/plugin-dialog`, Mantine), Vitest for frontend tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/topology/mod.rs` | Create | All Rust types, `RawAsTopology`, `build_topology` |
| `src-tauri/src/lib.rs` | Modify | `load_project` command, plugin init, module declaration |
| `src-tauri/Cargo.toml` | Modify | Add `glob`, `tauri-plugin-dialog` |
| `src-tauri/capabilities/default.json` | Modify | Add `dialog:default` permission |
| `src/lib/topology.ts` | Create | `buildGraph` — `Topology` → React Flow nodes/edges |
| `src/lib/topology.test.ts` | Create | Vitest tests for `buildGraph` |
| `src/lib/layout.ts` | Create | `layoutGraph` — positions nodes via Dagre |
| `src/lib/layout.test.ts` | Create | Vitest tests for `layoutGraph` |
| `src/components/nodes/IsdNode.tsx` | Create | React Flow custom ISD rectangle node |
| `src/components/nodes/AsNode.tsx` | Create | React Flow custom AS rectangle node |
| `src/components/nodes/RouterNode.tsx` | Create | React Flow custom router circle node |
| `src/components/TopologyView.tsx` | Create | File pickers, React Flow canvas, Drawer |
| `src/App.tsx` | Modify | Render `TopologyView` in `AppShell.Main` |
| `vite.config.ts` | Modify | Add Vitest config |

---

## Task 1: Rust topology types + IsdAsnDef

**Files:**
- Create: `src-tauri/src/topology/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add Cargo dependencies**

In `src-tauri/Cargo.toml`, add under `[dependencies]`:
```toml
glob = "0.3"
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Create the topology module**

Create `src-tauri/src/topology/mod.rs`:

```rust
use std::collections::HashMap;
use scion_proto::address::IsdAsn;
use serde::{Deserialize, Serialize};

// ── IsdAsnDef ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IsdAsnDef(pub IsdAsn);

impl specta::Type for IsdAsnDef {
    fn inline(_: &mut specta::TypeMap, _: specta::Generics) -> specta::DataType {
        specta::DataType::Primitive(specta::datatype::PrimitiveType::String)
    }
}

// ── Tauri-facing types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Topology {
    pub ases: HashMap<IsdAsnDef, AsInfo>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AsInfo {
    pub core: bool,
    pub mtu: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Link {
    pub a: LinkEndpoint,
    pub b: LinkEndpoint,
    pub link_type: LinkType,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkEndpoint {
    pub as_id: IsdAsnDef,
    pub router_name: String,
    pub interface_id: u32,
    pub underlay_local: String,
    pub underlay_remote: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum LinkType {
    Core,
    Child,
    Peer,
}

// ── Raw types for JSON deserialization ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RawAsTopology {
    pub isd_as: IsdAsnDef,
    pub attributes: Vec<String>,
    pub mtu: Option<u32>,
    pub border_routers: HashMap<String, RawBorderRouter>,
}

#[derive(Debug, Deserialize)]
pub struct RawBorderRouter {
    pub interfaces: HashMap<String, RawInterface>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawInterface {
    pub isd_as: IsdAsnDef,
    pub link_to: String,
    pub mtu: Option<u32>,
    pub underlay: RawUnderlay,
    pub remote_interface_id: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawUnderlay {
    pub local: String,
    pub remote: String,
}
```

- [ ] **Step 3: Declare the module in lib.rs**

Add to the top of `src-tauri/src/lib.rs`:
```rust
pub mod topology;
```

- [ ] **Step 4: Write the serde round-trip test**

Add to the end of `src-tauri/src/topology/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isd_asn_def_serde_roundtrip() {
        let ia: IsdAsnDef = serde_json::from_str(r#""1-ff00:0:110""#).unwrap();
        assert_eq!(serde_json::to_string(&ia).unwrap(), r#""1-ff00:0:110""#);
    }

    #[test]
    fn raw_as_topology_deserializes() {
        let json = r#"{
            "attributes": ["core"],
            "isd_as": "1-ff00:0:110",
            "mtu": 1472,
            "border_routers": {
                "br1": {
                    "internal_addr": "127.0.0.1:31000",
                    "interfaces": {
                        "1001": {
                            "underlay": {"local": "127.0.0.1:50000", "remote": "127.0.0.2:50000"},
                            "isd_as": "1-ff00:0:111",
                            "link_to": "child",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        let raw: RawAsTopology = serde_json::from_str(json).unwrap();
        assert!(raw.attributes.contains(&"core".to_string()));
        assert_eq!(raw.mtu, Some(1472));
        assert!(raw.border_routers.contains_key("br1"));
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test topology::tests
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/topology/mod.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(topology): add Rust data types, IsdAsnDef, and raw deserialization structs"
```

---

## Task 2: build_topology function

**Files:**
- Modify: `src-tauri/src/topology/mod.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/topology/mod.rs`:

```rust
    fn make_fixture() -> Vec<RawAsTopology> {
        let json_110 = r#"{
            "attributes": ["core"],
            "isd_as": "1-ff00:0:110",
            "mtu": 1472,
            "border_routers": {
                "br1-ff00_0_110-1": {
                    "internal_addr": "127.0.0.1:31000",
                    "interfaces": {
                        "1001": {
                            "underlay": {"local": "127.0.0.1:50000", "remote": "127.0.0.2:50000"},
                            "isd_as": "1-ff00:0:111",
                            "link_to": "child",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        let json_111 = r#"{
            "attributes": [],
            "isd_as": "1-ff00:0:111",
            "mtu": 1472,
            "border_routers": {
                "br1-ff00_0_111-1": {
                    "internal_addr": "127.0.0.2:31000",
                    "interfaces": {
                        "2001": {
                            "underlay": {"local": "127.0.0.2:50000", "remote": "127.0.0.1:50000"},
                            "isd_as": "1-ff00:0:110",
                            "link_to": "parent",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        vec![
            serde_json::from_str(json_110).unwrap(),
            serde_json::from_str(json_111).unwrap(),
        ]
    }

    #[test]
    fn build_topology_produces_correct_ases() {
        let topo = build_topology(make_fixture());
        assert_eq!(topo.ases.len(), 2);
        let as110 = topo.ases.iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:110")
            .unwrap();
        assert!(as110.1.core);
        assert_eq!(as110.1.mtu, Some(1472));
        let as111 = topo.ases.iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:111")
            .unwrap();
        assert!(!as111.1.core);
    }

    #[test]
    fn build_topology_deduplicates_to_one_link() {
        let topo = build_topology(make_fixture());
        assert_eq!(topo.links.len(), 1);
    }

    #[test]
    fn build_topology_child_link_endpoints() {
        let topo = build_topology(make_fixture());
        let link = &topo.links[0];
        assert!(matches!(link.link_type, LinkType::Child));
        // Link processed from smaller IsdAsn side (1-ff00:0:110 < 1-ff00:0:111)
        assert_eq!(link.a.as_id.0.to_string(), "1-ff00:0:110");
        assert_eq!(link.a.router_name, "br1-ff00_0_110-1");
        assert_eq!(link.a.interface_id, 1001);
        assert_eq!(link.b.as_id.0.to_string(), "1-ff00:0:111");
        assert_eq!(link.b.router_name, "br1-ff00_0_111-1");
        assert_eq!(link.b.interface_id, 2001);
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd src-tauri && cargo test topology::tests::build_topology
```

Expected: compile error — `build_topology` not found.

- [ ] **Step 3: Implement build_topology**

Add before the `#[cfg(test)]` block in `src-tauri/src/topology/mod.rs`:

```rust
pub fn build_topology(raw_ases: Vec<RawAsTopology>) -> Topology {
    let ases: HashMap<IsdAsnDef, AsInfo> = raw_ases
        .iter()
        .map(|r| {
            (
                r.isd_as,
                AsInfo {
                    core: r.attributes.contains(&"core".to_string()),
                    mtu: r.mtu,
                },
            )
        })
        .collect();

    // Build interface index: (as_id, interface_id) -> (router_name, interface)
    let mut iface_index: HashMap<(IsdAsnDef, u32), (String, RawInterface)> = HashMap::new();
    for raw_as in &raw_ases {
        for (router_name, router) in &raw_as.border_routers {
            for (if_id_str, iface) in &router.interfaces {
                if let Ok(if_id) = if_id_str.parse::<u32>() {
                    iface_index.insert(
                        (raw_as.isd_as, if_id),
                        (router_name.clone(), iface.clone()),
                    );
                }
            }
        }
    }

    let mut links: Vec<Link> = Vec::new();

    for raw_as in &raw_ases {
        for (router_name, router) in &raw_as.border_routers {
            for (if_id_str, iface) in &router.interfaces {
                let local_as = raw_as.isd_as;
                let remote_as = iface.isd_as;

                // Process each link only from the side with the smaller IsdAsn u64 value
                if local_as.0.to_u64() >= remote_as.0.to_u64() {
                    continue;
                }

                let if_id: u32 = match if_id_str.parse() {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                // Find the remote endpoint
                let remote_endpoint = if let Some(remote_if_id) = iface.remote_interface_id {
                    // Peer link: remote_interface_id is provided directly
                    iface_index
                        .get(&(remote_as, remote_if_id))
                        .map(|(rn, ri)| {
                            (rn.clone(), remote_if_id,
                             ri.underlay.local.clone(), ri.underlay.remote.clone())
                        })
                } else {
                    // Core/child/parent: find remote interface pointing back to local_as
                    iface_index
                        .iter()
                        .find(|(key, (_, ri))| key.0 == remote_as && ri.isd_as == local_as)
                        .map(|(key, (rn, ri))| {
                            (rn.clone(), key.1,
                             ri.underlay.local.clone(), ri.underlay.remote.clone())
                        })
                };

                let (remote_router, remote_if_id, remote_local, remote_remote) =
                    match remote_endpoint {
                        Some(ep) => ep,
                        None => continue,
                    };

                let link_type = match iface.link_to.as_str() {
                    "core" => LinkType::Core,
                    "child" | "parent" => LinkType::Child,
                    "peer" => LinkType::Peer,
                    _ => continue,
                };

                links.push(Link {
                    a: LinkEndpoint {
                        as_id: local_as,
                        router_name: router_name.clone(),
                        interface_id: if_id,
                        underlay_local: iface.underlay.local.clone(),
                        underlay_remote: iface.underlay.remote.clone(),
                    },
                    b: LinkEndpoint {
                        as_id: remote_as,
                        router_name: remote_router,
                        interface_id: remote_if_id,
                        underlay_local: remote_local,
                        underlay_remote: remote_remote,
                    },
                    link_type,
                });
            }
        }
    }

    Topology { ases, links }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd src-tauri && cargo test topology::tests
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/topology/mod.rs
git commit -m "feat(topology): implement build_topology with link deduplication"
```

---

## Task 3: load_project Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add load_project to lib.rs**

Replace the full contents of `src-tauri/src/lib.rs` with:

```rust
pub mod topology;

use tauri_specta::{collect_commands, Builder};
use topology::{Topology, build_topology, RawAsTopology};

#[tauri::command]
#[specta::specta]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
#[specta::specta]
fn load_project(folder: String, topo_file: String) -> Result<Topology, String> {
    let output = std::process::Command::new("./scion.sh")
        .args(["topology", "-c", &topo_file])
        .current_dir(&folder)
        .output()
        .map_err(|e| format!("Failed to run scion.sh: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "scion.sh topology failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let pattern = format!("{folder}/gen/AS*/topology.json");
    let raw_ases: Vec<RawAsTopology> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern: {e}"))?
        .map(|entry| {
            let path = entry.map_err(|e| e.to_string())?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            serde_json::from_str::<RawAsTopology>(&content)
                .map_err(|e| format!("Failed to parse {}: {e}", path.display()))
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(build_topology(raw_ases))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![greet, load_project]);

    #[cfg(debug_assertions)]
    builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        use tauri_specta::{collect_commands, Builder};
        Builder::<tauri::Wry>::new()
            .commands(collect_commands![super::greet, super::load_project])
            .export(
                specta_typescript::Typescript::default(),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
```

- [ ] **Step 2: Add dialog permission to capabilities**

Replace `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 3: Compile and regenerate bindings**

```bash
cd src-tauri && cargo test export_bindings 2>&1 | tail -5
```

Expected: test passes and `src/bindings.ts` is updated — it now contains `Topology`, `AsInfo`, `Link`, `LinkEndpoint`, `LinkType`, `IsdAsnDef` (as `string`).

Verify the key types are present:
```bash
grep -E "Topology|LinkType|LinkEndpoint" ../src/bindings.ts
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json src/bindings.ts src-tauri/Cargo.lock
git commit -m "feat(topology): add load_project Tauri command and dialog plugin"
```

---

## Task 4: Frontend packages + Vitest setup

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `vite.config.ts`

- [ ] **Step 1: Install frontend dependencies**

```bash
npm install @xyflow/react @dagrejs/dagre
npm install @tauri-apps/plugin-dialog
npm install --save-dev vitest
```

- [ ] **Step 2: Add Vitest config to vite.config.ts**

Replace `vite.config.ts` with:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  test: {
    environment: "node",
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

- [ ] **Step 3: Verify Vitest runs**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: `No test files found` (no tests yet) — exits 0.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts package.json package-lock.json
git commit -m "chore: add @xyflow/react, @dagrejs/dagre, @tauri-apps/plugin-dialog, vitest"
```

---

## Task 5: buildGraph function

**Files:**
- Create: `src/lib/topology.ts`
- Create: `src/lib/topology.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/topology.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGraph } from "./topology";
import type { Topology } from "../bindings";

const tinyTopology: Topology = {
  ases: {
    "1-ff00:0:110": { core: true, mtu: 1472 },
    "1-ff00:0:111": { core: false, mtu: 1472 },
  },
  links: [
    {
      a: {
        as_id: "1-ff00:0:110",
        router_name: "br1-ff00_0_110-1",
        interface_id: 1001,
        underlay_local: "127.0.0.1:50000",
        underlay_remote: "127.0.0.2:50000",
      },
      b: {
        as_id: "1-ff00:0:111",
        router_name: "br1-ff00_0_111-1",
        interface_id: 2001,
        underlay_local: "127.0.0.2:50000",
        underlay_remote: "127.0.0.1:50000",
      },
      link_type: "Child",
    },
  ],
};

describe("buildGraph", () => {
  it("creates one ISD node per unique ISD", () => {
    const { nodes } = buildGraph(tinyTopology);
    const isdNodes = nodes.filter((n) => n.type === "isd");
    expect(isdNodes).toHaveLength(1);
    expect(isdNodes[0].id).toBe("isd-1");
  });

  it("creates AS nodes parented to their ISD node", () => {
    const { nodes } = buildGraph(tinyTopology);
    const asNodes = nodes.filter((n) => n.type === "as");
    expect(asNodes).toHaveLength(2);
    expect(asNodes.every((n) => n.parentId === "isd-1")).toBe(true);
  });

  it("creates one router node per unique (as_id, router_name) pair", () => {
    const { nodes } = buildGraph(tinyTopology);
    const routerNodes = nodes.filter((n) => n.type === "router");
    expect(routerNodes).toHaveLength(2);
    expect(routerNodes[0].parentId).toMatch(/^as-/);
  });

  it("creates edges connecting router nodes with link type", () => {
    const { edges } = buildGraph(tinyTopology);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("router-1-ff00:0:110-br1-ff00_0_110-1");
    expect(edges[0].target).toBe("router-1-ff00:0:111-br1-ff00_0_111-1");
    expect(edges[0].data?.linkType).toBe("Child");
  });

  it("deduplicates router nodes that appear in multiple links", () => {
    const multiLinkTopology: Topology = {
      ases: {
        "1-ff00:0:110": { core: true, mtu: 1472 },
        "1-ff00:0:111": { core: false, mtu: 1472 },
        "1-ff00:0:112": { core: false, mtu: 1472 },
      },
      links: [
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "b" },
          b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2, underlay_local: "b", underlay_remote: "a" },
          link_type: "Child",
        },
        {
          a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "c" },
          b: { as_id: "1-ff00:0:112", router_name: "br-112-1", interface_id: 3, underlay_local: "c", underlay_remote: "a" },
          link_type: "Child",
        },
      ],
    };
    const { nodes } = buildGraph(multiLinkTopology);
    // br-110-1 appears in both links but should only produce one router node
    const routerNodes = nodes.filter((n) => n.type === "router");
    const ids = routerNodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.includes("br-110-1"))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/topology.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module './topology'`.

- [ ] **Step 3: Create src/lib/topology.ts**

Create `src/lib/topology.ts`:

```typescript
import type { Node, Edge } from "@xyflow/react";
import type { Topology } from "../bindings";

export interface IsdNodeData extends Record<string, unknown> {
  label: string;
  isd: string;
}

export interface AsNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  core: boolean;
  mtu: number | null;
}

export interface RouterNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  routerName: string;
  interfaceId: number;
  underlayLocal: string;
  underlayRemote: string;
}

export interface EdgeData extends Record<string, unknown> {
  linkType: "Core" | "Child" | "Peer";
}

export type TopologyNode =
  | Node<IsdNodeData, "isd">
  | Node<AsNodeData, "as">
  | Node<RouterNodeData, "router">;

export type TopologyEdge = Edge<EdgeData>;

export function buildGraph(topology: Topology): {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
} {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // ISD nodes — one per unique ISD number
  const isdIds = new Set(
    Object.keys(topology.ases).map((id) => id.split("-")[0])
  );
  for (const isd of isdIds) {
    nodes.push({
      id: `isd-${isd}`,
      type: "isd",
      data: { label: `ISD ${isd}`, isd },
      position: { x: 0, y: 0 },
    });
  }

  // AS nodes — parented to their ISD node
  for (const [asId, asInfo] of Object.entries(topology.ases)) {
    const isd = asId.split("-")[0];
    nodes.push({
      id: `as-${asId}`,
      type: "as",
      data: {
        label: asId.split("-")[1],
        asId,
        core: asInfo.core,
        mtu: asInfo.mtu,
      },
      parentId: `isd-${isd}`,
      extent: "parent",
      position: { x: 0, y: 0 },
    });
  }

  // Router nodes + edges
  const seenRouters = new Set<string>();

  for (const link of topology.links) {
    for (const ep of [link.a, link.b]) {
      const routerId = `router-${ep.as_id}-${ep.router_name}`;
      if (!seenRouters.has(routerId)) {
        seenRouters.add(routerId);
        nodes.push({
          id: routerId,
          type: "router",
          data: {
            label: String(ep.interface_id),
            asId: ep.as_id,
            routerName: ep.router_name,
            interfaceId: ep.interface_id,
            underlayLocal: ep.underlay_local,
            underlayRemote: ep.underlay_remote,
          },
          parentId: `as-${ep.as_id}`,
          extent: "parent",
          position: { x: 0, y: 0 },
        });
      }
    }

    edges.push({
      id: `edge-${link.a.as_id}-${link.a.interface_id}-${link.b.as_id}-${link.b.interface_id}`,
      source: `router-${link.a.as_id}-${link.a.router_name}`,
      target: `router-${link.b.as_id}-${link.b.router_name}`,
      data: { linkType: link.link_type },
    });
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/topology.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/topology.ts src/lib/topology.test.ts
git commit -m "feat(topology): implement buildGraph with compound node structure"
```

---

## Task 6: layoutGraph function

**Files:**
- Create: `src/lib/layout.ts`
- Create: `src/lib/layout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/layout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { layoutGraph } from "./layout";
import { buildGraph } from "./topology";
import type { Topology } from "../bindings";

const twoAsTopology: Topology = {
  ases: {
    "1-ff00:0:110": { core: true, mtu: 1472 },
    "1-ff00:0:111": { core: false, mtu: 1472 },
  },
  links: [
    {
      a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1001, underlay_local: "a", underlay_remote: "b" },
      b: { as_id: "1-ff00:0:111", router_name: "br-111-1", interface_id: 2001, underlay_local: "b", underlay_remote: "a" },
      link_type: "Child",
    },
  ],
};

const twoIsdTopology: Topology = {
  ases: {
    "1-ff00:0:110": { core: true, mtu: 1472 },
    "2-ff00:0:210": { core: true, mtu: 1472 },
  },
  links: [
    {
      a: { as_id: "1-ff00:0:110", router_name: "br-110-1", interface_id: 1, underlay_local: "a", underlay_remote: "b" },
      b: { as_id: "2-ff00:0:210", router_name: "br-210-1", interface_id: 2, underlay_local: "b", underlay_remote: "a" },
      link_type: "Core",
    },
  ],
};

describe("layoutGraph", () => {
  it("assigns non-zero positions to all nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNode = laid.find((n) => n.type === "isd")!;
    const asNodes = laid.filter((n) => n.type === "as");
    // ISD node is at origin or positive coordinates
    expect(isdNode.position.x).toBeGreaterThanOrEqual(0);
    // AS nodes get distinct positions within ISD
    expect(asNodes[0].position).toBeDefined();
  });

  it("assigns width and height style to ISD and AS nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNode = laid.find((n) => n.type === "isd")!;
    const asNode = laid.find((n) => n.type === "as")!;
    expect(Number(isdNode.style?.width)).toBeGreaterThan(0);
    expect(Number(isdNode.style?.height)).toBeGreaterThan(0);
    expect(Number(asNode.style?.width)).toBeGreaterThan(0);
    expect(Number(asNode.style?.height)).toBeGreaterThan(0);
  });

  it("places two ISDs at different x positions", () => {
    const { nodes, edges } = buildGraph(twoIsdTopology);
    const laid = layoutGraph(nodes, edges);
    const isdNodes = laid.filter((n) => n.type === "isd");
    expect(isdNodes).toHaveLength(2);
    expect(isdNodes[0].position.x).not.toBe(isdNodes[1].position.x);
  });

  it("assigns positions to router nodes", () => {
    const { nodes, edges } = buildGraph(twoAsTopology);
    const laid = layoutGraph(nodes, edges);
    const routerNodes = laid.filter((n) => n.type === "router");
    for (const rn of routerNodes) {
      expect(rn.position.x).toBeDefined();
      expect(rn.position.y).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/layout.test.ts 2>&1 | tail -5
```

Expected: `Cannot find module './layout'`.

- [ ] **Step 3: Create src/lib/layout.ts**

Create `src/lib/layout.ts`:

```typescript
import Dagre from "@dagrejs/dagre";
import type { TopologyNode, TopologyEdge, AsNodeData, RouterNodeData } from "./topology";
import type { Node } from "@xyflow/react";

const ROUTER_SIZE = 24;
const AS_HEIGHT = 120;
const AS_MIN_WIDTH = 160;
const AS_ROUTER_SPACING = 40;
const AS_PADDING_X = 20;
const ISD_PADDING = 40;
const ISD_GAP = 80;
const RANK_SEP = 100;
const NODE_SEP = 60;

function asWidth(routerCount: number): number {
  return Math.max(AS_MIN_WIDTH, routerCount * AS_ROUTER_SPACING + AS_PADDING_X * 2);
}

export function layoutGraph(
  nodes: TopologyNode[],
  edges: TopologyEdge[]
): TopologyNode[] {
  const isdNodes = nodes.filter((n) => n.type === "isd");
  const asNodes = nodes.filter((n) => n.type === "as") as Node<AsNodeData, "as">[];
  const routerNodes = nodes.filter((n) => n.type === "router") as Node<RouterNodeData, "router">[];

  // Map router id -> parent AS id
  const routerToAs = new Map<string, string>();
  for (const rn of routerNodes) {
    if (rn.parentId) routerToAs.set(rn.id, rn.parentId);
  }

  // Group routers by parent AS id
  const routersByAs = new Map<string, Node<RouterNodeData, "router">[]>();
  for (const rn of routerNodes) {
    if (!rn.parentId) continue;
    const list = routersByAs.get(rn.parentId) ?? [];
    list.push(rn);
    routersByAs.set(rn.parentId, list);
  }

  // AS node dimensions keyed by AS node id
  const asDims = new Map<string, { width: number; height: number }>();
  for (const asNode of asNodes) {
    const count = routersByAs.get(asNode.id)?.length ?? 0;
    asDims.set(asNode.id, { width: asWidth(count), height: AS_HEIGHT });
  }

  // Dagre layout per ISD; collect AS positions relative to ISD top-left
  const asPositions = new Map<string, { x: number; y: number }>();
  const isdSizes = new Map<string, { width: number; height: number }>();

  for (const isdNode of isdNodes) {
    const children = asNodes.filter((n) => n.parentId === isdNode.id);
    if (children.length === 0) {
      isdSizes.set(isdNode.id, { width: AS_MIN_WIDTH + ISD_PADDING * 2, height: AS_HEIGHT + ISD_PADDING * 2 });
      continue;
    }

    const g = new Dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
    g.setDefaultEdgeLabel(() => ({}));

    const childIds = new Set(children.map((n) => n.id));
    for (const asNode of children) {
      const dim = asDims.get(asNode.id)!;
      g.setNode(asNode.id, { width: dim.width, height: dim.height });
    }

    // Child edges drive the rank hierarchy
    for (const edge of edges) {
      if (edge.data?.linkType !== "Child") continue;
      const srcAs = routerToAs.get(edge.source);
      const tgtAs = routerToAs.get(edge.target);
      if (srcAs && tgtAs && childIds.has(srcAs) && childIds.has(tgtAs)) {
        // Avoid duplicate edges in dagre
        if (!g.hasEdge(srcAs, tgtAs)) g.setEdge(srcAs, tgtAs);
      }
    }

    Dagre.layout(g);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const asNode of children) {
      const p = g.node(asNode.id);
      const dim = asDims.get(asNode.id)!;
      const x = p.x - dim.width / 2;
      const y = p.y - dim.height / 2;
      asPositions.set(asNode.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + dim.width);
      maxY = Math.max(maxY, y + dim.height);
    }

    // Shift so top-left of content = (ISD_PADDING, ISD_PADDING)
    for (const asNode of children) {
      const p = asPositions.get(asNode.id)!;
      asPositions.set(asNode.id, {
        x: p.x - minX + ISD_PADDING,
        y: p.y - minY + ISD_PADDING,
      });
    }

    isdSizes.set(isdNode.id, {
      width: maxX - minX + ISD_PADDING * 2,
      height: maxY - minY + ISD_PADDING * 2,
    });
  }

  // Position ISD nodes side by side
  let curX = 0;
  const isdPositions = new Map<string, { x: number; y: number }>();
  for (const isdNode of isdNodes) {
    isdPositions.set(isdNode.id, { x: curX, y: 0 });
    curX += (isdSizes.get(isdNode.id)?.width ?? 0) + ISD_GAP;
  }

  // Apply positions to all nodes
  return nodes.map((node) => {
    if (node.type === "isd") {
      const size = isdSizes.get(node.id) ?? { width: 200, height: 200 };
      return { ...node, position: isdPositions.get(node.id) ?? { x: 0, y: 0 }, style: size };
    }

    if (node.type === "as") {
      const dim = asDims.get(node.id) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      return { ...node, position: asPositions.get(node.id) ?? { x: 0, y: 0 }, style: dim };
    }

    if (node.type === "router") {
      const asId = node.parentId!;
      const dim = asDims.get(asId) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      const siblings = routersByAs.get(asId) ?? [];
      const idx = siblings.findIndex((r) => r.id === node.id);
      const count = siblings.length;
      const spacing = dim.width / (count + 1);
      return {
        ...node,
        position: {
          x: spacing * (idx + 1) - ROUTER_SIZE / 2,
          y: dim.height - ROUTER_SIZE - 4,
        },
        style: { width: ROUTER_SIZE, height: ROUTER_SIZE, borderRadius: "50%" },
      };
    }

    return node;
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/layout.test.ts 2>&1 | tail -10
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout.test.ts
git commit -m "feat(topology): implement layoutGraph with per-ISD Dagre hierarchy"
```

---

## Task 7: Custom React Flow nodes

**Files:**
- Create: `src/components/nodes/IsdNode.tsx`
- Create: `src/components/nodes/AsNode.tsx`
- Create: `src/components/nodes/RouterNode.tsx`

- [ ] **Step 1: Create IsdNode.tsx**

Create `src/components/nodes/IsdNode.tsx`:

```tsx
import type { NodeProps, Node } from "@xyflow/react";
import type { IsdNodeData } from "../../lib/topology";

export type IsdNodeType = Node<IsdNodeData, "isd">;

export function IsdNode({ data }: NodeProps<IsdNodeType>) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: "2px solid var(--mantine-color-blue-5)",
        borderRadius: 8,
        background: "var(--mantine-color-dark-8)",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--mantine-color-blue-3)",
          userSelect: "none",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create AsNode.tsx**

Create `src/components/nodes/AsNode.tsx`:

```tsx
import type { NodeProps, Node } from "@xyflow/react";
import type { AsNodeData } from "../../lib/topology";

export type AsNodeType = Node<AsNodeData, "as">;

export function AsNode({ data }: NodeProps<AsNodeType>) {
  const borderColor = data.core
    ? "var(--mantine-color-orange-5)"
    : "var(--mantine-color-gray-6)";
  const labelColor = data.core
    ? "var(--mantine-color-orange-3)"
    : "var(--mantine-color-gray-4)";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        background: "var(--mantine-color-dark-6)",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 6,
          left: 10,
          fontSize: 11,
          color: labelColor,
          userSelect: "none",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Create RouterNode.tsx**

Create `src/components/nodes/RouterNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { RouterNodeData } from "../../lib/topology";

export type RouterNodeType = Node<RouterNodeData, "router">;

export function RouterNode({ data }: NodeProps<RouterNodeType>) {
  return (
    <>
      <Handle type="source" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: "var(--mantine-color-dark-4)",
          border: "2px solid var(--mantine-color-gray-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          color: "var(--mantine-color-gray-3)",
          userSelect: "none",
          boxSizing: "border-box",
        }}
      >
        {data.label}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/nodes/
git commit -m "feat(topology): add IsdNode, AsNode, RouterNode React Flow components"
```

---

## Task 8: TopologyView component + App wiring

**Files:**
- Create: `src/components/TopologyView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create TopologyView.tsx**

Create `src/components/TopologyView.tsx`:

```tsx
import { useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type OnNodeClick,
  type OnEdgeClick,
} from "@xyflow/react";
import { Drawer, Text, Stack, Badge, Button } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import "@xyflow/react/dist/style.css";
import { buildGraph } from "../lib/topology";
import { layoutGraph } from "../lib/layout";
import { IsdNode } from "./nodes/IsdNode";
import { AsNode } from "./nodes/AsNode";
import { RouterNode } from "./nodes/RouterNode";
import type { Topology } from "../bindings";
import type { TopologyNode, TopologyEdge } from "../lib/topology";

const nodeTypes = { isd: IsdNode, as: AsNode, router: RouterNode };

const edgeStyle = {
  Core: { style: { strokeWidth: 3, stroke: "#868e96" } },
  Child: { style: { strokeWidth: 1.5, stroke: "#868e96" } },
  Peer: { style: { strokeWidth: 1.5, stroke: "#868e96", strokeDasharray: "5,5" } },
} as const;

type Selected = TopologyNode | TopologyEdge | null;

export function TopologyView() {
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyEdge>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    const folder = await open({ directory: true, title: "Select SCION project folder" });
    if (!folder || typeof folder !== "string") return;

    const topoFile = await open({
      title: "Select topology file",
      filters: [{ name: "Topology", extensions: ["topo"] }],
    });
    if (!topoFile || typeof topoFile !== "string") return;

    setLoading(true);
    setError(null);
    try {
      const topology = await invoke<Topology>("load_project", {
        folder,
        topo_file: topoFile,
      });
      const { nodes: graphNodes, edges: graphEdges } = buildGraph(topology);
      const laidOut = layoutGraph(graphNodes, graphEdges);
      setNodes(laidOut);
      setEdges(graphEdges);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  const onNodeClick: OnNodeClick<TopologyNode> = useCallback(
    (_, node) => setSelected(node),
    []
  );
  const onEdgeClick: OnEdgeClick<TopologyEdge> = useCallback(
    (_, edge) => setSelected(edge),
    []
  );

  const styledEdges = edges.map((edge) => ({
    ...edge,
    ...(edgeStyle[edge.data?.linkType ?? "Core"] ?? {}),
  }));

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <Stack align="center" gap="md">
            {error && (
              <Text c="red" size="sm" style={{ maxWidth: 400, wordBreak: "break-word" }}>
                {error}
              </Text>
            )}
            <Button onClick={handleOpen} loading={loading} size="md">
              Open Project
            </Button>
          </Stack>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => setSelected(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="md"
        title="Details"
        styles={{ body: { paddingTop: 8 } }}
      >
        {selected && <DetailsPanel element={selected} />}
      </Drawer>
    </div>
  );
}

function DetailsPanel({ element }: { element: TopologyNode | TopologyEdge }) {
  if ("source" in element) {
    const edge = element as TopologyEdge;
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">Link</Text>
        <Badge color={edge.data?.linkType === "Core" ? "blue" : edge.data?.linkType === "Child" ? "green" : "orange"}>
          {edge.data?.linkType}
        </Badge>
        <Text size="sm" c="dimmed">Source</Text>
        <Text size="sm">{edge.source}</Text>
        <Text size="sm" c="dimmed">Target</Text>
        <Text size="sm">{edge.target}</Text>
      </Stack>
    );
  }

  const node = element as TopologyNode;

  if (node.type === "isd") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.label}</Text>
      </Stack>
    );
  }

  if (node.type === "as") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.asId}</Text>
        {node.data.core && <Badge color="orange">Core</Badge>}
        {node.data.mtu !== null && (
          <Text size="sm">MTU: {node.data.mtu}</Text>
        )}
      </Stack>
    );
  }

  if (node.type === "router") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.routerName}</Text>
        <Text size="sm" c="dimmed">AS</Text>
        <Text size="sm">{node.data.asId}</Text>
        <Text size="sm" c="dimmed">Interface ID</Text>
        <Text size="sm">{node.data.interfaceId}</Text>
        <Text size="sm" c="dimmed">Underlay local</Text>
        <Text size="sm">{node.data.underlayLocal}</Text>
        <Text size="sm" c="dimmed">Underlay remote</Text>
        <Text size="sm">{node.data.underlayRemote}</Text>
      </Stack>
    );
  }

  return null;
}
```

- [ ] **Step 2: Render TopologyView in App.tsx**

In `src/App.tsx`, replace `<AppShell.Main />` with:

```tsx
<AppShell.Main style={{ height: "100vh" }}>
  <TopologyView />
</AppShell.Main>
```

And add the import at the top of the file:

```tsx
import { TopologyView } from "./components/TopologyView";
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Run all frontend tests**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: 9 tests pass (5 topology + 4 layout).

- [ ] **Step 5: Start the app and verify manually**

```bash
npm run tauri dev
```

Manual checklist:
- App opens with "Open Project" button in centre
- Click "Open Project" → folder picker appears → select `scion/` directory
- File picker appears → select `scion/topology/default.topo`
- Loading indicator shows while `scion.sh` runs (~10–30s)
- React Flow graph renders with ISD rectangles, AS rectangles inside, router circles on AS borders
- CORE links are thick solid, CHILD links are thin solid, PEER links are dashed
- Clicking a router opens the Drawer with router name, AS, interface ID, underlay addresses
- Clicking an AS opens the Drawer with AS ID, core badge, MTU
- Clicking an edge opens the Drawer with link type, source, target
- Clicking the canvas background closes the Drawer

- [ ] **Step 6: Commit**

```bash
git add src/components/TopologyView.tsx src/App.tsx
git commit -m "feat(topology): add TopologyView with file picker, React Flow graph, and details Drawer"
```
