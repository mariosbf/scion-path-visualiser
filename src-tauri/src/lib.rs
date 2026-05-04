pub mod topology;

use scion_sdk_observability::metrics::registry::MetricsRegistry;
use scionpings::endhost_api_bridge;
use scionpings::endhost_api_bridge::token_authority::TokenAuthority;
use std::sync::Mutex;
use std::{collections::HashMap, sync::Arc};
use tauri::{Emitter, Manager};
use tauri_specta::{collect_commands, Builder};
use tokio_util::sync::CancellationToken;
use topology::{build_topology, IsdAsnDef, RawAsTopology, RawHbirdConfig, RawSdConfig, Topology};
use url::Url;

struct LogStreams(Mutex<HashMap<String, tokio::process::Child>>);
struct TopologyState(Option<Mutex<Topology>>);
struct EhapiBridgesState(Mutex<HashMap<IsdAsnDef, Arc<endhost_api_bridge::state::AppState>>>);

#[tauri::command]
#[specta::specta]
fn load_project(gen_dir: String) -> Result<Topology, String> {
    let pattern = format!("{gen_dir}/AS*/topology.json");
    let mut hbird_map: HashMap<IsdAsnDef, RawHbirdConfig> = HashMap::new();
    let mut sd_map: HashMap<IsdAsnDef, RawSdConfig> = HashMap::new();
    let raw_ases: Vec<RawAsTopology> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern: {e}"))?
        .map(|entry| {
            let path = entry.map_err(|e| e.to_string())?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            let raw_as = serde_json::from_str::<RawAsTopology>(&content)
                .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

            if let Some(dir) = path.parent() {
                let hbird_path = dir.join("hbird.toml");
                if hbird_path.exists() {
                    match std::fs::read_to_string(&hbird_path) {
                        Ok(hbird_content) => {
                            match toml::from_str::<RawHbirdConfig>(&hbird_content) {
                                Ok(hb) => {
                                    hbird_map.insert(raw_as.isd_as, hb);
                                }
                                Err(e) => {
                                    eprintln!("Failed to parse {}: {e}", hbird_path.display());
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to read {}: {e}", hbird_path.display());
                        }
                    }
                }

                // sd.toml is required (unlike hbird.toml which is optional):
                // absence defers to build_topology error; read/parse failure is immediate.
                let sd_path = dir.join("sd.toml");
                if sd_path.exists() {
                    let sd_content = std::fs::read_to_string(&sd_path)
                        .map_err(|e| format!("Failed to read {}: {e}", sd_path.display()))?;
                    let sd = toml::from_str::<RawSdConfig>(&sd_content)
                        .map_err(|e| format!("Failed to parse {}: {e}", sd_path.display()))?;
                    sd_map.insert(raw_as.isd_as, sd);
                }
            }

            Ok(raw_as)
        })
        .collect::<Result<Vec<_>, String>>()?;

    build_topology(raw_ases, hbird_map, sd_map)
        .map_err(|e| format!("Failed to build topology: {e}"))
}

async fn stream_output(
    app: &tauri::AppHandle,
    child: &mut tokio::process::Child,
    event: &str,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stderr = child.stderr.take().ok_or("stderr not piped")?;

    let app_out = app.clone();
    let event_out = event.to_owned();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            app_out.emit(&event_out, line).ok();
        }
    });

    let app_err = app.clone();
    let event_err = event.to_owned();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            app_err.emit(&event_err, line).ok();
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);
    Ok(())
}

