use std::path::Path;

pub fn generate_grafana_config(gen_dir: &Path, as_ids: &[String]) -> Result<(), String> {
    let datasources_dir = gen_dir.join("grafana").join("provisioning").join("datasources");
    let dashboards_dir = gen_dir.join("grafana").join("provisioning").join("dashboards");

    std::fs::create_dir_all(&datasources_dir)
        .map_err(|e| format!("Failed to create grafana datasources dir: {e}"))?;
    std::fs::create_dir_all(&dashboards_dir)
        .map_err(|e| format!("Failed to create grafana dashboards dir: {e}"))?;

    std::fs::write(
        datasources_dir.join("datasources.yml"),
        "apiVersion: 1\ndatasources:\n  - name: Prometheus\n    type: prometheus\n    uid: prometheus\n    url: http://localhost:9090\n    isDefault: true\n    editable: true\n  - name: Jaeger\n    type: jaeger\n    uid: jaeger\n    url: http://localhost:16686\n    editable: true\n",
    )
    .map_err(|e| format!("Failed to write datasources.yml: {e}"))?;

    std::fs::write(
        dashboards_dir.join("provider.yml"),
        "apiVersion: 1\nproviders:\n  - name: scion\n    type: file\n    options:\n      path: /etc/grafana/provisioning/dashboards\n",
    )
    .map_err(|e| format!("Failed to write provider.yml: {e}"))?;

    let overview = make_overview_dashboard();
    std::fs::write(
        dashboards_dir.join("overview.json"),
        serde_json::to_string_pretty(&overview).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write overview.json: {e}"))?;

    let mut sorted_ids = as_ids.to_vec();
    sorted_ids.sort();

    for isd_as in &sorted_ids {
        let slug = isd_as.replace(['-', ':'], "_");
        let dashboard = make_as_dashboard(isd_as, &slug);
        let filename = format!("as_{slug}.json");
        std::fs::write(
            dashboards_dir.join(&filename),
            serde_json::to_string_pretty(&dashboard).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("Failed to write {filename}: {e}"))?;
    }

    Ok(())
}

pub fn patch_monitoring_dc(gen_dir: &Path) -> Result<(), String> {
    let dc_path = gen_dir.join("monitoring-dc.yml");
    let content = std::fs::read_to_string(&dc_path)
        .map_err(|e| format!("Failed to read monitoring-dc.yml: {e}"))?;

    let mut doc: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse monitoring-dc.yml: {e}"))?;

    let grafana_key = serde_yaml::Value::String("grafana".to_string());

    let already_present = doc
        .get("services")
        .and_then(|s| s.as_mapping())
        .map(|m| m.contains_key(&grafana_key))
        .unwrap_or(false);

    if already_present {
        return Ok(());
    }

    let prov_path = gen_dir
        .join("grafana")
        .join("provisioning")
        .canonicalize()
        .unwrap_or_else(|_| gen_dir.join("grafana").join("provisioning"));

    let prov_path_str = prov_path
        .to_str()
        .ok_or("provisioning path contains invalid Unicode")?;

    let grafana_yaml = format!(
        "image: grafana/grafana:11.6.1\nnetwork_mode: host\nenvironment:\n- GF_SERVER_HTTP_PORT=3000\nuser: \"0:0\"\nvolumes:\n- {prov_path_str}:/etc/grafana/provisioning:ro\n"
    );

    let grafana_service: serde_yaml::Value = serde_yaml::from_str(&grafana_yaml)
        .map_err(|e| format!("Failed to build grafana service config: {e}"))?;

    let services = doc
        .get_mut("services")
        .ok_or("monitoring-dc.yml missing 'services' key")?
        .as_mapping_mut()
        .ok_or("monitoring-dc.yml 'services' is not a mapping")?;

    services.insert(grafana_key, grafana_service);

    let output = serde_yaml::to_string(&doc)
        .map_err(|e| format!("Failed to serialize monitoring-dc.yml: {e}"))?;

    std::fs::write(&dc_path, output)
        .map_err(|e| format!("Failed to write monitoring-dc.yml: {e}"))?;

    Ok(())
}

fn prom_ds() -> serde_json::Value {
    serde_json::json!({ "type": "prometheus", "uid": "prometheus" })
}

fn make_timeseries_panel(
    id: u32,
    title: &str,
    expr: &str,
    legend: &str,
    h: u32,
    w: u32,
    x: u32,
    y: u32,
) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "type": "timeseries",
        "title": title,
        "gridPos": { "h": h, "w": w, "x": x, "y": y },
        "datasource": prom_ds(),
        "fieldConfig": {
            "defaults": {
                "custom": { "lineWidth": 2 },
                "unit": "pps"
            }
        },
        "targets": [{
            "datasource": prom_ds(),
            "expr": expr,
            "legendFormat": legend
        }]
    })
}

fn make_overview_dashboard() -> serde_json::Value {
    let panels = vec![
        make_timeseries_panel(
            1,
            "Total demotions per AS (all categories)",
            "sum by (isd_as) (\n  rate(router_humm_demoted_freshness_total[1m])\n  + rate(router_humm_demoted_expired_total[1m])\n  + rate(router_humm_demoted_tokenbucket_total[1m])\n)",
            "{{isd_as}}",
            8, 24, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Freshness demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_freshness_total[1m]))",
            "{{isd_as}}",
            8, 8, 0, 8,
        ),
        make_timeseries_panel(
            3,
            "Expired reservation demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_expired_total[1m]))",
            "{{isd_as}}",
            8, 8, 8, 8,
        ),
        make_timeseries_panel(
            4,
            "Token bucket demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_tokenbucket_total[1m]))",
            "{{isd_as}}",
            8, 8, 16, 8,
        ),
    ];

    serde_json::json!({
        "uid": "as-overview",
        "title": "AS Overview — Demotions",
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}

fn make_as_dashboard(isd_as: &str, slug: &str) -> serde_json::Value {
    let uid = format!("as-{slug}");
    let title = format!("AS {isd_as} Demotions");

    let expr = |metric: &str| {
        format!("sum by (interface) (rate({metric}{{isd_as=\"{isd_as}\"}}[1m]))")
    };

    let panels = vec![
        make_timeseries_panel(
            1,
            "Freshness demotions",
            &expr("router_humm_demoted_freshness_total"),
            "interface {{interface}}",
            8, 24, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Expired reservation demotions",
            &expr("router_humm_demoted_expired_total"),
            "interface {{interface}}",
            8, 24, 0, 8,
        ),
        make_timeseries_panel(
            3,
            "Token bucket demotions",
            &expr("router_humm_demoted_tokenbucket_total"),
            "interface {{interface}}",
            8, 24, 0, 16,
        ),
    ];

    serde_json::json!({
        "uid": uid,
        "title": title,
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}
