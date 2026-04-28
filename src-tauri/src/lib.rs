pub mod topology;

use tauri::{Emitter, Manager};
use tauri_specta::{collect_commands, Builder};
use topology::{build_topology, RawAsTopology, Topology};

#[tauri::command]
#[specta::specta]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
#[specta::specta]
fn load_project(gen_dir: String) -> Result<Topology, String> {
    let pattern = format!("{gen_dir}/AS*/topology.json");
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
        greet,
        load_project,
        setup_scion_network,
        list_topology_files
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
            .commands(collect_commands![
                super::greet,
                super::load_project,
                super::setup_scion_network,
                super::list_topology_files
            ])
            .export(
                specta_typescript::Typescript::default().header("// @ts-nocheck"),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
