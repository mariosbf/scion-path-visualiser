use anyhow::Context;
use scion_proto::address::IsdAsn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Constants ─────────────────────────────────────────────────────────────────

pub const HBIRD_REDEMPTION_API_PORT: u16 = 30528;

// ── IsdAsnDef ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IsdAsnDef(pub IsdAsn);

impl specta::Type for IsdAsnDef {
    fn inline(_: &mut specta::TypeMap, _: specta::Generics) -> specta::DataType {
        specta::DataType::Primitive(specta::datatype::PrimitiveType::String)
    }
}

// ── Tauri-facing types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Topology {
    pub ases: HashMap<IsdAsnDef, AsInfo>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AsInfo {
    pub core: bool,
    pub mtu: Option<u32>,
    pub control_service: ControlServiceInfo,
    pub discovery_service: DiscoveryServiceInfo,
    pub hummingbird: Option<HbirdInfo>,
    pub daemon: ScionDaemonInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct HbirdInfo {
    pub id: String,
    pub reservation_duration: String,
    pub min_bandwidth: u32,
    pub max_bandwidth: u32,
    pub addr: std::net::SocketAddr,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ScionDaemonInfo {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ControlServiceInfo {
    pub addr: std::net::SocketAddr,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct DiscoveryServiceInfo {
    pub addr: std::net::SocketAddr,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Link {
    pub a: LinkEndpoint,
    pub b: LinkEndpoint,
    pub link_type: LinkType,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LinkEndpoint {
    pub as_id: IsdAsnDef,
    pub router_name: String,
    pub interface_id: u32,
    pub underlay_local: std::net::SocketAddr,
    pub underlay_remote: std::net::SocketAddr,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub enum LinkType {
    Core,
    Child,
    Peer,
}

// ── Raw types for JSON deserialization ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RawAsTopology {
    pub isd_as: IsdAsnDef,
    pub attributes: Vec<String>,
    pub mtu: Option<u32>,
    pub border_routers: HashMap<String, RawBorderRouter>,
    pub control_service: HashMap<String, RawControlService>,
    pub discovery_service: HashMap<String, RawDiscoveryService>,
    pub dispatched_ports: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RawBorderRouter {
    pub internal_addr: std::net::SocketAddr,
    pub interfaces: HashMap<String, RawInterface>,
}

#[derive(Debug, Deserialize)]
pub struct RawControlService {
    pub addr: std::net::SocketAddr,
}

#[derive(Debug, Deserialize)]
pub struct RawDiscoveryService {
    pub addr: std::net::SocketAddr,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawInterface {
    pub isd_as: IsdAsnDef,
    pub link_to: String,
    pub mtu: Option<u32>,
    pub underlay: RawUnderlay,
    pub remote_interface_id: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawUnderlay {
    pub local: std::net::SocketAddr,
    pub remote: std::net::SocketAddr,
}

// ── Raw types for TOML hbird.toml deserialization ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RawHbirdConfig {
    pub general: RawHbirdGeneral,
    pub hummingbird: RawHbirdHummingbird,
}

#[derive(Debug, Deserialize)]
pub struct RawHbirdGeneral {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct RawHbirdHummingbird {
    pub reservation_duration: String,
    pub min_bandwidth: u32,
    pub max_bandwidth: u32,
}

// ── Raw types for TOML sd.toml deserialization ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RawSdConfig {
    pub general: RawSdGeneral,
}

#[derive(Debug, Deserialize)]
pub struct RawSdGeneral {
    pub id: String,
}

pub fn build_topology(
    raw_ases: Vec<RawAsTopology>,
    hbird_map: HashMap<IsdAsnDef, RawHbirdConfig>,
    sd_map: HashMap<IsdAsnDef, RawSdConfig>,
) -> anyhow::Result<Topology> {
    // Build interface index: (as_id, interface_id) -> (router_name, interface)
    let mut iface_index: HashMap<(IsdAsnDef, u32), (String, RawInterface)> = HashMap::new();
    for raw_as in &raw_ases {
        for (router_name, router) in &raw_as.border_routers {
            for (if_id_str, iface) in &router.interfaces {
                if let Ok(if_id) = if_id_str.parse::<u32>() {
                    iface_index
                        .insert((raw_as.isd_as, if_id), (router_name.clone(), iface.clone()));
                }
            }
        }
    }

    let mut links: Vec<Link> = Vec::new();

    for raw_as in &raw_ases {
        for (router_name, router) in &raw_as.border_routers {
            for (if_id_str, iface) in &router.interfaces {
                let local_as = raw_as.isd_as;
                let remote_as = iface.isd_as;

                // Process each link only from the side with the smaller IsdAsn u64 value
                if local_as.0.to_u64() >= remote_as.0.to_u64() {
                    continue;
                }

                let if_id: u32 = match if_id_str.parse() {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                // Find the remote endpoint
                let remote_endpoint = if let Some(remote_if_id) = iface.remote_interface_id {
                    // Peer link: remote_interface_id is provided directly
                    iface_index.get(&(remote_as, remote_if_id)).map(|(rn, ri)| {
                        (
                            rn.clone(),
                            remote_if_id,
                            ri.underlay.local,
                            ri.underlay.remote,
                        )
                    })
                } else {
                    // Core/child/parent: find remote interface pointing back to local_as
                    iface_index
                        .iter()
                        .find(|(key, (_, ri))| key.0 == remote_as && ri.isd_as == local_as)
                        .map(|(key, (rn, ri))| {
                            (rn.clone(), key.1, ri.underlay.local, ri.underlay.remote)
                        })
                };

                let (remote_router, remote_if_id, remote_local, remote_remote) =
                    match remote_endpoint {
                        Some(ep) => ep,
                        None => continue,
                    };

                let link_type = match iface.link_to.as_str() {
                    "core" => LinkType::Core,
                    "child" | "parent" => LinkType::Child,
                    "peer" => LinkType::Peer,
                    _ => continue,
                };

                links.push(Link {
                    a: LinkEndpoint {
                        as_id: local_as,
                        router_name: router_name.clone(),
                        interface_id: if_id,
                        underlay_local: iface.underlay.local,
                        underlay_remote: iface.underlay.remote,
                    },
                    b: LinkEndpoint {
                        as_id: remote_as,
                        router_name: remote_router,
                        interface_id: remote_if_id,
                        underlay_local: remote_local,
                        underlay_remote: remote_remote,
                    },
                    link_type,
                });
            }
        }
    }

    let mut ases: HashMap<IsdAsnDef, AsInfo> = HashMap::new();
    for raw_as in &raw_ases {
        let (control_service_name, control_service_info) = raw_as
            .control_service
            .iter()
            .next()
            .context("Control service entry missing")?;
        let (discovery_service_name, discovery_service_info) = raw_as
            .discovery_service
            .iter()
            .next()
            .context("Discovery service entry missing")?;

        let hummingbird = hbird_map.get(&raw_as.isd_as).map(|hb| HbirdInfo {
            id: hb.general.id.clone(),
            reservation_duration: hb.hummingbird.reservation_duration.clone(),
            min_bandwidth: hb.hummingbird.min_bandwidth,
            max_bandwidth: hb.hummingbird.max_bandwidth,
            addr: std::net::SocketAddr::new(
                control_service_info.addr.ip(),
                HBIRD_REDEMPTION_API_PORT,
            ),
        });

        let daemon = sd_map
            .get(&raw_as.isd_as)
            .map(|sd| ScionDaemonInfo {
                id: sd.general.id.clone(),
            })
            .with_context(|| {
                format!(
                    "sd.toml missing for AS {} — cannot determine daemon service name",
                    raw_as.isd_as.0
                )
            })?;

        ases.insert(
            raw_as.isd_as,
            AsInfo {
                core: raw_as.attributes.contains(&"core".to_string()),
                mtu: raw_as.mtu,
                control_service: ControlServiceInfo {
                    addr: control_service_info.addr,
                    name: control_service_name.clone(),
                },
                discovery_service: DiscoveryServiceInfo {
                    addr: discovery_service_info.addr,
                    name: discovery_service_name.clone(),
                },
                hummingbird,
                daemon,
            },
        );
    }

    Ok(Topology { ases, links })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fixture() -> Vec<RawAsTopology> {
        let json_110 = r#"{
            "attributes": ["core"],
            "isd_as": "1-ff00:0:110",
            "mtu": 1472,
            "control_service": {
                "cs1-ff00_0_110-1": {
                    "addr": "127.0.0.70:31000"
                }
            },
            "discovery_service": {
                "cs1-ff00_0_110-1": {
                    "addr": "127.0.0.70:31000"
                }
            },
            "border_routers": {
                "br1-ff00_0_110-1": {
                    "internal_addr": "127.0.0.1:31000",
                    "interfaces": {
                        "1001": {
                            "underlay": {"local": "127.0.0.1:50000", "remote": "127.0.0.2:50000"},
                            "isd_as": "1-ff00:0:111",
                            "link_to": "child",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        let json_111 = r#"{
            "attributes": [],
            "isd_as": "1-ff00:0:111",
            "mtu": 1472,
            "control_service": {
                "cs1-ff00_0_111-1": {
                    "addr": "127.0.0.70:31001"
                }
            },
            "discovery_service": {
                "cs1-ff00_0_111-1": {
                    "addr": "127.0.0.70:31001"
                }
            },
            "border_routers": {
                "br1-ff00_0_111-1": {
                    "internal_addr": "127.0.0.2:31000",
                    "interfaces": {
                        "2001": {
                            "underlay": {"local": "127.0.0.2:50000", "remote": "127.0.0.1:50000"},
                            "isd_as": "1-ff00:0:110",
                            "link_to": "parent",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        vec![
            serde_json::from_str(json_110).unwrap(),
            serde_json::from_str(json_111).unwrap(),
        ]
    }

    #[test]
    fn build_topology_produces_correct_ases() {
        let topo = build_topology(make_fixture(), HashMap::new(), make_sd_fixture()).unwrap();
        assert_eq!(topo.ases.len(), 2);
        let as110 = topo
            .ases
            .iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:110")
            .unwrap();
        assert!(as110.1.core);
        assert_eq!(as110.1.mtu, Some(1472));
        let as111 = topo
            .ases
            .iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:111")
            .unwrap();
        assert!(!as111.1.core);
    }

    #[test]
    fn build_topology_deduplicates_to_one_link() {
        let topo = build_topology(make_fixture(), HashMap::new(), make_sd_fixture()).unwrap();
        assert_eq!(topo.links.len(), 1);
    }

    #[test]
    fn build_topology_child_link_endpoints() {
        let topo = build_topology(make_fixture(), HashMap::new(), make_sd_fixture()).unwrap();
        let link = &topo.links[0];
        assert!(matches!(link.link_type, LinkType::Child));
        // Link processed from smaller IsdAsn side (1-ff00:0:110 < 1-ff00:0:111)
        assert_eq!(link.a.as_id.0.to_string(), "1-ff00:0:110");
        assert_eq!(link.a.router_name, "br1-ff00_0_110-1");
        assert_eq!(link.a.interface_id, 1001);
        assert_eq!(link.b.as_id.0.to_string(), "1-ff00:0:111");
        assert_eq!(link.b.router_name, "br1-ff00_0_111-1");
        assert_eq!(link.b.interface_id, 2001);
    }

    #[test]
    fn isd_asn_def_serde_roundtrip() {
        let ia: IsdAsnDef = serde_json::from_str(r#""1-ff00:0:110""#).unwrap();
        assert_eq!(serde_json::to_string(&ia).unwrap(), r#""1-ff00:0:110""#);
    }

    #[test]
    fn raw_as_topology_deserializes() {
        let json = r#"{
            "attributes": ["core"],
            "isd_as": "1-ff00:0:110",
            "mtu": 1472,
            "control_service": {
                "cs1-ff00_0_110-1": {
                    "addr": "127.0.0.70:31000"
                }
            },
            "discovery_service": {
                "cs1-ff00_0_110-1": {
                    "addr": "127.0.0.70:31000"
                }
            },
            "border_routers": {
                "br1": {
                    "internal_addr": "127.0.0.1:31000",
                    "interfaces": {
                        "1001": {
                            "underlay": {"local": "127.0.0.1:50000", "remote": "127.0.0.2:50000"},
                            "isd_as": "1-ff00:0:111",
                            "link_to": "child",
                            "mtu": 1472
                        }
                    }
                }
            }
        }"#;
        let raw: RawAsTopology = serde_json::from_str(json).unwrap();
        assert!(raw.attributes.contains(&"core".to_string()));
        assert_eq!(raw.mtu, Some(1472));
        assert!(raw.border_routers.contains_key("br1"));
    }

    fn make_sd_fixture() -> HashMap<IsdAsnDef, RawSdConfig> {
        let mut sd_map = HashMap::new();
        let ia110: IsdAsnDef = serde_json::from_str(r#""1-ff00:0:110""#).unwrap();
        let ia111: IsdAsnDef = serde_json::from_str(r#""1-ff00:0:111""#).unwrap();
        sd_map.insert(
            ia110,
            RawSdConfig {
                general: RawSdGeneral {
                    id: "sd1-ff00_0_110".to_string(),
                },
            },
        );
        sd_map.insert(
            ia111,
            RawSdConfig {
                general: RawSdGeneral {
                    id: "sd1-ff00_0_111".to_string(),
                },
            },
        );
        sd_map
    }

    #[test]
    fn build_topology_includes_daemon_info() {
        let topo = build_topology(make_fixture(), HashMap::new(), make_sd_fixture()).unwrap();
        let as110 = topo
            .ases
            .iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:110")
            .unwrap();
        assert_eq!(as110.1.daemon.id, "sd1-ff00_0_110");
        let as111 = topo
            .ases
            .iter()
            .find(|(k, _)| k.0.to_string() == "1-ff00:0:111")
            .unwrap();
        assert_eq!(as111.1.daemon.id, "sd1-ff00_0_111");
    }

    #[test]
    fn build_topology_errors_on_missing_daemon() {
        let result = build_topology(make_fixture(), HashMap::new(), HashMap::new());
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("sd.toml"), "error should mention sd.toml, got: {msg}");
    }
}
