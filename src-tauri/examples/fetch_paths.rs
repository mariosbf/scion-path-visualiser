use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use endhost_api_client::client::CrpcEndhostApiClient;
use scion_proto::address::IsdAsn;
use scion_sdk_reqwest_connect_rpc::token_source::static_token::StaticTokenSource;
use scion_stack::path::fetcher::{traits::PathFetcher, EndhostApiSegmentFetcher, PathFetcherImpl};
use serde::Deserialize;

#[derive(Deserialize)]
struct AsConfig {
    endhost_api_bridge: std::net::SocketAddr,
    endhost_api_bridge_token: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // reqwest (used by the endhost API client) needs a rustls crypto provider.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    // Usage: fetch_paths <as-config.json> <src-as> <dst-as>
    let args: Vec<String> = std::env::args().collect();
    let [_, config_path, src, dst] = args.as_slice() else {
        anyhow::bail!("usage: fetch_paths <as-config.json> <src-as> <dst-as>");
    };

    let configs: HashMap<String, AsConfig> =
        serde_json::from_str(&std::fs::read_to_string(config_path)?)?;
    let src_cfg = configs
        .get(src)
        .ok_or_else(|| anyhow::anyhow!("AS {src} not in config"))?;
    let src_as: IsdAsn = src.parse()?;
    let dst_as: IsdAsn = dst.parse()?;

    // Connect to the source AS's endhost API bridge, authenticating with its token.
    let url = url::Url::parse(&format!("http://{}", src_cfg.endhost_api_bridge))?;
    let mut client = CrpcEndhostApiClient::new(&url)?;
    client.use_token_source(Arc::new(StaticTokenSource::from(
        src_cfg.endhost_api_bridge_token.clone(),
    )));

    // Fetch path segments through the bridge and combine them into end-to-end paths.
    let fetcher = PathFetcherImpl::new(
        vec![(
            "endhost-api".to_string(),
            Box::new(EndhostApiSegmentFetcher::new(Arc::new(client))),
        )],
        Duration::from_secs(10),
    );
    let paths = fetcher.fetch_paths(src_as, dst_as).await?;

    println!("{} path(s) from {src_as} to {dst_as}:", paths.len());
    for path in paths {
        let Some(meta) = path.metadata else { continue };
        let hops: Vec<String> = meta
            .interfaces
            .unwrap_or_default()
            .iter()
            .map(|i| format!("{}#{}", i.isd_asn, i.id))
            .collect();
        println!("  [mtu {}, expires {}] {}", meta.mtu, meta.expiration, hops.join(" > "));
    }
    Ok(())
}
