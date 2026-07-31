use std::{collections::HashMap, path::Path, process::Command, sync::Arc, time::Duration};

use nix::fcntl::OFlag;
use nix::sched::{setns, CloneFlags};
use nix::sys::stat::Mode;

use anyhow::{bail, Context};
use scion_sdk_observability::metrics::registry::MetricsRegistry;
use scionpings::endhost_api_bridge::{
    self,
    config::UdpRouterRuntimeConfig,
    token_authority::{TokenAuthority, TokenIdentity},
};
use tauri_plugin_log::log::{debug, warn};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::{
    topology::{IsdAsnDef, Topology},
    AppState, EhapiBridgeMap,
};

fn get_container_pid(container: &str) -> anyhow::Result<u32> {
    let output = Command::new("docker")
        .args(["inspect", "-f", "{{.State.Pid}}", container])
        .output()
        .context("failed to run docker inspect")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("docker inspect failed: {}", stderr.trim());
    }

    String::from_utf8(output.stdout)
        .context("invalid utf-8 in docker output")?
        .trim()
        .parse()
        .context("failed to parse container pid")
}

fn enter_docker_ns(container: &str) -> anyhow::Result<()> {
    let pid = get_container_pid(container)?;

    if pid == 0 {
        bail!("container is not running (pid 0)");
    }

    let ns_path = format!("/proc/{}/ns/net", pid);
    let fd = nix::fcntl::open(ns_path.as_str(), OFlag::O_RDONLY, Mode::empty())
        .with_context(|| format!("failed to open {}", ns_path))?;
    setns(&fd, CloneFlags::CLONE_NEWNET).context("failed to setns")?;

    Ok(())
}

