use std::collections::HashMap;
use scion_proto::address::IsdAsn;
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

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
