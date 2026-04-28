use scion_proto::address::IsdAsn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub underlay_local: String,
    pub underlay_remote: String,
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
}

#[derive(Debug, Deserialize)]
pub struct RawBorderRouter {
    pub interfaces: HashMap<String, RawInterface>,
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
    pub local: String,
    pub remote: String,
}

pub fn build_topology(raw_ases: Vec<RawAsTopology>) -> Topology {
    let ases: HashMap<IsdAsnDef, AsInfo> = raw_ases
        .iter()
        .map(|r| {
            (
                r.isd_as,
                AsInfo {
                    core: r.attributes.contains(&"core".to_string()),
                    mtu: r.mtu,
                },
            )
        })
        .collect();

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
                            ri.underlay.local.clone(),
                            ri.underlay.remote.clone(),
                        )
                    })
                } else {
                    // Core/child/parent: find remote interface pointing back to local_as
                    iface_index
                        .iter()
                        .find(|(key, (_, ri))| key.0 == remote_as && ri.isd_as == local_as)
                        .map(|(key, (rn, ri))| {
                            (
                                rn.clone(),
                                key.1,
                                ri.underlay.local.clone(),
                                ri.underlay.remote.clone(),
                            )
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
                        underlay_local: iface.underlay.local.clone(),
                        underlay_remote: iface.underlay.remote.clone(),
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

    Topology { ases, links }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fixture() -> Vec<RawAsTopology> {
        let json_110 = r#"{
            "attributes": ["core"],
            "isd_as": "1-ff00:0:110",
            "mtu": 1472,
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
        let topo = build_topology(make_fixture());
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
        let topo = build_topology(make_fixture());
        assert_eq!(topo.links.len(), 1);
    }

    #[test]
    fn build_topology_child_link_endpoints() {
        let topo = build_topology(make_fixture());
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
}