#[derive(serde::Serialize, Clone)]
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
    service_name: String,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let log_path = std::path::Path::new(&folder)
        .join("logs")
        .join(format!("{service_name}.log"));

    if !log_path.exists() {
        return Err(format!("Log file not found: {}", log_path.display()));
    }

    let mut child = tokio::process::Command::new("tail")
        .args([
            "-n",
            "200",
            "-f",
            log_path
                .to_str()
                .ok_or("Log path contains invalid Unicode")?,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
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
       // Ignore errors from kill() — process may have already exited
    let _ = child.kill().await;
    // Reap the child to avoid zombie processes
    let _ = child.wait().await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn setup_scion_network(
    app: tauri::AppHandle,
    folder: String,
    topo_file: String,
) -> Result<String, String> {
    use std::process::Stdio;

    app.emit("scion-setup-phase", "Generating topology configuration…")
        .ok();

    // Generate topology
    let mut child = tokio::process::Command::new("./scion.sh")
        .args(["topology", "-c", &topo_file])
        .current_dir(&folder)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn scion.sh: {e}"))?;

    stream_output(&app, &mut child, "scion-setup-output").await?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for scion.sh topology: {e}"))?;

    if !status.success() {
        return Err(format!("scion.sh topology exited with status {status}"));
    }

    // Start SCION topology
    app.emit("scion-setup-phase", "Starting SCION topology…")
        .ok();

    let mut child = tokio::process::Command::new("./scion.sh")
        .args(["start"])
        .current_dir(&folder)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn scion.sh: {e}"))?;

    stream_output(&app, &mut child, "scion-setup-output").await?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for scion.sh start: {e}"))?;

    if !status.success() {
        return Err(format!("scion.sh start exited with status {status}"));
    }

    // Read topoology and store in state
    let topology =
        load_project(topo_file.clone()).map_err(|e| format!("Failed to load topology: {e}"))?;

    // Start endhost API bridges
    start_ehapi_bridges(&app, &topology)?;

    app.manage(TopologyState(Some(Mutex::new(topology))));

    // Copy gen folder to backup location
    let src_gen = std::path::Path::new(&folder).join("gen");
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let project_name = std::path::Path::new(&folder)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    let dst_gen = app_data_dir.join("projects").join(project_name).join("gen");

    clear_directory(&dst_gen)?;
    copy_dir_all(&src_gen, &dst_gen)?;

    dst_gen
        .to_str()
        .map(|s: &str| s.to_string())
        .ok_or_else(|| "Generated path contains invalid Unicode".to_string())
}

fn clear_directory(path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("Cannot clear {}: {e}", path.display()))?;
    }
    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("Cannot create {}: {e}", dst.display()))?;
    for entry in
        std::fs::read_dir(src).map_err(|e| format!("Cannot read {}: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn start_ehapi_bridges(app: &tauri::AppHandle, topology: &Topology) -> Result<(), String> {
    for (isd_as, as_info) in topology.ases.iter() {
        app.emit(
            "scion-setup-phase",
            format!("Starting endhost API bridge for AS {}…", isd_as.0),
        )
        .ok();

        // Derive from control_service.addr
        let control_plane_url = Url::parse(&format!("http://{}", as_info.control_service.addr))
            .map_err(|e| format!("Invalid control service address: {e}"))?;

        // Start endhost API bridges
        let cfg = endhost_api_bridge::config::EffectiveConfig {
            bind_endhost_api: as_info.endhost_api_bridge.addr,
            advertise_endhost_api_ip: None,
            control_plane_url,
            isd_ases: vec![isd_as.0],
            src_core: as_info.core,
            token_public_key_pem: None,
            print_insecure_token: false,
            udp_routers: as_info.border_routers.iter().map(|br| br.into()).collect(),
            log_level: tracing::Level::DEBUG,
        };
        let token_authority = Arc::new(
            TokenAuthority::load_or_create(&cfg)
                .map_err(|e| format!("Failed to load or create token authority: {e}"))?,
        );

        let cancellation_token = CancellationToken::new();
        let metrics_registry = Arc::new(MetricsRegistry::new());
        let ehapi_app_state = Arc::new(endhost_api_bridge::state::AppState {
            token_authority,
            metrics_registry,
            cancel: cancellation_token.clone(),
        });

        app.state::<EhapiBridgesState>()
            .0
            .lock()
            .unwrap()
            .insert(*isd_as, ehapi_app_state.clone());

        #[allow(clippy::clone_on_copy)]
        let isd_as = isd_as.clone();

        tokio::spawn(async move {
            // TODO: handle error appropriately
            let _ = scionpings::endhost_api_bridge::server::run(ehapi_app_state, cfg)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to start endhost API bridge for AS {}: {e}",
                        isd_as.0
                    )
                });
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
fn list_topology_files(folder: String) -> Result<Vec<String>, String> {
    let topo_dir = std::path::Path::new(&folder).join("topology");
    if !topo_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in
        std::fs::read_dir(&topo_dir).map_err(|e| format!("Cannot read topology dir: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("topo") {
            if let Some(s) = path.to_str() {
                files.push(s.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        load_project,
        setup_scion_network,
        list_topology_files,
        start_log_stream,
        stop_log_stream
    ]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default().header("// @ts-nocheck"),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(tauri_plugin_log::log::LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(LogStreams(Mutex::new(HashMap::new())))
        .manage(TopologyState(None))
        .manage(EhapiBridgesState(Mutex::new(HashMap::new())))
        .invoke_handler(builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<EhapiBridgesState>();
                let map = state.0.lock().unwrap();
                for bridge in map.values() {
                    bridge.cancel.cancel();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        use tauri_specta::{collect_commands, Builder};
        Builder::<tauri::Wry>::new()
            .commands(collect_commands![
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
