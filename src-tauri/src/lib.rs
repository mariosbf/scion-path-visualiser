use tauri_specta::{collect_commands, Builder};

#[tauri::command]
#[specta::specta]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![greet]);

    #[cfg(debug_assertions)]
    builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn export_bindings() {
        super::Builder::<tauri::Wry>::new()
            .commands(super::collect_commands![super::greet])
            .export(
                specta_typescript::Typescript::default(),
                "../src/bindings.ts",
            )
            .expect("Failed to export typescript bindings");
    }
}
