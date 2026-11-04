# SCION Path Visualiser

A desktop app (Tauri + React) for running a local SCION test topology and
looking at it: which ASes and links exist, which paths are available between two
ASes, and how the network behaves when you change link conditions.

It drives the `scion.sh` script from a SCION source checkout, so it works with
any `.topo` file that `scion.sh topology` accepts.

## Features

- **Setup**: pick a SCION repository and a `.topo` file, then generate the
  configuration and (optionally) start the topology with supervisord or Docker.
  Grafana monitoring can also be enabled here.
- **Topology view**: an interactive graph of ASes, border routers, interfaces and
  links. Clicking a node opens drawers with the status of its control service,
  discovery service, daemon, Hummingbird redemption service and endhost API
  bridge.
- **Path search**: query the paths between two ASes through the endhost API and
  highlight them on the graph, with expiry, MTU and per-hop interfaces.
- **Traffic control** (Docker mode only): apply `tc-netem` conditions (delay,
  jitter, loss, rate, MTU) to border router interfaces, per interface or in bulk.
  Best-effort and Hummingbird traffic can be given separate conditions.
- **Logs**: live log streams for each SCION service.
- **Grafana dashboards**: generated dashboards for traffic, demotion rate and
  border router queue depth, backed by Prometheus and Jaeger.
- **AS config export**: write a JSON file describing every AS (core or non-core,
  service addresses, endhost API bridge address and a minted access token) for
  use by external tools.
- **Headless CLI** (`scion-topo`): the same setup and export without the UI.

## Requirements

- Linux (the endhost API bridge and traffic control enter container network
  namespaces)
- A SCION source checkout with a working `scion.sh`
- [Rust](https://rustup.rs/) (stable) and Node.js with npm
- The [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)
  for your distribution
- Docker, for Docker mode, traffic control and Grafana
- `sudo` access: traffic control runs `scripts/netcond.sh` (which uses `nsenter`
  and `tc`) through `sudo`

## Running the app

```sh
npm install

cd src-tauri
cargo build
# The endhost API bridge calls setns() to enter the Docker control-service
# network namespace, which needs CAP_SYS_ADMIN.
sudo setcap cap_sys_admin+eip target/debug/scion-path-visualiser
cd ..

npm run tauri dev
```

`run_dev.sh` does the same steps. Rebuilding the binary clears the capability,
so run `setcap` again after each `cargo build`.

For a release build, use `npm run tauri build`.

## Headless CLI

`scion-topo` sets up a topology without opening the UI and keeps it running until
you press Ctrl-C, then stops it with `scion.sh stop`.

```sh
cd src-tauri
cargo run --bin scion-topo -- \
  --scion-folder ~/scion \
  --topo-file ~/scion/topology/tiny.topo \
  --docker \
  --export-config as-config.json
```

| Flag | Description |
| --- | --- |
| `--scion-folder <PATH>` | SCION repository containing `scion.sh` (required) |
| `--topo-file <PATH>` | Topology file; relative paths resolve from the current directory (required) |
| `--docker` | Run with Docker instead of supervisord |
| `--no-run` | Generate configuration only; do not start the topology |
| `--grafana` | Generate the Grafana monitoring configuration |
| `--export-config <PATH>` | Write the per-AS JSON config after setup (cannot be combined with `--no-run`) |
| `--token-ttl-secs <N>` | Lifetime of exported endhost API tokens (default `604800`, one week) |
| `--token-dir <PATH>` | Where token signing keys are stored (default: the app data directory, shared with the UI) |

### Exported config format

```json
{
  "1-ff00:0:110": {
    "type": "core",
    "control_service": "172.20.0.53:30252",
    "endhost_api_bridge": "172.20.0.53:31100",
    "endhost_api_bridge_token": "eyJ0eXAiOiJKV1Qi...",
    "hummingbird_redemption_service": "172.20.0.53:30258",
    "discovery_service": "172.20.0.53:30252"
  }
}
```

## Project layout

```
src/                     React frontend (Mantine, React Flow, TanStack Router)
  routes/                File-based routes: setup, topology, paths, traffic control, logs
  components/            Topology canvas, sidebars and detail drawers
  bindings.ts            TypeScript bindings generated from Rust commands (do not edit)
src-tauri/
  src/lib.rs             Tauri commands and app state
  src/setup.rs           scion.sh orchestration shared by the app and the CLI
  src/topology/          Parsing the generated topology into ASes, routers and links
  src/paths.rs           Path lookup through the endhost API
  src/ehapi_bridge.rs    Endhost API bridges and token minting
  src/netcond.rs         Traffic control commands
  src/grafana.rs         Grafana provisioning and dashboards
  src/as_config.rs       Per-AS JSON config export
  src/bin/cli.rs         The scion-topo CLI
  scripts/netcond.sh     tc-netem helper run with sudo
```

`src/bindings.ts` is regenerated by [tauri-specta](https://github.com/specta-rs/tauri-specta)
every time a debug build starts, so after changing a Tauri command, run the app
once to update the frontend types.

## Tests

```sh
cd src-tauri && cargo test     # Rust
npx vitest                     # frontend
```

## Git hooks

Enable the repository hooks with:

```sh
git config core.hooksPath .githooks
```
