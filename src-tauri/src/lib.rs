pub mod as_config;
pub mod ehapi_bridge;
pub mod grafana;
pub mod netcond;
pub mod paths;
pub mod setup;
pub mod status;
pub mod topology;
pub mod util;

use scion_proto::address::IsdAsn;
use scionpings::endhost_api_bridge;
use std::sync::{Arc, Mutex};
use std::{collections::HashMap, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_log::log::{debug, info};
use tauri_specta::{collect_commands, Builder};

use crate::topology::Topology;

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
    config: AppConfig,
    ehapi_bridges: EhapiBridgeMap,
    status_task: tokio::task::JoinHandle<()>,
}

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
pub enum RunningMode {
    Docker,
    Supervisord,
}

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
pub struct AppConfig {
    pub scion_folder: String,
    pub topo_file: String,
    pub run_topology: bool,
    pub running_mode: RunningMode,
    pub run_grafana: bool,
}

impl AppConfig {
    fn to_setup_config(&self) -> setup::SetupConfig {
        setup::SetupConfig {
            scion_folder: std::path::PathBuf::from(&self.scion_folder),
            topo_file: self.topo_file.clone(),
            run_topology: self.run_topology,
            docker: matches!(self.running_mode, RunningMode::Docker),
            run_grafana: self.run_grafana,
        }
    }
}

#[tauri::command]
#[specta::specta]
async fn setup_scion_network(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: AppConfig,
) -> Result<String, String> {
    let setup_config = config.to_setup_config();

    let ehapi_token_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("ehapi-bridge-tokens");

    let app_for_sink = app.clone();
    let sink: setup::ProgressSink = Arc::new(move |progress| {
        match progress {
            setup::SetupProgress::Phase(msg) => app_for_sink.emit("scion-setup-phase", msg),
            setup::SetupProgress::Output(line) => app_for_sink.emit("scion-setup-output", line),
        }
        .ok();
    });

    let setup::SetupOutcome {
        topology: topo,
        ehapi_bridges,
    } = setup::run_setup(&setup_config, &ehapi_token_dir, sink).await?;

    // Spawn periodic status check
    let app_for_status = app.clone();
    let folder_for_status = setup_config.scion_folder.clone();
    let status_task = if config.run_topology
        && matches!(config.running_mode, RunningMode::Supervisord)
    {
        tokio::spawn(async move {
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
        })
    } else {
        // No need to check status if we're not running the topology or if we're using Docker (since we won't have supervisord)
        tokio::spawn(async {})
    };

    // Set application state to running
    *state.lock().unwrap() = AppStateInner::Running(RunningState {
        topology: topo,
        config,
        ehapi_bridges,
        status_task,
    });

    Ok("SCION network setup complete".to_string())
}

#[tauri::command]
#[specta::specta]
async fn restart_scion_network(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let config = {
        let guard = state.lock().unwrap();
        let running = guard.running()?;
        running.config.clone()
    };
    let scion_folder = std::path::PathBuf::from(&config.scion_folder);
    let sink = output_sink(&app);

    app.emit("scion-setup-phase", "Stopping SCION topology…")
        .ok();
    setup::run_scion_sh(&scion_folder, &["stop"], &sink).await?;

    app.emit("scion-setup-phase", "Starting SCION topology…")
        .ok();
    let docker = matches!(config.running_mode, RunningMode::Docker);
    setup::run_scion_sh(&scion_folder, &setup::start_args(docker), &sink).await?;

    Ok("SCION network restarted".to_string())
}

// Sink forwarding scion.sh output lines to the frontend; phase changes are
// emitted directly where they occur.
fn output_sink(app: &tauri::AppHandle) -> setup::ProgressSink {
    let app = app.clone();
    Arc::new(move |progress| {
        if let setup::SetupProgress::Output(line) = progress {
            app.emit("scion-setup-output", line).ok();
        }
    })
}

#[tauri::command]
#[specta::specta]
async fn reset_to_setup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let (scion_folder, run_topology) = {
        let guard = state.lock().unwrap();
        let running = guard.running()?;
        (
            std::path::PathBuf::from(&running.config.scion_folder),
            running.config.run_topology,
        )
    };

    if run_topology {
        app.emit("scion-setup-phase", "Stopping SCION topology…")
            .ok();
        setup::run_scion_sh(&scion_folder, &["stop"], &output_sink(&app)).await?;
    }

    let old = {
        let mut guard = state.lock().unwrap();
        std::mem::replace(&mut *guard, AppStateInner::Setup)
    };
    if let AppStateInner::Running(running) = old {
        running.status_task.abort();
        for bridge in running.ehapi_bridges.values() {
            bridge.cancel.cancel();
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
fn get_topology(state: tauri::State<'_, AppState>) -> Result<Topology, String> {
    Ok(state.lock().unwrap().running()?.topology.clone())
}

// File stem of the running .topo file (e.g. "default" for "topology/default.topo"),
// used by the UI to name exported files after the topology.
#[tauri::command]
#[specta::specta]
fn get_topology_name(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let state = state.lock().unwrap();
    let topo_file = &state.running()?.config.topo_file;

    Ok(std::path::Path::new(topo_file)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "topology".to_string()))
}

// Mirrors the CLI's --export-config: tokens are minted by the live endhost API
// bridges, so this only works while the topology is running.
#[tauri::command]
#[specta::specta]
fn export_as_config(
    state: tauri::State<'_, AppState>,
    path: String,
    ttl_seconds: u32,
) -> Result<(), String> {
    let state = state.lock().unwrap();
    let running = state.running()?;

    as_config::write_as_config(
        &running.topology,
        |isd_as| ehapi_bridge::mint_token_for(&running.ehapi_bridges, isd_as, ttl_seconds),
        std::path::Path::new(&path),
    )
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

    let mut child = {
        let state = app_state.lock().unwrap();
        let running = state.running()?;
        if matches!(running.config.running_mode, RunningMode::Docker) {
            let container = format!("scion-{service_name}-1");
            debug!("Streaming Docker logs for container: {container}");
            tokio::process::Command::new("sh")
                .args(["-c", &format!("docker logs --tail 200 -f {container} 2>&1")])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| format!("Failed to spawn docker logs: {e}"))?
        } else {
            let log_path = std::path::Path::new(&running.config.scion_folder)
                .join("logs")
                .join(format!("{service_name}.log"));
            if !log_path.exists() {
                return Err(format!("Log file not found: {}", log_path.display()));
            }
            debug!("Reading log: {}", log_path.display());
            tokio::process::Command::new("tail")
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
                .map_err(|e| format!("Failed to spawn tail: {e}"))?
        }
    };

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
        restart_scion_network,
        reset_to_setup,
        list_topology_files,
        export_as_config,
        get_topology_name,
        start_log_stream,
        stop_log_stream,
        ehapi_bridge::mint_token,
        paths::get_paths,
        netcond::netcond_set,
        netcond::netcond_clear,
        netcond::netcond_clear_all,
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
                super::restart_scion_network,
                super::reset_to_setup,
                super::list_topology_files,
                super::export_as_config,
                super::get_topology_name,
                super::start_log_stream,
                super::stop_log_stream,
                super::ehapi_bridge::mint_token,
                super::paths::get_paths,
                super::netcond::netcond_set,
                super::netcond::netcond_clear,
                super::netcond::netcond_clear_all,
            ])
            .export(
                specta_typescript::Typescript::default().header("// @ts-nocheck"),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
