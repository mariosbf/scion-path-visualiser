pub mod topology;

use tauri_specta::{collect_commands, Builder};
use topology::{build_topology, RawAsTopology, Topology};

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

    // scion.sh topology generates files at gen/AS{hex}/topology.json
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
        .export(
            specta_typescript::Typescript::default().header("// @ts-nocheck"),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
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
            .commands(collect_commands![super::greet, super::load_project])
            .export(
                specta_typescript::Typescript::default().header("// @ts-nocheck"),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
