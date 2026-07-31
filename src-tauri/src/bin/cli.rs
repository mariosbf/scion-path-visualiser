use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use scion_path_visualiser_lib::as_config::write_as_config;
use scion_path_visualiser_lib::ehapi_bridge::mint_token_for;
use scion_path_visualiser_lib::setup::{
    run_scion_sh, run_setup, ProgressSink, SetupConfig, SetupProgress,
};

// Must match the `identifier` in tauri.conf.json so CLI and UI share token keys.
const APP_IDENTIFIER: &str = "com.mario.scion-path-visualiser";

/// Run a SCION topology (and optional monitoring stack) without the UI.
#[derive(Debug, Parser)]
#[command(name = "scion-topo", version)]
struct Args {
    /// Path to the SCION repository (folder containing scion.sh)
    #[arg(long)]
    scion_folder: PathBuf,

    /// Path to the .topo file; relative paths are resolved from the current
    /// directory
    #[arg(long)]
    topo_file: PathBuf,

    /// Run in Docker mode instead of supervisord
    #[arg(long)]
    docker: bool,

    /// Only generate configuration; do not start the topology
    #[arg(long)]
    no_run: bool,

    /// Generate Grafana monitoring configuration
    #[arg(long)]
    grafana: bool,

    /// Write a per-AS JSON config (type, service addresses, endhost API
    /// bridge token) to this path after setup
    #[arg(long)]
    export_config: Option<PathBuf>,

    /// TTL in seconds for exported endhost API bridge tokens (default: 1 week)
    #[arg(long, default_value_t = 604800)]
    token_ttl_secs: u32,

    /// Directory for endhost API bridge token keys
    /// (default: the app data dir shared with the UI)
    #[arg(long)]
    token_dir: Option<PathBuf>,
}

// Resolves relative paths against the shell cwd (not the SCION folder, which
// is what scion.sh would otherwise do) and fails early if the file is missing.
fn absolutize_topo_file(path: &std::path::Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot resolve topo file {}: {e}", path.display()))
}

// Resolves relative paths against the shell cwd and verifies scion.sh is
// actually there, so a wrong folder fails with a clear message instead of a
// generic spawn error.
fn absolutize_scion_folder(path: &std::path::Path) -> Result<PathBuf, String> {
    let folder = std::fs::canonicalize(path)
        .map_err(|e| format!("Cannot resolve SCION folder {}: {e}", path.display()))?;
    if !folder.join("scion.sh").exists() {
        return Err(format!(
            "No scion.sh found in {} — is this a SCION repository?",
            folder.display()
        ));
    }
    Ok(folder)
}

fn default_token_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or("Cannot resolve user data directory")?
        .join(APP_IDENTIFIER)
        .join("ehapi-bridge-tokens"))
}

fn progress_sink() -> ProgressSink {
    Arc::new(|progress| match progress {
        SetupProgress::Phase(msg) => eprintln!("==> {msg}"),
        SetupProgress::Output(line) => println!("{line}"),
    })
}

