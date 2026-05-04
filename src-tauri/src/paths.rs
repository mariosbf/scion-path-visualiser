use std::sync::Arc;

use endhost_api_client::client::CrpcEndhostApiClient;
use scion_sdk_reqwest_connect_rpc::token_source::static_token::StaticTokenSource;
use scion_stack::path::fetcher::{
    traits::PathFetcher, EndhostApiSegmentFetcher, PathFetcherImpl,
};
use scionpings::endhost_api_bridge::token_authority::TokenIdentity;
use specta::Type;
use serde::{Deserialize, Serialize};
use tauri_plugin_log::log::info;

use crate::{topology::IsdAsnDef, EhapiBridgesState, TopologyState};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ScionPathInterface {
    pub isd_as: String,
    pub interface_id: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ScionPath {
    pub interfaces: Vec<ScionPathInterface>,
    pub expiry: String,
    pub mtu: u16,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn get_paths(
    topology_state: tauri::State<'_, TopologyState>,
    bridges: tauri::State<'_, EhapiBridgesState>,
    src_as: IsdAsnDef,
    dst_as: IsdAsnDef,
) -> Result<Vec<ScionPath>, String> {
    // 1. Look up ehapi bridge address from topology
    let ehapi_addr = {
        let topo = topology_state.0.lock().unwrap();
        let topo = topo.as_ref().ok_or("Topology not loaded")?;
        topo.ases
            .get(&src_as)
            .ok_or_else(|| format!("No AS info for {}", src_as.0))?
            .endhost_api_bridge
            .addr
    };

    info!("Fetching paths from {} to {}", src_as.0, dst_as.0);

    // 2. Mint a short-lived token for the src AS
    let token = {
        let map = bridges.0.lock().unwrap();
        let app_state = map
            .get(&src_as)
            .ok_or_else(|| format!("No endhost API bridge for AS {}", src_as.0))?;
        let expires_at = std::time::SystemTime::now()
            .checked_add(std::time::Duration::from_secs(60))
            .ok_or("Invalid validity duration")?;
        let identity = TokenIdentity { email: None };
        let (token, _) = app_state
            .token_authority
            .create_token(identity, expires_at)
            .map_err(|e| format!("Failed to create token: {e}"))?;
        token
    };

    // 3. Build endhost API client with token
    let url = url::Url::parse(&format!("http://{}", ehapi_addr))
        .map_err(|e| format!("Invalid endhost API address: {e}"))?;
    let mut client = CrpcEndhostApiClient::new(&url)
        .map_err(|e| format!("Failed to create endhost API client: {e}"))?;
    client.use_token_source(Arc::new(StaticTokenSource::from(token)));

    // 4. Fetch paths via scion-stack PathFetcher
    let fetcher = PathFetcherImpl::new(
        vec![(
            "endhost-api".to_string(),
            Box::new(EndhostApiSegmentFetcher::new(Arc::new(client))),
        )],
        std::time::Duration::from_secs(10),
    );

    let paths: Vec<scion_proto::path::Path> = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        fetcher.fetch_paths(src_as.0, dst_as.0),
    )
    .await
    .map_err(|_| "Path fetch timed out after 15 seconds".to_string())?
    .map_err(|e| format!("Failed to fetch paths: {e}"))?;

    info!("Fetched {} paths from {} to {}", paths.len(), src_as.0, dst_as.0);

    // 5. Convert to ScionPath
    let result = paths
        .into_iter()
        .filter_map(|p| {
            let metadata = p.metadata?;
            let interfaces = metadata
                .interfaces
                .unwrap_or_default()
                .into_iter()
                .map(|i| ScionPathInterface {
                    isd_as: i.isd_asn.to_string(),
                    interface_id: i.id,
                })
                .collect();
            Some(ScionPath {
                interfaces,
                expiry: metadata.expiration.to_rfc3339(),
                mtu: metadata.mtu,
            })
        })
        .collect();

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scion_path_serializes() {
        let path = ScionPath {
            interfaces: vec![
                ScionPathInterface {
                    isd_as: "1-ff00:0:110".into(),
                    interface_id: 1,
                },
                ScionPathInterface {
                    isd_as: "1-ff00:0:111".into(),
                    interface_id: 2,
                },
            ],
            expiry: "2026-05-04T12:00:00Z".into(),
            mtu: 1472,
        };
        let json = serde_json::to_string(&path).unwrap();
        assert!(json.contains("1-ff00:0:110"));
        assert!(json.contains("1472"));
        assert!(json.contains("interface_id"));
    }
}
