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

    let queue_depth = make_queue_depth_dashboard();
    std::fs::write(
        dashboards_dir.join("queue-depth.json"),
        serde_json::to_string_pretty(&queue_depth).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write queue-depth.json: {e}"))?;

    let scion_overview = make_scion_overview_dashboard();
    std::fs::write(
        dashboards_dir.join("overview_scion.json"),
        serde_json::to_string_pretty(&scion_overview).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write overview_scion.json: {e}"))?;

    let hummingbird_overview = make_hummingbird_overview_dashboard();
    std::fs::write(
        dashboards_dir.join("overview_hummingbird.json"),
        serde_json::to_string_pretty(&hummingbird_overview).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write overview_hummingbird.json: {e}"))?;

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

        let scion_dashboard = make_scion_as_dashboard(isd_as, &slug);
        let scion_filename = format!("as_{slug}_scion.json");
        std::fs::write(
            dashboards_dir.join(&scion_filename),
            serde_json::to_string_pretty(&scion_dashboard).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("Failed to write {scion_filename}: {e}"))?;

        let hummingbird_dashboard = make_hummingbird_as_dashboard(isd_as, &slug);
        let hummingbird_filename = format!("as_{slug}_hummingbird.json");
        std::fs::write(
            dashboards_dir.join(&hummingbird_filename),
            serde_json::to_string_pretty(&hummingbird_dashboard).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("Failed to write {hummingbird_filename}: {e}"))?;
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

fn external_interface_selector() -> &'static str {
    r#"interface!~"internal|sibling->.*""#
}

fn metric_with_filter(metric: &str, filter: &str) -> String {
    format!("{metric}{{{filter}}}")
}

fn rate_sum(metric: &str, filter: &str, group_by: &str) -> String {
    format!(
        "sum by ({group_by}) (rate({}[1m]))",
        metric_with_filter(metric, filter)
    )
}

fn percent_expr(numerator: &str, denominator: &str, filter: &str, group_by: &str) -> String {
    format!(
        "100 * sum by ({group_by}) (rate({}[1m])) / clamp_min(sum by ({group_by}) (rate({}[1m])), 0.000001)",
        metric_with_filter(numerator, filter),
        metric_with_filter(denominator, filter)
    )
}

fn humm_total_demotions(filter: &str, group_by: &str) -> String {
    format!(
        "sum by ({group_by}) (rate({}[1m]) + rate({}[1m]) + rate({}[1m]))",
        metric_with_filter("router_humm_demoted_freshness_total", filter),
        metric_with_filter("router_humm_demoted_expired_total", filter),
        metric_with_filter("router_humm_demoted_tokenbucket_total", filter)
    )
}

fn humm_accepted_priority(filter: &str, group_by: &str) -> String {
    format!(
        "clamp_min(sum by ({group_by}) (rate({}[1m])) - ({}), 0)",
        metric_with_filter("router_humm_flyover_pkts_total", filter),
        humm_total_demotions(filter, group_by)
    )
}

fn humm_acceptance_ratio(filter: &str, group_by: &str) -> String {
    format!(
        "100 * ({}) / clamp_min(sum by ({group_by}) (rate({}[1m])), 0.000001)",
        humm_accepted_priority(filter, group_by),
        metric_with_filter("router_humm_flyover_pkts_total", filter)
    )
}

fn make_timeseries_panel(
    id: u32,
    title: &str,
    expr: &str,
    legend: &str,
    unit: &str,
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
                "unit": unit
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
    let demotion_pct_overview = concat!(
        "100 * sum by (isd_as) (\n",
        "  rate(router_humm_demoted_freshness_total[1m])\n",
        "  + rate(router_humm_demoted_expired_total[1m])\n",
        "  + rate(router_humm_demoted_tokenbucket_total[1m])\n",
        ") / sum by (isd_as) (rate(router_humm_flyover_pkts_total[1m]))",
    );

    let panels = vec![
        make_timeseries_panel(
            1,
            "Total demotions per AS (all categories)",
            "sum by (isd_as) (\n  rate(router_humm_demoted_freshness_total[1m])\n  + rate(router_humm_demoted_expired_total[1m])\n  + rate(router_humm_demoted_tokenbucket_total[1m])\n)",
            "{{isd_as}}",
            "pps",
            8, 24, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Freshness demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_freshness_total[1m]))",
            "{{isd_as}}",
            "pps",
            8, 8, 0, 8,
        ),
        make_timeseries_panel(
            3,
            "Expired reservation demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_expired_total[1m]))",
            "{{isd_as}}",
            "pps",
            8, 8, 8, 8,
        ),
        make_timeseries_panel(
            4,
            "Token bucket demotions per AS",
            "sum by (isd_as) (rate(router_humm_demoted_tokenbucket_total[1m]))",
            "{{isd_as}}",
            "pps",
            8, 8, 16, 8,
        ),
        make_timeseries_panel(
            5,
            "Demotion rate per AS (% of flyover packets)",
            demotion_pct_overview,
            "{{isd_as}}",
            "percent",
            8, 24, 0, 16,
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

fn make_queue_depth_dashboard() -> serde_json::Value {
    let legend = "{{isd_as}} · {{instance}} · {{interface}}";

    let panels = vec![
        make_timeseries_panel(
            1,
            "Queue depth per border router (priority + best-effort)",
            "sum by (isd_as, instance) (router_queue_depth)",
            "{{isd_as}} · {{instance}}",
            "short",
            8, 24, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Priority queue depth",
            "router_queue_depth{queue=\"priority\"}",
            legend,
            "short",
            8, 24, 0, 8,
        ),
        make_timeseries_panel(
            3,
            "Best-effort queue depth",
            "router_queue_depth{queue=\"best_effort\"}",
            legend,
            "short",
            8, 24, 0, 16,
        ),
    ];

    serde_json::json!({
        "uid": "border-router-queue-depth",
        "title": "Border Router Queue Depth",
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}

fn make_scion_overview_dashboard() -> serde_json::Value {
    let ext = external_interface_selector();

    let panels = vec![
        make_timeseries_panel(
            1,
            "Total SCION ingress by AS",
            &rate_sum("router_input_pkts_total", ext, "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Total SCION egress by AS",
            &rate_sum("router_output_pkts_total", ext, "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 12, 0,
        ),
        make_timeseries_panel(
            3,
            "Ingress bandwidth by AS",
            &format!("8 * {}", rate_sum("router_input_bytes_total", ext, "isd_as")),
            "{{isd_as}}",
            "bps",
            8, 12, 0, 16,
        ),
        make_timeseries_panel(
            4,
            "Egress bandwidth by AS",
            &format!("8 * {}", rate_sum("router_output_bytes_total", ext, "isd_as")),
            "{{isd_as}}",
            "bps",
            8, 12, 12, 16,
        ),
        make_timeseries_panel(
            5,
            "Best-effort SCION packets by AS",
            &format!(
                "clamp_min({} - sum by (isd_as) (rate(router_humm_flyover_pkts_total[1m])), 0)",
                rate_sum("router_input_pkts_total", ext, "isd_as")
            ),
            "{{isd_as}}",
            "pps",
            8, 24, 0, 24,
        ),
        make_timeseries_panel(
            6,
            "Router drops on external SCION traffic by AS",
            &rate_sum("router_dropped_pkts_total", ext, "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 0, 32,
        ),
        make_timeseries_panel(
            7,
            "Drop ratio on external SCION traffic by AS",
            &percent_expr("router_dropped_pkts_total", "router_input_pkts_total", ext, "isd_as"),
            "{{isd_as}}",
            "percent",
            8, 12, 12, 32,
        ),
        make_timeseries_panel(
            8,
            "Up external interfaces by AS",
            &format!("sum by (isd_as) (router_interface_up{{{ext}}})"),
            "{{isd_as}}",
            "none",
            8, 24, 0, 8,
        ),
    ];

    serde_json::json!({
        "uid": "scion-overview",
        "title": "SCION Overview",
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}

fn make_hummingbird_overview_dashboard() -> serde_json::Value {
    let panels = vec![
        make_timeseries_panel(
            1,
            "Hummingbird flyover packets by AS",
            &rate_sum("router_humm_flyover_pkts_total", "", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Accepted priority packets by AS",
            &humm_accepted_priority("", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 12, 0,
        ),
        make_timeseries_panel(
            3,
            "Demoted Hummingbird packets by AS",
            &humm_total_demotions("", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 12, 0, 8,
        ),
        make_timeseries_panel(
            4,
            "Priority acceptance ratio by AS",
            &humm_acceptance_ratio("", "isd_as"),
            "{{isd_as}}",
            "percent",
            8, 12, 12, 8,
        ),
        make_timeseries_panel(
            5,
            "Freshness demotions by AS",
            &rate_sum("router_humm_demoted_freshness_total", "", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 8, 0, 16,
        ),
        make_timeseries_panel(
            6,
            "Expired reservation demotions by AS",
            &rate_sum("router_humm_demoted_expired_total", "", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 8, 8, 16,
        ),
        make_timeseries_panel(
            7,
            "Token bucket demotions by AS",
            &rate_sum("router_humm_demoted_tokenbucket_total", "", "isd_as"),
            "{{isd_as}}",
            "pps",
            8, 8, 16, 16,
        ),
    ];

    serde_json::json!({
        "uid": "hummingbird-overview",
        "title": "Hummingbird Overview",
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

    let demotion_pct_expr = format!(
        concat!(
            "100 * sum by (interface) (\n",
            "  rate(router_humm_demoted_freshness_total{{isd_as=\"{0}\"}}[1m])\n",
            "  + rate(router_humm_demoted_expired_total{{isd_as=\"{0}\"}}[1m])\n",
            "  + rate(router_humm_demoted_tokenbucket_total{{isd_as=\"{0}\"}}[1m])\n",
            ") / sum by (interface) (rate(router_humm_flyover_pkts_total{{isd_as=\"{0}\"}}[1m]))",
        ),
        isd_as,
    );

    let panels = vec![
        make_timeseries_panel(
            1,
            "Freshness demotions",
            &expr("router_humm_demoted_freshness_total"),
            "interface {{interface}}",
            "pps",
            8, 24, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Expired reservation demotions",
            &expr("router_humm_demoted_expired_total"),
            "interface {{interface}}",
            "pps",
            8, 24, 0, 8,
        ),
        make_timeseries_panel(
            3,
            "Token bucket demotions",
            &expr("router_humm_demoted_tokenbucket_total"),
            "interface {{interface}}",
            "pps",
            8, 24, 0, 16,
        ),
        make_timeseries_panel(
            4,
            "Demotion rate (% of flyover packets)",
            &demotion_pct_expr,
            "interface {{interface}}",
            "percent",
            8, 24, 0, 24,
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

fn make_scion_as_dashboard(isd_as: &str, slug: &str) -> serde_json::Value {
    let uid = format!("as-{slug}");
    let title = format!("AS {isd_as} - SCION Traffic");
    let ext = format!(r#"isd_as="{isd_as}",{}"#, external_interface_selector());

    let panels = vec![
        make_timeseries_panel(
            1,
            "Total SCION ingress by interface",
            &rate_sum("router_input_pkts_total", &ext, "interface,neighbor_isd_as"),
            "if {{interface}} -> {{neighbor_isd_as}}",
            "pps",
            8, 12, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Total SCION egress by interface",
            &rate_sum("router_output_pkts_total", &ext, "interface,neighbor_isd_as"),
            "if {{interface}} -> {{neighbor_isd_as}}",
            "pps",
            8, 12, 12, 0,
        ),
        make_timeseries_panel(
            3,
            "Ingress bandwidth by interface",
            &format!(
                "8 * {}",
                rate_sum("router_input_bytes_total", &ext, "interface,neighbor_isd_as")
            ),
            "if {{interface}} -> {{neighbor_isd_as}}",
            "bps",
            8, 12, 0, 8,
        ),
        make_timeseries_panel(
            4,
            "Egress bandwidth by interface",
            &format!(
                "8 * {}",
                rate_sum("router_output_bytes_total", &ext, "interface,neighbor_isd_as")
            ),
            "if {{interface}} -> {{neighbor_isd_as}}",
            "bps",
            8, 12, 12, 8,
        ),
        make_timeseries_panel(
            5,
            "Best-effort SCION packets by interface",
            &format!(
                "clamp_min(sum by (interface) (rate(router_input_pkts_total{{{ext}}}[1m])) - sum by (interface) (rate(router_humm_flyover_pkts_total{{isd_as=\"{isd_as}\"}}[1m])), 0)"
            ),
            "if {{interface}}",
            "pps",
            8, 12, 0, 16,
        ),
        make_timeseries_panel(
            6,
            "Packet size mix on ingress",
            &rate_sum("router_input_pkts_total", &ext, "sizeclass"),
            "{{sizeclass}} bytes",
            "pps",
            8, 12, 12, 16,
        ),
        make_timeseries_panel(
            7,
            "Router drops by interface and reason",
            &rate_sum("router_dropped_pkts_total", &ext, "interface,reason"),
            "if {{interface}} / {{reason}}",
            "pps",
            8, 12, 0, 24,
        ),
        make_timeseries_panel(
            8,
            "Drop ratio by interface",
            &percent_expr(
                "router_dropped_pkts_total",
                "router_input_pkts_total",
                &ext,
                "interface",
            ),
            "if {{interface}}",
            "percent",
            8, 12, 12, 24,
        ),
        make_timeseries_panel(
            9,
            "External interface state",
            &format!("router_interface_up{{{ext}}}"),
            "if {{interface}} -> {{neighbor_isd_as}}",
            "none",
            8, 24, 0, 32,
        ),
    ];

    serde_json::json!({
        "uid": format!("{uid}-scion"),
        "title": title,
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}

fn make_hummingbird_as_dashboard(isd_as: &str, slug: &str) -> serde_json::Value {
    let uid = format!("as-{slug}");
    let title = format!("AS {isd_as} - Hummingbird Traffic");
    let humm = format!(r#"isd_as="{isd_as}""#);

    let panels = vec![
        make_timeseries_panel(
            1,
            "Hummingbird flyover packets by interface",
            &rate_sum("router_humm_flyover_pkts_total", &humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 12, 0, 0,
        ),
        make_timeseries_panel(
            2,
            "Accepted priority packets by interface",
            &humm_accepted_priority(&humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 12, 12, 0,
        ),
        make_timeseries_panel(
            3,
            "Priority acceptance ratio by interface",
            &humm_acceptance_ratio(&humm, "interface"),
            "if {{interface}}",
            "percent",
            8, 12, 0, 8,
        ),
        make_timeseries_panel(
            4,
            "Total demoted Hummingbird packets by interface",
            &humm_total_demotions(&humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 12, 12, 8,
        ),
        make_timeseries_panel(
            5,
            "Freshness demotions",
            &rate_sum("router_humm_demoted_freshness_total", &humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 8, 0, 16,
        ),
        make_timeseries_panel(
            6,
            "Expired reservation demotions",
            &rate_sum("router_humm_demoted_expired_total", &humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 8, 8, 16,
        ),
        make_timeseries_panel(
            7,
            "Token bucket demotions",
            &rate_sum("router_humm_demoted_tokenbucket_total", &humm, "interface"),
            "if {{interface}}",
            "pps",
            8, 8, 16, 16,
        ),
    ];

    serde_json::json!({
        "uid": format!("{uid}-hummingbird"),
        "title": title,
        "schemaVersion": 37,
        "version": 1,
        "refresh": "5s",
        "panels": panels
    })
}