async fn run(args: Args) -> Result<(), String> {
    if args.export_config.is_some() && args.no_run {
        return Err(
            "--export-config requires the topology to run (tokens are minted by the \
             endhost API bridges); remove --no-run"
                .to_string(),
        );
    }

    let topo_file = absolutize_topo_file(&args.topo_file)?;
    let scion_folder = absolutize_scion_folder(&args.scion_folder)?;

    let config = SetupConfig {
        scion_folder: scion_folder.clone(),
        topo_file: topo_file
            .to_str()
            .ok_or("Topo file path contains invalid Unicode")?
            .to_string(),
        run_topology: !args.no_run,
        docker: args.docker,
        run_grafana: args.grafana,
    };

    let token_dir = match &args.token_dir {
        Some(dir) => dir.clone(),
        None => default_token_dir()?,
    };

    let sink = progress_sink();
    let outcome = run_setup(&config, &token_dir, sink.clone()).await?;

    if let Some(path) = &args.export_config {
        write_as_config(
            &outcome.topology,
            |isd_as| mint_token_for(&outcome.ehapi_bridges, isd_as, args.token_ttl_secs),
            path,
        )?;
        eprintln!("==> Wrote AS config to {}", path.display());
    }

    if args.no_run {
        eprintln!("==> Configuration generated (topology not started)");
        return Ok(());
    }

    eprintln!("==> SCION topology running — press Ctrl-C to stop");
    tokio::signal::ctrl_c()
        .await
        .map_err(|e| format!("Failed to listen for Ctrl-C: {e}"))?;

    eprintln!("==> Stopping SCION topology…");
    for bridge in outcome.ehapi_bridges.values() {
        bridge.cancel.cancel();
    }
    run_scion_sh(&scion_folder, &["stop"], &sink).await?;

    Ok(())
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    if let Err(e) = run(args).await {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_minimal_args_with_defaults() {
        let args = Args::try_parse_from([
            "scion-topo",
            "--scion-folder",
            "/opt/scion",
            "--topo-file",
            "topology/default.topo",
        ])
        .unwrap();
        assert_eq!(args.scion_folder, std::path::PathBuf::from("/opt/scion"));
        assert_eq!(
            args.topo_file,
            std::path::PathBuf::from("topology/default.topo")
        );
        assert!(!args.docker);
        assert!(!args.no_run);
        assert!(!args.grafana);
        assert!(args.export_config.is_none());
        assert_eq!(args.token_ttl_secs, 604800);
        assert!(args.token_dir.is_none());
    }

    #[test]
    fn parses_export_config_flag() {
        let args = Args::try_parse_from([
            "scion-topo",
            "--scion-folder",
            "/opt/scion",
            "--topo-file",
            "t.topo",
            "--docker",
            "--export-config",
            "/tmp/as-config.json",
            "--token-ttl-secs",
            "3600",
        ])
        .unwrap();
        assert!(args.docker);
        assert_eq!(
            args.export_config,
            Some(std::path::PathBuf::from("/tmp/as-config.json"))
        );
        assert_eq!(args.token_ttl_secs, 3600);
    }

    #[test]
    fn absolutize_keeps_existing_absolute_path() {
        let file = std::env::temp_dir().join("scion-topo-cli-test.topo");
        std::fs::write(&file, "").unwrap();
        let result = absolutize_topo_file(&file).unwrap();
        assert!(result.is_absolute());
        assert!(result.ends_with("scion-topo-cli-test.topo"));
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn absolutize_resolves_relative_path_against_cwd() {
        // Cargo runs tests with cwd = crate root (src-tauri), Cargo.toml exists there.
        let result = absolutize_topo_file(std::path::Path::new("Cargo.toml")).unwrap();
        assert!(result.is_absolute());
        assert_eq!(result, std::env::current_dir().unwrap().join("Cargo.toml").canonicalize().unwrap());
    }

    #[test]
    fn absolutize_errors_on_missing_file() {
        let err = absolutize_topo_file(std::path::Path::new("/nonexistent/x.topo")).unwrap_err();
        assert!(err.contains("/nonexistent/x.topo"));
    }

    #[test]
    fn scion_folder_error_names_missing_folder() {
        let err =
            absolutize_scion_folder(std::path::Path::new("/nonexistent/scion")).unwrap_err();
        assert!(err.contains("/nonexistent/scion"));
    }

    #[test]
    fn scion_folder_error_names_missing_scion_sh() {
        // temp_dir exists but has no scion.sh
        let err = absolutize_scion_folder(&std::env::temp_dir()).unwrap_err();
        assert!(err.contains("scion.sh"));
    }

    #[test]
    fn scion_folder_accepts_folder_containing_scion_sh() {
        let dir = std::env::temp_dir().join("scion-topo-cli-test-folder");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("scion.sh"), "").unwrap();
        let result = absolutize_scion_folder(&dir).unwrap();
        assert!(result.is_absolute());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn default_token_dir_uses_app_identifier() {
        let dir = default_token_dir().unwrap();
        assert!(dir
            .to_string_lossy()
            .contains("com.mario.scion-path-visualiser"));
        assert!(dir.ends_with("ehapi-bridge-tokens"));
    }
}
