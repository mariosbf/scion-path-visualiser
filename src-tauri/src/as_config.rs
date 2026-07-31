use std::collections::BTreeMap;
use std::path::Path;

use scion_proto::address::IsdAsn;
use serde::Serialize;

use crate::topology::Topology;

#[derive(Debug, Clone, Serialize)]
pub struct AsConfigEntry {
    #[serde(rename = "type")]
    pub as_type: String,
    pub control_service: std::net::SocketAddr,
    pub endhost_api_bridge: std::net::SocketAddr,
    pub endhost_api_bridge_token: String,
    pub hummingbird_redemption_service: Option<std::net::SocketAddr>,
    pub discovery_service: std::net::SocketAddr,
}

// BTreeMap keyed by ISD-AS string so JSON output is deterministically sorted.
pub fn build_as_configs(
    topology: &Topology,
    mint_token: impl Fn(IsdAsn) -> Result<String, String>,
) -> Result<BTreeMap<String, AsConfigEntry>, String> {
    let mut configs = BTreeMap::new();

    for (isd_as, as_info) in topology.ases.iter() {
        let token = mint_token(isd_as.0)
            .map_err(|e| format!("Failed to mint token for AS {}: {e}", isd_as.0))?;

        configs.insert(
            isd_as.0.to_string(),
            AsConfigEntry {
                as_type: if as_info.core { "core" } else { "non-core" }.to_string(),
                control_service: as_info.control_service.addr,
                endhost_api_bridge: as_info.endhost_api_bridge.addr,
                endhost_api_bridge_token: token,
                hummingbird_redemption_service: as_info.hummingbird.as_ref().map(|h| h.addr),
                discovery_service: as_info.discovery_service.addr,
            },
        );
    }

    Ok(configs)
}

// Shared by the CLI (--export-config) and the UI (export_as_config command) so
// both produce byte-identical files.
pub fn write_as_config(
    topology: &Topology,
    mint_token: impl Fn(IsdAsn) -> Result<String, String>,
    path: &Path,
) -> Result<(), String> {
    let configs = build_as_configs(topology, mint_token)?;
    let json = serde_json::to_string_pretty(&configs)
        .map_err(|e| format!("Failed to serialize AS config: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::topology::{
        AsInfo, ControlServiceInfo, DiscoveryServiceInfo, EndhostApiBridgeInfo, HbirdInfo,
        IsdAsnDef, ScionDaemonInfo, Topology,
    };
    use std::collections::HashMap;

    fn isd_as(s: &str) -> IsdAsnDef {
        serde_json::from_str(&format!("\"{s}\"")).unwrap()
    }

    fn make_as(core: bool, with_hbird: bool) -> AsInfo {
        AsInfo {
            core,
            mtu: Some(1472),
            control_service: ControlServiceInfo {
                addr: "127.0.0.70:31000".parse().unwrap(),
                name: "cs1-ff00_0_110-1".to_string(),
                status: None,
            },
            discovery_service: DiscoveryServiceInfo {
                addr: "127.0.0.70:31040".parse().unwrap(),
                name: "cs1-ff00_0_110-1".to_string(),
            },
            hummingbird: with_hbird.then(|| HbirdInfo {
                id: "hbird1-ff00_0_110".to_string(),
                reservation_duration: "10s".to_string(),
                min_bandwidth: 1,
                max_bandwidth: 100,
                addr: "127.0.0.70:30258".parse().unwrap(),
                status: None,
            }),
            daemon: ScionDaemonInfo {
                id: "sd1-ff00_0_110".to_string(),
                address: "127.0.0.1:30255".parse().unwrap(),
                api_addr: "127.0.0.1:30955".parse().unwrap(),
                status: None,
            },
            endhost_api_bridge: EndhostApiBridgeInfo {
                addr: "127.0.0.70:31100".parse().unwrap(),
            },
            border_routers: Vec::new(),
        }
    }

    fn make_topology() -> Topology {
        let mut ases = HashMap::new();
        ases.insert(isd_as("1-ff00:0:110"), make_as(true, true));
        ases.insert(isd_as("1-ff00:0:111"), make_as(false, false));
        Topology {
            ases,
            links: Vec::new(),
        }
    }

    #[test]
    fn builds_entry_per_as_with_all_fields() {
        let topo = make_topology();
        let configs =
            build_as_configs(&topo, |ia| Ok(format!("tok-{ia}"))).unwrap();
        let json = serde_json::to_value(&configs).unwrap();

        let core = &json["1-ff00:0:110"];
        assert_eq!(core["type"], "core");
        assert_eq!(core["control_service"], "127.0.0.70:31000");
        assert_eq!(core["endhost_api_bridge"], "127.0.0.70:31100");
        assert_eq!(core["endhost_api_bridge_token"], "tok-1-ff00:0:110");
        assert_eq!(core["hummingbird_redemption_service"], "127.0.0.70:30258");
        assert_eq!(core["discovery_service"], "127.0.0.70:31040");

        let leaf = &json["1-ff00:0:111"];
        assert_eq!(leaf["type"], "non-core");
        assert!(leaf["hummingbird_redemption_service"].is_null());
        assert_eq!(leaf["endhost_api_bridge_token"], "tok-1-ff00:0:111");
    }

    #[test]
    fn output_is_sorted_by_as_id() {
        let topo = make_topology();
        let configs = build_as_configs(&topo, |_| Ok("t".to_string())).unwrap();
        let keys: Vec<_> = configs.keys().cloned().collect();
        assert_eq!(keys, vec!["1-ff00:0:110", "1-ff00:0:111"]);
    }

    #[test]
    fn token_error_propagates() {
        let topo = make_topology();
        let result = build_as_configs(&topo, |_| Err("no bridge".to_string()));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no bridge"));
    }

    #[test]
    fn write_as_config_writes_pretty_json() {
        let path = std::env::temp_dir().join("scion-as-config-write-test.json");
        let topo = make_topology();
        write_as_config(&topo, |ia| Ok(format!("tok-{ia}")), &path).unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.contains('\n'), "expected pretty-printed JSON");
        let json: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(json["1-ff00:0:110"]["type"], "core");
        assert_eq!(
            json["1-ff00:0:111"]["endhost_api_bridge_token"],
            "tok-1-ff00:0:111"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn write_as_config_propagates_token_error() {
        let path = std::env::temp_dir().join("scion-as-config-write-err-test.json");
        std::fs::remove_file(&path).ok();
        let topo = make_topology();
        let err = write_as_config(&topo, |_| Err("no bridge".to_string()), &path).unwrap_err();
        assert!(err.contains("no bridge"));
        assert!(!path.exists(), "no file should be written on failure");
    }

    #[test]
    fn write_as_config_errors_on_unwritable_path() {
        let path = std::env::temp_dir().join("scion-no-such-dir-xyz/as-config.json");
        let topo = make_topology();
        let err = write_as_config(&topo, |_| Ok("t".to_string()), &path).unwrap_err();
        assert!(err.contains("as-config.json"));
    }
}
