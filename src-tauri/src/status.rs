use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

use crate::topology::IsdAsnDef;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum ScionService {
    Daemon,
    Hbird,
    Control,
    BorderRouter(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum ServiceState {
    Running,
    Stopped,
    Starting,
    Stopping,
    Exited,
    Fatal,
    Unknown,
    Backoff,
    Paused,
    Restarting,
    Dead,
    Created,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ServiceStatusInfo {
    pub state: ServiceState,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ServiceStatus {
    pub isd_as: IsdAsnDef,
    pub service: ScionService,
    pub state: ServiceState,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ServiceStatusParseError(pub String);

impl fmt::Display for ServiceStatusParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "parse error: {}", self.0)
    }
}

impl FromStr for ServiceState {
    type Err = ServiceStatusParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "RUNNING" => Ok(ServiceState::Running),
            "STOPPED" => Ok(ServiceState::Stopped),
            "STARTING" => Ok(ServiceState::Starting),
            "STOPPING" => Ok(ServiceState::Stopping),
            "EXITED" => Ok(ServiceState::Exited),
            "FATAL" => Ok(ServiceState::Fatal),
            "UNKNOWN" => Ok(ServiceState::Unknown),
            "BACKOFF" => Ok(ServiceState::Backoff),
            "PAUSED" => Ok(ServiceState::Paused),
            "RESTARTING" => Ok(ServiceState::Restarting),
            "DEAD" => Ok(ServiceState::Dead),
            "CREATED" => Ok(ServiceState::Created),
            other => Err(ServiceStatusParseError(format!("unknown state: '{other}'"))),
        }
    }
}

// Returns None for unrecognized entries (caller skips the line).
// Expected format: "as<isd>-<as_underscores>:<svc_name>"
// Lines without ':' (e.g., "dispatcher") are silently skipped.
fn parse_service_name(entry: &str) -> Option<(ScionService, IsdAsnDef)> {
    let (as_part, svc_part) = entry.split_once(':')?;

    // as_part: "as1-ff00_0_110" → strip "as" → "1-ff00_0_110"
    let as_str = as_part.strip_prefix("as")?;
    let (isd, as_hex) = as_str.split_once('-')?;
    let isd_as_str = format!("{isd}-{}", as_hex.replace('_', ":"));
    let isd_as = serde_json::from_str::<IsdAsnDef>(&format!("\"{isd_as_str}\"")).ok()?;

    // svc_part: "br1-ff00_0_110-1", "cs1-ff00_0_110-1", "hbird1-ff00_0_110", "sd1-ff00_0_110"
    let svc = if svc_part.starts_with("br") {
        ScionService::BorderRouter(svc_part.to_string())
    } else if svc_part.starts_with("cs") {
        ScionService::Control
    } else if svc_part.starts_with("sd") {
        ScionService::Daemon
    } else if svc_part.starts_with("hbird") {
        ScionService::Hbird
    } else {
        return None;
    };

    Some((svc, isd_as))
}

pub fn apply_status_update(
    topology: &mut crate::topology::Topology,
    statuses: Vec<ServiceStatus>,
    timestamp: chrono::DateTime<chrono::Utc>,
) {
    for svc in statuses {
        if let Some(as_info) = topology.ases.get_mut(&svc.isd_as) {
            let info = ServiceStatusInfo { state: svc.state, timestamp };
            match svc.service {
                ScionService::Control => {
                    as_info.control_service.status = Some(info);
                }
                ScionService::Daemon => {
                    as_info.daemon.status = Some(info);
                }
                ScionService::Hbird => {
                    if let Some(hbird) = &mut as_info.hummingbird {
                        hbird.status = Some(info);
                    }
                }
                ScionService::BorderRouter(ref router_name) => {
                    if let Some(br) = as_info
                        .border_routers
                        .iter_mut()
                        .find(|br| &br.name == router_name)
                    {
                        br.status = Some(info);
                    }
                }
            }
        }
    }
}

pub fn parse_status(output: &str) -> Result<Vec<ServiceStatus>, ServiceStatusParseError> {
    output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| -> Option<Result<ServiceStatus, ServiceStatusParseError>> {
            let mut fields = line.split_whitespace();
            let name = fields.next()?;
            let state_str = fields.next()?;
            let state = match state_str.parse() {
                Ok(s) => s,
                Err(e) => return Some(Err(e)),
            };
            let (service, isd_as) = parse_service_name(name)?;
            Some(Ok(ServiceStatus { isd_as, service, state }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ia(s: &str) -> IsdAsnDef {
        serde_json::from_str(&format!("\"{s}\"")).unwrap()
    }

    #[test]
    fn real_output_format() {
        let input = "\
as1-ff00_0_110:br1-ff00_0_110-1    RUNNING   pid 1234, uptime 0:00:30
as1-ff00_0_110:cs1-ff00_0_110-1    RUNNING   pid 1235, uptime 0:00:30
as1-ff00_0_110:hbird1-ff00_0_110   STOPPED
as1-ff00_0_110:sd1-ff00_0_110      FATAL     exited too quickly
dispatcher                         RUNNING   pid 1000, uptime 0:00:30";
        let got = parse_status(input).unwrap();
        // dispatcher has no ':' — skipped
        assert_eq!(got.len(), 4);
        assert_eq!(got[0], ServiceStatus {
            isd_as: ia("1-ff00:0:110"),
            service: ScionService::BorderRouter("br1-ff00_0_110-1".into()),
            state: ServiceState::Running,
        });
        assert_eq!(got[1], ServiceStatus {
            isd_as: ia("1-ff00:0:110"),
            service: ScionService::Control,
            state: ServiceState::Running,
        });
        assert_eq!(got[2], ServiceStatus {
            isd_as: ia("1-ff00:0:110"),
            service: ScionService::Hbird,
            state: ServiceState::Stopped,
        });
        assert_eq!(got[3], ServiceStatus {
            isd_as: ia("1-ff00:0:110"),
            service: ScionService::Daemon,
            state: ServiceState::Fatal,
        });
    }

    #[test]
    fn multi_as() {
        let input = "\
as1-ff00_0_110:cs1-ff00_0_110-1    RUNNING
as2-ff00_0_210:cs2-ff00_0_210-1    STOPPED";
        let got = parse_status(input).unwrap();
        assert_eq!(got[0].isd_as, ia("1-ff00:0:110"));
        assert_eq!(got[1].isd_as, ia("2-ff00:0:210"));
    }

    #[test]
    fn dispatcher_skipped() {
        let input = "dispatcher    RUNNING   pid 100, uptime 0:01:00";
        assert_eq!(parse_status(input).unwrap().len(), 0);
    }

    #[test]
    fn empty_lines_ignored() {
        let input = "\n  \nas1-ff00_0_110:cs1-ff00_0_110-1    RUNNING\n\n";
        assert_eq!(parse_status(input).unwrap().len(), 1);
    }

    #[test]
    fn unknown_state_errors() {
        let input = "as1-ff00_0_110:cs1-ff00_0_110-1    BOGUS";
        assert!(parse_status(input).is_err());
    }
}
