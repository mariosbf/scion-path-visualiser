use anyhow::{bail, Context};
use scion_proto::address::IsdAsn;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};

use crate::status::ServiceStatusInfo;

// ── Constants ─────────────────────────────────────────────────────────────────

pub const HBIRD_REDEMPTION_API_PORT: u16 = 30258;
pub const EHAPI_BRIDGE_PORT: u16 = 31100;

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
    pub endhost_api_bridge: EndhostApiBridgeInfo,
    pub border_routers: Vec<BorderRouterInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct BorderRouterInfo {
    pub name: String,
    pub internal_addr: std::net::SocketAddr,
    pub interfaces: HashMap<u16, BorderRouterInterfaceInfo>,
    pub status: Option<ServiceStatusInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct EndhostApiBridgeInfo {
    pub addr: std::net::SocketAddr,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct BorderRouterInterfaceInfo {
    pub isd_as: IsdAsnDef,
    pub link_to: String,
    pub mtu: Option<u32>,
    pub underlay_local: std::net::SocketAddr,
    pub underlay_remote: std::net::SocketAddr,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct HbirdInfo {
    pub id: String,
    pub reservation_duration: String,
    pub min_bandwidth: u32,
    pub max_bandwidth: u32,
    pub addr: std::net::SocketAddr,
    pub status: Option<ServiceStatusInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ScionDaemonInfo {
    pub id: String,
    pub address: std::net::SocketAddr,
    pub api_addr: std::net::SocketAddr,
    pub status: Option<ServiceStatusInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ControlServiceInfo {
    pub addr: std::net::SocketAddr,
    pub name: String,
    pub status: Option<ServiceStatusInfo>,
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
    pub interface_id: u16,
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

impl RawAsTopology {
    pub fn border_router_info(&self) -> Vec<BorderRouterInfo> {
        self.border_routers
            .iter()
            .map(|(name, router)| BorderRouterInfo {
                name: name.clone(),
                internal_addr: router.internal_addr,
                interfaces: router
                    .interfaces
                    .iter()
                    .map(|(&if_id, iface)| {
                        (
                            if_id,
                            BorderRouterInterfaceInfo {
                                isd_as: iface.isd_as,
                                link_to: iface.link_to.clone(),
                                mtu: iface.mtu,
                                underlay_local: iface.underlay.local,
                                underlay_remote: iface.underlay.remote,
                            },
                        )
                    })
                    .collect(),
                status: None,
            })
            .collect()
    }
}

#[derive(Debug, Deserialize)]
pub struct RawBorderRouter {
    pub internal_addr: std::net::SocketAddr,
    pub interfaces: HashMap<u16, RawInterface>,
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
    pub remote_interface_id: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawUnderlay {
    pub local: std::net::SocketAddr,
    pub remote: std::net::SocketAddr,
}
// ── Raw types for TOML ifids.yml deserialization ──────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(try_from = "HashMap<IsdAsnDef, HashMap<String, String>>")]
pub struct RawIfidConfig {
    pub by_as: HashMap<IsdAsnDef, Vec<RawIfidConfigItem>>,
}

#[derive(Debug)]
pub struct RawIfidConfigItem {
    pub local_router: String,
    pub local_ifid: u16,
    pub remote_router: String,
    pub remote_ifid: u16,
}

impl RawIfidConfigItem {
    fn parse_endpoint(s: &str) -> Result<(String, u16), String> {
        let s = s.trim();
        let last_space = s
            .rfind(' ')
            .ok_or_else(|| format!("no space in endpoint: {s}"))?;
        let router = s[..last_space].to_string();
        let ifid = s[last_space + 1..]
            .parse::<u16>()
            .map_err(|e| format!("bad ifid in '{s}': {e}"))?;

        Ok((router, ifid))
    }
}

impl TryFrom<HashMap<IsdAsnDef, HashMap<String, String>>> for RawIfidConfig {
    type Error = String;

    fn try_from(raw: HashMap<IsdAsnDef, HashMap<String, String>>) -> Result<Self, String> {
        let mut result = HashMap::new();

        for (as_id, links) in raw {
            let mut parsed_links = Vec::with_capacity(links.len());

            for (local, remote) in links {
                let (lr, lid) = RawIfidConfigItem::parse_endpoint(&local)?;
                let (rr, rid) = RawIfidConfigItem::parse_endpoint(&remote)?;

                parsed_links.push(RawIfidConfigItem {
                    local_router: lr,
                    local_ifid: lid,
                    remote_router: rr,
                    remote_ifid: rid,
                })
            }

            result.insert(as_id, parsed_links);
        }

        Ok(Self { by_as: result })
    }
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
    pub sd: RawSdSection,
    pub api: RawSdApiSection,
}

#[derive(Debug, Deserialize)]
pub struct RawSdGeneral {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct RawSdSection {
    pub address: std::net::SocketAddr,
}

#[derive(Debug, Deserialize)]
pub struct RawSdApiSection {
    pub addr: std::net::SocketAddr,
}

pub fn build_topology(
    raw_ases: Vec<RawAsTopology>,
    hbird_map: HashMap<IsdAsnDef, RawHbirdConfig>,
    sd_map: HashMap<IsdAsnDef, RawSdConfig>,
    router_link_config: RawIfidConfig,
) -> anyhow::Result<Topology> {
    // Build interface index: (router_name, interface_id) -> (as_id, router, interface)
    let mut iface_index: HashMap<String, HashMap<u16, (IsdAsnDef, RawInterface)>> = HashMap::new();
    for raw_as in &raw_ases {
        for (router_name, router) in &raw_as.border_routers {
            for (&if_id, iface) in &router.interfaces {
                iface_index
                    .entry(router_name.to_string())
                    .or_default()
                    .insert(if_id, (raw_as.isd_as, iface.clone()));
            }
        }
    }

    let mut links: Vec<Link> = Vec::new();

    for raw_as in &raw_ases {
        let as_links = router_link_config
            .by_as
            .get(&raw_as.isd_as)
            .context(format!(
                "missing entry in ifidis.yaml for AS {}",
                raw_as.isd_as.0
            ))?;

        for link in as_links {
            let local_router_name = &link.local_router;
            let local_ifid = link.local_ifid;

            let remote_router_name = &link.remote_router;
            let remote_ifid = link.remote_ifid;

            let (local_isd_as, local_iface) = iface_index
                .get(local_router_name)
                .and_then(|m| m.get(&local_ifid))
                .context(format!(
                    "missing interface specification for iface with id {} on router {}",
                    local_ifid, local_router_name
                ))?;

            let (remote_isd_as, _) = iface_index
                .get(remote_router_name)
                .and_then(|m| m.get(&remote_ifid))
                .context(format!(
                    "missing interface specification for iface with id {} on router {}",
                    remote_ifid, remote_router_name
                ))?;

            // Process each link only from the side with the smaller IsdAsn u64 value
            if local_isd_as.0.to_u64() >= remote_isd_as.0.to_u64() {
                continue;
            }

            let link_type = match local_iface.link_to.as_str() {
                "core" => LinkType::Core,
                "child" | "parent" => LinkType::Child,
                "peer" => LinkType::Peer,
                _ => {
                    bail!("unknown link type: {}", local_iface.link_to)
                }
            };

            links.push(Link {
                a: LinkEndpoint {
                    as_id: *local_isd_as,
                    router_name: local_router_name.to_string(),
                    interface_id: local_ifid,
                },
                b: LinkEndpoint {
                    as_id: *remote_isd_as,
                    router_name: remote_router_name.to_string(),
                    interface_id: remote_ifid,
                },
                link_type,
            })
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
            status: None,
        });

        let daemon = sd_map
            .get(&raw_as.isd_as)
            .map(|sd| ScionDaemonInfo {
                id: sd.general.id.clone(),
                address: sd.sd.address,
                api_addr: sd.api.addr,
                status: None,
            })
            .with_context(|| {
                format!(
                    "sd.toml missing for AS {} — cannot determine daemon service name",
                    raw_as.isd_as.0
                )
            })?;

        let mut ehapi_addr = control_service_info.addr;
        ehapi_addr.set_port(EHAPI_BRIDGE_PORT);

        let endhost_api_bridge = EndhostApiBridgeInfo { addr: ehapi_addr };

        ases.insert(
            raw_as.isd_as,
            AsInfo {
                border_routers: raw_as.border_router_info(),
                endhost_api_bridge,
                // address as the control service
                core: raw_as.attributes.contains(&"core".to_string()),
                mtu: raw_as.mtu,
                control_service: ControlServiceInfo {
                    addr: control_service_info.addr,
                    name: control_service_name.clone(),
                    status: None,
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

pub fn load_topology(gen_dir: &Path) -> Result<Topology, String> {
    let pattern = gen_dir
        .join("AS*/topology.json")
        .to_str()
        .ok_or_else(|| {
            format!(
                "Generated directory path contains invalid Unicode: {}",
                gen_dir.display()
            )
        })?
        .to_string();
    let mut hbird_map: HashMap<IsdAsnDef, RawHbirdConfig> = HashMap::new();
    let mut sd_map: HashMap<IsdAsnDef, RawSdConfig> = HashMap::new();
    let raw_ases: Vec<RawAsTopology> = glob::glob(&pattern)
        .map_err(|e| format!("Invalid glob pattern: {e}"))?
        .map(|entry| {
            let path = entry.map_err(|e| e.to_string())?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            let raw_as = serde_json::from_str::<RawAsTopology>(&content)
                .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

            if let Some(dir) = path.parent() {
                let hbird_path = dir.join("hbird.toml");
                if hbird_path.exists() {
                    match std::fs::read_to_string(&hbird_path) {
                        Ok(hbird_content) => {
                            match toml::from_str::<RawHbirdConfig>(&hbird_content) {
                                Ok(hb) => {
                                    hbird_map.insert(raw_as.isd_as, hb);
                                }
                                Err(e) => {
                                    eprintln!("Failed to parse {}: {e}", hbird_path.display());
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to read {}: {e}", hbird_path.display());
                        }
                    }
                }

                // sd.toml is required (unlike hbird.toml which is optional):
                // absence defers to build_topology error; read/parse failure is immediate.
                let sd_path = dir.join("sd.toml");
                if sd_path.exists() {
                    let sd_content = std::fs::read_to_string(&sd_path)
                        .map_err(|e| format!("Failed to read {}: {e}", sd_path.display()))?;
                    let sd = toml::from_str::<RawSdConfig>(&sd_content)
                        .map_err(|e| format!("Failed to parse {}: {e}", sd_path.display()))?;
                    sd_map.insert(raw_as.isd_as, sd);
                }
            }

            Ok(raw_as)
        })
        .collect::<Result<Vec<_>, String>>()?;

    let ifids_path = gen_dir.join("ifids.yml");
    let router_link_config = std::fs::read_to_string(&ifids_path)
        .map_err(|e| format!("Failed to read {}: {e}", ifids_path.display()))?;
    let router_link_config = serde_yaml::from_str::<RawIfidConfig>(&router_link_config)
        .map_err(|e| format!("Failed to parse {}: {e}", ifids_path.display()))?;

    build_topology(raw_ases, hbird_map, sd_map, router_link_config)
        .map_err(|e| format!("Failed to build topology: {e}"))
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
                sd: RawSdSection {
                    address: "127.0.0.1:30255".parse().unwrap(),
                },
                api: RawSdApiSection {
                    addr: "127.0.0.1:30955".parse().unwrap(),
                },
            },
        );
        sd_map.insert(
            ia111,
            RawSdConfig {
                general: RawSdGeneral {
                    id: "sd1-ff00_0_111".to_string(),
                },
                sd: RawSdSection {
                    address: "127.0.0.1:30256".parse().unwrap(),
                },
                api: RawSdApiSection {
                    addr: "127.0.0.1:30956".parse().unwrap(),
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
        assert!(
            msg.contains("sd.toml"),
            "error should mention sd.toml, got: {msg}"
        );
    }
}