pub fn start_ehapi_bridges(
    log_folder: &Path,
    token_dir: &Path,
    topology: &Topology,
    use_docker_ns: bool,
) -> Result<EhapiBridgeMap, String> {
    let mut map = HashMap::new();

    for (isd_as, as_info) in topology.ases.iter() {
        debug!(
            "Setting up endhost API bridge for AS {} with control service at {}",
            isd_as.0, as_info.control_service.addr
        );

        let control_plane_url = Url::parse(&format!("http://{}", as_info.control_service.addr))
            .map_err(|e| format!("Invalid control service address: {e}"))?;

        let as_token_dir = token_dir.join(format!("as-{}", isd_as.0));
        std::fs::create_dir_all(&as_token_dir).map_err(|e| {
            format!(
                "Failed to create token directory for AS {} at {}: {e}",
                isd_as.0, e
            )
        })?;

        let cfg = endhost_api_bridge::config::EffectiveConfig {
            bind_endhost_api: as_info.endhost_api_bridge.addr,
            advertise_endhost_api_ip: None,
            control_plane_url,
            isd_ases: vec![isd_as.0],
            src_core: as_info.core,
            token_public_key_pem: Some(
                as_token_dir
                    .join("public.pem")
                    .to_string_lossy()
                    .to_string(),
            ),
            print_insecure_token: false,
            udp_routers: as_info
                .border_routers
                .iter()
                .map(|br| UdpRouterRuntimeConfig {
                    endpoint: br.internal_addr,
                    interfaces: br.interfaces.keys().cloned().collect(),
                    isd_ases: vec![isd_as.0],
                })
                .collect(),
            log_level: tracing::Level::DEBUG,
        };

        let token_authority = Arc::new(
            TokenAuthority::load_or_create(&cfg)
                .map_err(|e| format!("Failed to load or create token authority: {e}"))?,
        );

        let master_cancel = CancellationToken::new();
        let metrics_registry = Arc::new(MetricsRegistry::new());

        // Map stores the master state: token_authority for mint_token, cancel for shutdown.
        let master_state = Arc::new(endhost_api_bridge::state::AppState {
            token_authority: token_authority.clone(),
            metrics_registry: metrics_registry.clone(),
            cancel: master_cancel.clone(),
        });
        map.insert(isd_as.0, master_state);

        #[allow(clippy::clone_on_copy)]
        let isd_as = isd_as.clone();
        let log_folder = log_folder.to_path_buf();
        let cs_name = as_info.control_service.name.clone();

        std::thread::Builder::new()
            .name(format!("ehapi-bridge-watchdog-{}", isd_as.0))
            .spawn(move || {
                if !use_docker_ns {
                    // Supervisord: bridge runs on host network; per-request HTTP calls to the
                    // control service reconnect automatically after an external restart.
                    let log_file_path =
                        log_folder.join(format!("ehapi-bridge-{}.log", isd_as.0));
                    let Ok(log_file) = std::fs::File::create(&log_file_path) else {
                        warn!("Failed to create log file for AS {}", isd_as.0);
                        return;
                    };
                    let (non_blocking_writer, guard) = tracing_appender::non_blocking(log_file);
                    let subscriber = tracing_subscriber::fmt()
                        .with_max_level(tracing::Level::DEBUG)
                        .with_writer(non_blocking_writer)
                        .with_ansi(false)
                        .finish();
                    let _enter = tracing::subscriber::set_default(subscriber);
                    let _guard = guard;

                    let run_state = Arc::new(endhost_api_bridge::state::AppState {
                        token_authority,
                        metrics_registry,
                        cancel: master_cancel,
                    });
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("Failed to build per-AS Tokio runtime");
                    rt.block_on(async move {
                        let _ =
                            scionpings::endhost_api_bridge::server::run(run_state, cfg).await;
                    });
                    return;
                }

                // Docker mode: each container restart creates a new network namespace. The bridge
                // thread enters the namespace via setns, so it must be restarted whenever the
                // container restarts. Poll the container PID and restart the bridge on change.
                let mut last_pid: Option<u32> = None;
                let mut run_cancel: Option<CancellationToken> = None;
                let mut bridge_thread: Option<std::thread::JoinHandle<()>> = None;

                loop {
                    if master_cancel.is_cancelled() {
                        break;
                    }

                    // If the bridge thread exited without an explicit cancel (e.g. bind failed
                    // because the container wasn't ready yet), clear state so we retry.
                    if bridge_thread
                        .as_ref()
                        .map(|h| h.is_finished())
                        .unwrap_or(false)
                    {
                        bridge_thread.take();
                        run_cancel.take();
                        last_pid = None;
                    }

                    let container = format!("scion-{}-1", cs_name);
                    let current_pid =
                        get_container_pid(&container).ok().filter(|&p| p > 0);

                    if current_pid != last_pid {
                        // Container changed state — cancel and join any running bridge.
                        if let Some(cancel) = run_cancel.take() {
                            cancel.cancel();
                        }
                        if let Some(handle) = bridge_thread.take() {
                            let _ = handle.join();
                        }

                        last_pid = current_pid;

                        if current_pid.is_some() {
                            let new_cancel = master_cancel.child_token();
                            let new_state = Arc::new(endhost_api_bridge::state::AppState {
                                token_authority: token_authority.clone(),
                                metrics_registry: Arc::new(MetricsRegistry::new()),
                                cancel: new_cancel.clone(),
                            });

                            let log_file_path =
                                log_folder.join(format!("ehapi-bridge-{}.log", isd_as.0));
                            let Ok(log_file) = std::fs::File::create(&log_file_path) else {
                                warn!(
                                    "Failed to create log file for AS {}, will retry",
                                    isd_as.0
                                );
                                last_pid = None;
                                std::thread::sleep(Duration::from_secs(2));
                                continue;
                            };
                            let (non_blocking_writer, guard) =
                                tracing_appender::non_blocking(log_file);

                            let cs_name_clone = cs_name.clone();
                            let cfg_clone = cfg.clone();
                            let isd_as_clone = isd_as.clone();

                            let handle = std::thread::Builder::new()
                                .name(format!("ehapi-bridge-{}", isd_as.0))
                                .spawn(move || {
                                    if enter_docker_ns(&format!(
                                        "scion-{}-1",
                                        cs_name_clone
                                    ))
                                    .is_err()
                                    {
                                        warn!(
                                            "Failed to enter Docker namespace for AS {}.",
                                            isd_as_clone.0
                                        );
                                        return;
                                    }

                                    let subscriber = tracing_subscriber::fmt()
                                        .with_max_level(tracing::Level::DEBUG)
                                        .with_writer(non_blocking_writer)
                                        .with_ansi(false)
                                        .finish();
                                    let _enter =
                                        tracing::subscriber::set_default(subscriber);
                                    let _guard = guard;

                                    let rt = tokio::runtime::Builder::new_current_thread()
                                        .enable_all()
                                        .build()
                                        .expect("Failed to build per-AS Tokio runtime");

                                    rt.block_on(async move {
                                        let _ =
                                            scionpings::endhost_api_bridge::server::run(
                                                new_state, cfg_clone,
                                            )
                                            .await;
                                    });
                                });

                            match handle {
                                Ok(h) => {
                                    run_cancel = Some(new_cancel);
                                    bridge_thread = Some(h);
                                    debug!(
                                        "Started bridge for AS {} in new container namespace",
                                        isd_as.0
                                    );
                                }
                                Err(e) => {
                                    warn!(
                                        "Failed to spawn bridge thread for AS {}: {e}",
                                        isd_as.0
                                    );
                                    last_pid = None; // retry next poll
                                }
                            }
                        } else {
                            warn!(
                                "CS container for AS {} not running, waiting for restart…",
                                isd_as.0
                            );
                        }
                    }

                    std::thread::sleep(Duration::from_secs(2));
                }

                // Shutdown: stop the current bridge and wait for clean exit.
                if let Some(cancel) = run_cancel.take() {
                    cancel.cancel();
                }
                if let Some(handle) = bridge_thread.take() {
                    let _ = handle.join();
                }
            })
            .map_err(|e| {
                format!("Failed to spawn watchdog thread for AS {}: {e}", isd_as.0)
            })?;
    }

    Ok(map)
}

pub fn mint_token_for(
    map: &EhapiBridgeMap,
    isd_as: scion_proto::address::IsdAsn,
    ttl_seconds: u32,
) -> Result<String, String> {
    let app_state = map
        .get(&isd_as)
        .ok_or_else(|| format!("No endhost API bridge for AS {isd_as}"))?;

    let expires_at = std::time::SystemTime::now()
        .checked_add(std::time::Duration::from_secs(ttl_seconds as u64))
        .ok_or("Invalid validity duration")?;

    let identity = TokenIdentity { email: None };

    let (token, _) = app_state
        .token_authority
        .create_token(identity, expires_at)
        .map_err(|e| format!("Failed to create token: {e}"))?;

    Ok(token)
}

#[tauri::command]
#[specta::specta]
pub fn mint_token(
    state: tauri::State<'_, AppState>,
    isd_as: IsdAsnDef,
    ttl_seconds: u32,
) -> Result<String, String> {
    let state = state.lock().unwrap();
    let map = &state.running()?.ehapi_bridges;

    debug!(
        "Requested token minting for AS {}, TTL {} seconds",
        isd_as.0, ttl_seconds
    );

    mint_token_for(map, isd_as.0, ttl_seconds)
}
