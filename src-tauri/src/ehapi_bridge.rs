use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use scion_sdk_observability::metrics::registry::MetricsRegistry;
use scionpings::endhost_api_bridge::{
    self,
    token_authority::{TokenAuthority, TokenIdentity},
};
use tauri::{Emitter, Manager};
use tauri_plugin_log::log::info;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::{topology::IsdAsnDef, TopologyState};

pub struct EhapiBridgesState(
    pub Mutex<HashMap<IsdAsnDef, Arc<endhost_api_bridge::state::AppState>>>,
);

pub fn start_ehapi_bridges(app: &tauri::AppHandle) -> Result<(), String> {
    let topo_state = app.state::<TopologyState>();
    let topo_mutex = topo_state.0.lock().unwrap();
    let topology = topo_mutex
        .as_ref()
        .ok_or_else(|| "Topology not loaded".to_string())?;

    info!(
        "Topology ASes: {:?}",
        topology.ases.keys().map(|k| k.0).collect::<Vec<_>>()
    );

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let token_dir = app_data_dir.join("ehapi-bridge-tokens");

    for (isd_as, as_info) in topology.ases.iter() {
        info!(
            "Setting up endhost API bridge for AS {} with control service at {}",
            isd_as.0, as_info.control_service.addr
        );
        app.emit(
            "scion-setup-phase",
            format!("Starting endhost API bridge for AS {}…", isd_as.0),
        )
        .ok();

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
            udp_routers: as_info.border_routers.iter().map(|br| br.into()).collect(),
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

        app.state::<EhapiBridgesState>()
            .0
            .lock()
            .unwrap()
            .insert(*isd_as, ehapi_app_state.clone());

        #[allow(clippy::clone_on_copy)]
        let isd_as = isd_as.clone();

        tokio::spawn(async move {
            // TODO: handle error appropriately
            let _ = scionpings::endhost_api_bridge::server::run(ehapi_app_state, cfg)
                .await
                .map_err(|e| {
                    format!(
                        "Failed to start endhost API bridge for AS {}: {e}",
                        isd_as.0
                    )
                });
        });
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn mint_token(
    state: tauri::State<'_, EhapiBridgesState>,
    isd_as: IsdAsnDef,
    ttl_seconds: u32,
) -> Result<String, String> {
    let map = state.0.lock().unwrap();
    info!(
        "Map keys: {:?}",
        map.keys().map(|k| k.0).collect::<Vec<_>>()
    );
    info!(
        "Requested token minting for AS {}, TTL {} seconds",
        isd_as.0, ttl_seconds
    );

    let app_state = map
        .get(&isd_as)
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
