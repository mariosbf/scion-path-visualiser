use std::{collections::HashMap, path::Path, sync::Arc};

use scion_sdk_observability::metrics::registry::MetricsRegistry;
use scionpings::endhost_api_bridge::{
    self,
    config::UdpRouterRuntimeConfig,
    token_authority::{TokenAuthority, TokenIdentity},
};
use tauri_plugin_log::log::debug;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::{
    topology::{IsdAsnDef, Topology},
    AppState, EhapiBridgeMap,
};

pub fn start_ehapi_bridges(
    log_folder: &Path,
    token_dir: &Path,
    topology: &Topology,
) -> Result<EhapiBridgeMap, String> {
    let mut map = HashMap::new();

    for (isd_as, as_info) in topology.ases.iter() {
        debug!(
            "Setting up endhost API bridge for AS {} with control service at {}",
            isd_as.0, as_info.control_service.addr
        );

        // Derive from control_service.addr
        let control_plane_url = Url::parse(&format!("http://{}", as_info.control_service.addr))
            .map_err(|e| format!("Invalid control service address: {e}"))?;

        // Token directory
        let as_token_dir = token_dir.join(format!("as-{}", isd_as.0));
        std::fs::create_dir_all(&as_token_dir).map_err(|e| {
            format!(
                "Failed to create token directory for AS {} at {}: {e}",
                isd_as.0, e
            )
        })?;

        // Start endhost API bridges
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

        let cancellation_token = CancellationToken::new();
        let metrics_registry = Arc::new(MetricsRegistry::new());
        let ehapi_app_state = Arc::new(endhost_api_bridge::state::AppState {
            token_authority,
            metrics_registry,
            cancel: cancellation_token.clone(),
        });

        map.insert(isd_as.0, ehapi_app_state.clone());

        #[allow(clippy::clone_on_copy)]
        let isd_as = isd_as.clone();

        let log_file = log_folder.join(format!("ehapi-bridge-{}.log", isd_as.0));
        let log_file = std::fs::File::create(&log_file)
            .map_err(|e| format!("Failed to create log file for AS {}: {e}", isd_as.0))?;
        let (non_blocking_writer, guard) = tracing_appender::non_blocking(log_file);

        std::thread::Builder::new()
            .name(format!("ehapi-bridge-{}", isd_as.0))
            .spawn(move || {
                let subscriber = tracing_subscriber::fmt()
                    .with_max_level(tracing::Level::DEBUG)
                    .with_writer(non_blocking_writer)
                    .with_ansi(false)
                    .finish();

                let _enter = tracing::subscriber::set_default(subscriber);
                let _guard = guard;

                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("Failed to build per-AS Tokio runtime");

                rt.block_on(async move {
                    let _ = scionpings::endhost_api_bridge::server::run(ehapi_app_state, cfg)
                        .await
                        .map_err(|e| {
                            format!(
                                "Failed to start endhost API bridge for AS {}: {e}",
                                isd_as.0
                            )
                        });
                });
            })
            .map_err(|e| format!("Failed to spawn bridge thread for AS {}: {e}", isd_as.0))?;
    }

    Ok(map)
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

    let app_state = map
        .get(&isd_as.0)
        .ok_or_else(|| format!("No endhost API bridge for AS {}", isd_as.0))?;

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
