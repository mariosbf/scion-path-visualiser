pub mod ehapi_bridge;
pub mod paths;
pub mod status;
pub mod topology;
pub mod util;

use scion_proto::address::IsdAsn;
use scionpings::endhost_api_bridge;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::{collections::HashMap, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_log::log::info;
use tauri_specta::{collect_commands, Builder};

use crate::ehapi_bridge::start_ehapi_bridges;
use crate::topology::{load_topology, Topology};
use crate::util::{clear_directory, copy_dir_all, stream_output};

pub type AppState = Mutex<AppStateInner>;

pub enum AppStateInner {
    Setup,
    Running(RunningState),
}

struct LogStreams(Mutex<HashMap<String, tokio::process::Child>>);

impl AppStateInner {
    pub fn setup(&self) -> Result<(), String> {
        match self {
            AppStateInner::Setup => Ok(()),
            AppStateInner::Running(_) => Err("Not in setup state".to_string()),
        }
    }

    pub fn running(&self) -> Result<&RunningState, String> {
        match self {
            AppStateInner::Setup => Err("Not in running state".to_string()),
            AppStateInner::Running(state) => Ok(state),
        }
    }

    pub fn running_mut(&mut self) -> Result<&mut RunningState, String> {
        match self {
            AppStateInner::Setup => Err("Not in running state".to_string()),
            AppStateInner::Running(state) => Ok(state),
        }
    }
}

pub type EhapiBridgeMap = HashMap<IsdAsn, Arc<endhost_api_bridge::state::AppState>>;

pub struct RunningState {
    topology: Topology,
    scion_folder: PathBuf,
    ehapi_bridges: EhapiBridgeMap,
    status_task: tokio::task::JoinHandle<()>,
}

#[tauri::command]
#[specta::specta]
async fn setup_scion_network(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    scion_folder: String,
    topo_file: String,
) -> Result<String, String> {
    use std::process::Stdio;

    let scion_folder = std::path::Path::new(&scion_folder);

    app.emit("scion-setup-phase", "Generating topology configuration…")
        .ok();

    // Generate topology
    let mut child = tokio::process::Command::new("./scion.sh")
        .args(["topology", "-c", &topo_file])
        .current_dir(scion_folder)
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
        .current_dir(scion_folder)
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
    let gen_dir = scion_folder.join("gen");
    let topo = load_topology(&gen_dir).map_err(|e| format!("Failed to load topology: {e}"))?;

    // Start endhost API bridges
    app.emit(
        "scion-setup-phase",
        "Starting endhost API bridges".to_string(),
    )
    .ok();
    let ehapi_token_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("ehapi-bridge-tokens");
    let ehapi_bridge_log_dir = scion_folder.join("logs");

    let ehapi_bridges = start_ehapi_bridges(&ehapi_bridge_log_dir, &ehapi_token_dir, &topo)?;

    // Copy gen folder to backup location
    let src_gen = std::path::Path::new(&scion_folder).join("gen");
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let project_name = std::path::Path::new(&scion_folder)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project");
    let dst_gen = app_data_dir.join("projects").join(project_name).join("gen");

    clear_directory(&dst_gen)?;
    copy_dir_all(&src_gen, &dst_gen)?;

    dst_gen
        .to_str()
        .map(|s: &str| s.to_string())
        .ok_or_else(|| "Generated path contains invalid Unicode".to_string())?;

    // Spawn periodic status check
    let app_for_status = app.clone();
    let folder_for_status = scion_folder.to_path_buf();
    let status_task = tokio::spawn(async move {
        use crate::status::{apply_status_update, parse_status};

        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            info!("Reading SCION network status");
            let Ok(output) = tokio::process::Command::new("./scion.sh")
                .arg("status")
                .current_dir(&folder_for_status)
                .output()
                .await
            else {
                continue;
            };
            let output = String::from_utf8_lossy(&output.stdout);

            let Ok(statuses) = parse_status(&output) else {
                continue;
            };
            let state = app_for_status.state::<AppState>();
            let mut guard = state.lock().unwrap();
            if let AppStateInner::Running(running) = &mut *guard {
                apply_status_update(&mut running.topology, statuses, chrono::Utc::now());
                app.emit("status-update", running.topology.clone())
                    .inspect_err(|e| tracing::warn!("Failed to emit status-update event: {e}"))
                    .ok();
            }
        }
    });

    // Set application state to running
    *state.lock().unwrap() = AppStateInner::Running(RunningState {
        topology: topo,
        scion_folder: std::path::PathBuf::from(scion_folder),
        ehapi_bridges,
        status_task,
    });

    Ok("SCION network setup complete".to_string())
}

#[tauri::command]
#[specta::specta]
fn get_topology(state: tauri::State<'_, AppState>) -> Result<Topology, String> {
    Ok(state.lock().unwrap().running()?.topology.clone())
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
    app_state: tauri::State<'_, AppState>,
    log_state: tauri::State<'_, LogStreams>,
    service_name: String,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let log_path = {
        let state = app_state.lock().unwrap();
        let folder = state.running()?.scion_folder.clone();
        std::path::Path::new(&folder)
            .join("logs")
            .join(format!("{service_name}.log"))
    };

    if !log_path.exists() {
        return Err(format!("Log file not found: {}", log_path.display()));
    }

    debug!("Reading log: {}", log_path.to_str().unwrap());
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
        let mut map = log_state.0.lock().unwrap();
        map.insert(stream_id.clone(), child);
    }

    let app_clone = app.clone();
    let sid = stream_id.clone();
    tokio::spawn(async move {
        // Give frontend a little time to start reading the stream
        tokio::time::sleep(Duration::from_millis(50)).await;

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

// #[tauri::command]
// #[specta::specta]
// async fn stop_scion_network(state: tauri::State<'_, ScionFolder>) -> Result<(), String> {
//     let folder = state.0.lock().unwrap().take();
//     if let Some(folder) = folder {
//         let status = tokio::process::Command::new("./scion.sh")
//             .args(["stop"])
//             .current_dir(&folder)
//             .status()
//             .await
//             .map_err(|e| format!("Failed to spawn scion.sh stop: {e}"))?;
//         if !status.success() {
//             return Err(format!("scion.sh stop exited with {status}"));
//         }
//     }
//     Ok(())
// }

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
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        get_topology,
        setup_scion_network,
        list_topology_files,
        start_log_stream,
        stop_log_stream,
        ehapi_bridge::mint_token,
        paths::get_paths,
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
        .manage(Mutex::new(AppStateInner::Setup))
        .invoke_handler(builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                let state = state.lock().unwrap();
                if let AppStateInner::Running(running) = &*state {
                    debug!("Stopping SCION network…");
                    running.status_task.abort();
                    for bridge in running.ehapi_bridges.values() {
                        bridge.cancel.cancel();
                    }
                }
                // let folder = app.state::<AppState>().lock().unwrap()
                //     .running()?
                //     .scion_folder
                //     .clone();
                // if let Some(folder) = folder {
                //     let _ = std::process::Command::new("./scion.sh")
                //         .args(["stop"])
                //         .current_dir(&folder)
                //         .status();
                // }
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
                super::get_topology,
                super::setup_scion_network,
                super::list_topology_files,
                super::start_log_stream,
                super::stop_log_stream,
                super::ehapi_bridge::mint_token,
                super::paths::get_paths,
            ])
            .export(
                specta_typescript::Typescript::default().header("// @ts-nocheck"),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
