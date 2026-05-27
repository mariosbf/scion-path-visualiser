use std::process::Stdio;
use tauri::{Emitter, Manager};

use crate::topology::NetCondParams;
use crate::{AppState, AppStateInner, RunningMode};

fn get_scion_folder_if_docker(state: &tauri::State<'_, AppState>) -> Result<String, String> {
    let guard = state.lock().unwrap();
    let running = guard.running()?;
    if !matches!(running.config.running_mode, RunningMode::Docker) {
        return Err("Traffic control requires Docker mode".to_string());
    }
    Ok(running.config.scion_folder.clone())
}

fn script_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .resource_dir()
        .map(|d: std::path::PathBuf| d.join("scripts/netcond.sh"))
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))
}

/// Build a `sudo env GEN_DIR=<dir> <script> [args…]` command.
/// sudo strips env vars by default, so we pass GEN_DIR explicitly via `env`.
fn sudo_netcond(
    script: &std::path::Path,
    gen_dir: &std::path::Path,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("sudo");
    cmd.arg("env")
        .arg(format!("GEN_DIR={}", gen_dir.display()))
        .arg(script);
    cmd
}

#[tauri::command]
#[specta::specta]
pub async fn netcond_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    br: String,
    ifid: u16,
    params: NetCondParams,
) -> Result<(), String> {
    let scion_folder = get_scion_folder_if_docker(&state)?;
    let script = script_path(&app)?;
    let gen_dir = std::path::Path::new(&scion_folder).join("gen");

    let mut args = vec!["set".to_string(), br.clone(), ifid.to_string()];
    if let Some(v) = params.delay_ms {
        args.extend(["delay".to_string(), v.to_string()]);
    }
    if let Some(v) = params.loss_percent {
        args.extend(["loss".to_string(), v.to_string()]);
    }
    if let Some(v) = params.rate_kbps {
        args.extend(["rate".to_string(), v.to_string()]);
    }
    if let Some(v) = params.duplicate_percent {
        args.extend(["dup".to_string(), v.to_string()]);
    }
    if let Some(v) = params.corrupt_percent {
        args.extend(["corrupt".to_string(), v.to_string()]);
    }
    if let Some(v) = params.reorder_percent {
        args.extend(["reorder".to_string(), v.to_string()]);
    }

    if args.len() <= 3 {
        return Err("At least one condition must be specified".to_string());
    }

    let output = sudo_netcond(&script, &gen_dir)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run netcond.sh: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("netcond.sh failed: {stderr}"));
    }

    {
        let mut guard = state.lock().unwrap();
        if let AppStateInner::Running(running) = &mut *guard {
            for as_info in running.topology.ases.values_mut() {
                for router in &mut as_info.border_routers {
                    if router.name == br {
                        if let Some(iface) = router.interfaces.get_mut(&ifid) {
                            iface.net_cond = Some(params);
                        }
                    }
                }
            }
            app.emit("status-update", running.topology.clone()).ok();
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn netcond_clear(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    br: String,
    ifid: u16,
) -> Result<(), String> {
    let scion_folder = get_scion_folder_if_docker(&state)?;
    let script = script_path(&app)?;
    let gen_dir = std::path::Path::new(&scion_folder).join("gen");

    let output = sudo_netcond(&script, &gen_dir)
        .args(["clear", &br, &ifid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run netcond.sh: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("netcond.sh failed: {stderr}"));
    }

    {
        let mut guard = state.lock().unwrap();
        if let AppStateInner::Running(running) = &mut *guard {
            for as_info in running.topology.ases.values_mut() {
                for router in &mut as_info.border_routers {
                    if router.name == br {
                        if let Some(iface) = router.interfaces.get_mut(&ifid) {
                            iface.net_cond = None;
                        }
                    }
                }
            }
            app.emit("status-update", running.topology.clone()).ok();
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn netcond_clear_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let scion_folder = get_scion_folder_if_docker(&state)?;
    let script = script_path(&app)?;
    let gen_dir = std::path::Path::new(&scion_folder).join("gen");

    let output = sudo_netcond(&script, &gen_dir)
        .arg("clear-all")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run netcond.sh: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("netcond.sh failed: {stderr}"));
    }

    {
        let mut guard = state.lock().unwrap();
        if let AppStateInner::Running(running) = &mut *guard {
            for as_info in running.topology.ases.values_mut() {
                for router in &mut as_info.border_routers {
                    for iface in router.interfaces.values_mut() {
                        iface.net_cond = None;
                    }
                }
            }
            app.emit("status-update", running.topology.clone()).ok();
        }
    }

    Ok(())
}
