use tauri::Emitter;

pub async fn stream_output_to(
    child: &mut tokio::process::Child,
    sink: impl Fn(String) + Clone + Send + Sync + 'static,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stderr = child.stderr.take().ok_or("stderr not piped")?;

    let sink_out = sink.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            sink_out(line);
        }
    });

    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            sink(line);
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);
    Ok(())
}

pub async fn stream_output(
    app: &tauri::AppHandle,
    child: &mut tokio::process::Child,
    event: &str,
) -> Result<(), String> {
    let app = app.clone();
    let event = event.to_owned();
    stream_output_to(child, move |line| {
        app.emit(&event, line).ok();
    })
    .await
}

pub fn clear_directory(path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("Cannot clear {}: {e}", path.display()))?;
    }
    Ok(())
}

pub fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
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
