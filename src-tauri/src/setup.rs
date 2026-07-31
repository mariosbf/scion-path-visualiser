use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use crate::ehapi_bridge::start_ehapi_bridges;
use crate::grafana;
use crate::topology::{load_topology, Topology};
use crate::util::stream_output_to;
use crate::EhapiBridgeMap;

#[derive(Debug, Clone)]
pub struct SetupConfig {
    pub scion_folder: PathBuf,
    pub topo_file: String,
    pub run_topology: bool,
    pub docker: bool,
    pub run_grafana: bool,
}

#[derive(Debug, Clone)]
pub enum SetupProgress {
    Phase(String),
    Output(String),
}

pub type ProgressSink = Arc<dyn Fn(SetupProgress) + Send + Sync>;

pub struct SetupOutcome {
    pub topology: Topology,
    pub ehapi_bridges: EhapiBridgeMap,
}

pub fn topo_args(config: &SetupConfig) -> Vec<&str> {
    let mut args = vec!["topology", "-c", config.topo_file.as_str()];
    if config.run_topology && config.docker {
        args.push("-d");
    }
    args
}

pub fn start_args(docker: bool) -> Vec<&'static str> {
    let mut args = vec!["start"];
    if docker {
        args.push("-d");
    }
    args
}

pub async fn run_scion_sh(
    scion_folder: &Path,
    args: &[&str],
    sink: &ProgressSink,
) -> Result<(), String> {
    let mut child = tokio::process::Command::new("./scion.sh")
        .args(args)
        .current_dir(scion_folder)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn scion.sh {}: {e}", args.join(" ")))?;

    let sink_clone = sink.clone();
    stream_output_to(&mut child, move |line| {
        sink_clone(SetupProgress::Output(line))
    })
    .await?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for scion.sh {}: {e}", args.join(" ")))?;

    if !status.success() {
        return Err(format!(
            "scion.sh {} exited with status {status}",
            args.join(" ")
        ));
    }
    Ok(())
}

pub async fn run_setup(
    config: &SetupConfig,
    ehapi_token_dir: &Path,
    sink: ProgressSink,
) -> Result<SetupOutcome, String> {
    let phase = |msg: &str| sink(SetupProgress::Phase(msg.to_string()));

    phase("Generating topology configuration…");
    run_scion_sh(&config.scion_folder, &topo_args(config), &sink).await?;

    let gen_dir = config.scion_folder.join("gen");
    let topology = load_topology(&gen_dir).map_err(|e| format!("Failed to load topology: {e}"))?;

    if config.run_grafana {
        phase("Configuring monitoring…");
        let as_ids: Vec<String> = topology.ases.keys().map(|k| k.0.to_string()).collect();
        grafana::generate_grafana_config(&gen_dir, &as_ids)
            .map_err(|e| format!("Failed to generate Grafana config: {e}"))?;
        grafana::patch_monitoring_dc(&gen_dir)
            .map_err(|e| format!("Failed to patch monitoring-dc.yml: {e}"))?;
    }

    if config.run_topology {
        phase("Starting SCION topology…");
        run_scion_sh(&config.scion_folder, &start_args(config.docker), &sink).await?;

        phase("Starting monitoring stack…");
        run_scion_sh(&config.scion_folder, &["start-monitoring"], &sink).await?;
    }

    let ehapi_bridges = if config.run_topology {
        phase("Starting endhost API bridges");
        let log_dir = config.scion_folder.join("logs");
        start_ehapi_bridges(&log_dir, ehapi_token_dir, &topology, config.docker)?
    } else {
        EhapiBridgeMap::new()
    };

    Ok(SetupOutcome {
        topology,
        ehapi_bridges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(run_topology: bool, docker: bool) -> SetupConfig {
        SetupConfig {
            scion_folder: "/tmp/scion".into(),
            topo_file: "topology/default.topo".to_string(),
            run_topology,
            docker,
            run_grafana: false,
        }
    }

    #[test]
    fn topo_args_include_docker_flag_when_running_docker_topology() {
        assert_eq!(
            topo_args(&cfg(true, true)),
            vec!["topology", "-c", "topology/default.topo", "-d"]
        );
    }

    #[test]
    fn topo_args_omit_docker_flag_when_not_running_topology() {
        assert_eq!(
            topo_args(&cfg(false, true)),
            vec!["topology", "-c", "topology/default.topo"]
        );
    }

    #[test]
    fn topo_args_omit_docker_flag_for_supervisord() {
        assert_eq!(
            topo_args(&cfg(true, false)),
            vec!["topology", "-c", "topology/default.topo"]
        );
    }

    #[test]
    fn start_args_include_docker_flag() {
        assert_eq!(start_args(true), vec!["start", "-d"]);
        assert_eq!(start_args(false), vec!["start"]);
    }
}
