#!/usr/bin/env bash
# netcond.sh — Per-link network condition control for SCION docker topology.
#
# Uses nsenter to apply tc-netem in each BR container's network namespace from
# the host, so iproute2 need not be installed inside the container image.
# Requires root (sudo) for nsenter.
#
# When netem conditions are set, a 2-band prio qdisc is installed as root.
# Hummingbird priority packets (DSCP EF, TOS 0xb8) are directed to band 1 and
# bypass netem entirely; all other traffic (best-effort) goes to band 2 where
# the netem conditions are applied.
#
# Usage:
#   ./netcond.sh links
#   ./netcond.sh set   <br-name> <ifid> [delay <ms>] [loss <%>] [rate <kbps>] [dup <%>] [corrupt <%>] [reorder <%>] [mtu <bytes>]
#   ./netcond.sh clear <br-name> <ifid>
#   ./netcond.sh clear-all
#   ./netcond.sh status
#
# Examples:
#   ./netcond.sh set br1-ff00_0_110-1 1 delay 50 loss 1
#   ./netcond.sh set br1-ff00_0_111-1 41 delay 50          # other side same link
#   ./netcond.sh clear br1-ff00_0_110-1 1
#   ./netcond.sh status

set -euo pipefail

COMPOSE_PROJECT="${COMPOSE_PROJECT:-scion}"
GEN_DIR="${GEN_DIR:-$(cd "$(dirname "$0")" && pwd)/gen}"

# ── helpers ────────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
    [[ $EUID -eq 0 ]] || die "This command requires root. Run with sudo."
}

# Normalize an underlay address (IPv4 or IPv6) to a plain IP address.
# Input forms:  "1.2.3.4:port"  or  "[::1]:port"
normalize_ip() {
    local addr="$1"
    if [[ "$addr" =~ ^\[(.+)\]:[0-9]+$ ]]; then
        echo "${BASH_REMATCH[1]}"          # IPv6
    else
        echo "${addr%:*}"                  # IPv4
    fi
}

# Return the container name for a given BR service name.
get_container() {
    local service="$1"
    docker ps \
        --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
        --filter "label=com.docker.compose.service=${service}" \
        --format "{{.Names}}" | head -1
}

# Return the PID of a running container (needed for nsenter).
get_pid() {
    docker inspect --format '{{.State.Pid}}' "$1"
}

# Find the interface name inside a network namespace that holds a given IP.
# Use `ip addr show to <addr>` so the kernel handles IPv6 canonicalization —
# avoids awk string-match failures when :: vs 0:0:0 forms differ.
find_iface_by_ip() {
    local pid="$1"
    local ip="$2"
    nsenter -t "$pid" -n ip -o addr show to "$ip" \
        | awk 'NR==1 { print $2; exit }'
}

# Parse all topology.json files; print TSV: br ifid local_addr remote_addr peer_isd_as link_to
list_all_interfaces() {
    for topo in "$GEN_DIR"/AS*/topology.json; do
        jq -r '
            .border_routers | to_entries[] |
            .key as $br |
            .value.interfaces | to_entries[] |
            [$br, .key,
             .value.underlay.local,
             .value.underlay.remote,
             .value.isd_as,
             .value.link_to] | @tsv
        ' "$topo"
    done
}

# Return the local underlay address for <br> interface <ifid>.
get_local_addr() {
    local br="$1" ifid="$2"
    for topo in "$GEN_DIR"/AS*/topology.json; do
        local result
        result=$(jq -r --arg br "$br" --arg ifid "$ifid" \
            '.border_routers[$br].interfaces[$ifid].underlay.local // empty' \
            "$topo")
        if [[ -n "$result" ]]; then echo "$result"; return; fi
    done
    die "Interface $ifid not found for BR $br"
}

# ── commands ───────────────────────────────────────────────────────────────────

cmd_links() {
    printf "%-30s  %-5s  %-32s  %-32s  %-20s  %s\n" \
        "BR" "IFID" "LOCAL" "REMOTE" "PEER_AS" "LINK_TYPE"
    printf "%-30s  %-5s  %-32s  %-32s  %-20s  %s\n" \
        "$(printf '%0.s-' {1..30})" "-----" \
        "$(printf '%0.s-' {1..32})" "$(printf '%0.s-' {1..32})" \
        "$(printf '%0.s-' {1..20})" "--------"
    list_all_interfaces \
        | sort -k1,1 -k2,2n \
        | while IFS=$'\t' read -r br ifid local remote peer_as link_to; do
            printf "%-30s  %-5s  %-32s  %-32s  %-20s  %s\n" \
                "$br" "$ifid" "$local" "$remote" "$peer_as" "$link_to"
        done
}

cmd_set() {
    require_root
    [[ $# -ge 3 ]] || { usage; exit 1; }
    local br="$1" ifid="$2"; shift 2

    # Parse netem parameters, MTU, and traffic selector
    local netem_args=()
    local mtu_val=""
    local traffic="be"   # be | hbird | all
    while [[ $# -gt 0 ]]; do
        case "$1" in
            traffic) traffic="$2"
                     [[ "$traffic" == "be" || "$traffic" == "hbird" || "$traffic" == "all" ]] \
                         || die "traffic must be one of: be, hbird, all"
                     shift 2 ;;
            delay)   netem_args+=("delay" "${2}ms");          shift 2 ;;
            loss)    netem_args+=("loss" "${2}%");            shift 2 ;;
            rate)    netem_args+=("rate" "${2}kbit");         shift 2 ;;
            dup|duplicate) netem_args+=("duplicate" "${2}%"); shift 2 ;;
            corrupt) netem_args+=("corrupt" "${2}%");         shift 2 ;;
            reorder) netem_args+=("reorder" "${2}%");         shift 2 ;;
            mtu)     mtu_val="$2"
                     [[ "$mtu_val" -ge 1280 ]] || die "MTU must be >= 1280 (IPv6 minimum; lower values remove IPv6 addresses from the interface)"
                     shift 2 ;;
            *) die "Unknown parameter: $1" ;;
        esac
    done
    [[ ${#netem_args[@]} -gt 0 || -n "$mtu_val" ]] || die "No conditions specified."

    local addr ip container pid iface
    addr=$(get_local_addr "$br" "$ifid")
    ip=$(normalize_ip "$addr")

    container=$(get_container "$br")
    [[ -n "$container" ]] || die "Container for $br not found. Is SCION running?"

    pid=$(get_pid "$container")
    [[ "$pid" -gt 0 ]] 2>/dev/null || die "Container $container is not running."

    iface=$(find_iface_by_ip "$pid" "$ip")
    [[ -n "$iface" ]] || die "No interface with IP $ip found in $container."

    echo "→ $container : $iface  (BR $br ifid $ifid, local $addr)"

    if [[ ${#netem_args[@]} -gt 0 ]]; then
        echo "  tc netem (traffic=$traffic): ${netem_args[*]}"

        # Ensure the 2-band prio structure exists regardless of traffic selector.
        # del root only when no prio qdisc is present yet; otherwise a second set call
        # would wipe the first band's netem.
        if ! nsenter -t "$pid" -n tc qdisc show dev "$iface" 2>/dev/null | grep -q 'qdisc prio 1:'; then
            nsenter -t "$pid" -n tc qdisc del dev "$iface" root 2>/dev/null || true
            nsenter -t "$pid" -n tc qdisc add dev "$iface" root handle 1: prio \
                bands 2 priomap 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1
            # IPv4: DSCP EF (TOS 0xb8, mask 0xfc) → band 1
            nsenter -t "$pid" -n tc filter add dev "$iface" parent 1:0 \
                protocol ip prio 1 u32 match ip tos 0xb8 0xfc flowid 1:1
            # IPv6: DSCP EF in Traffic Class → band 1
            nsenter -t "$pid" -n tc filter add dev "$iface" parent 1:0 \
                protocol ipv6 prio 2 u32 \
                match u8 0x0b 0x0f at 0 \
                match u8 0x80 0xc0 at 1 \
                flowid 1:1
        fi
        # Apply netem to the target band(s).
        if [[ "$traffic" == "hbird" || "$traffic" == "all" ]]; then
            nsenter -t "$pid" -n tc qdisc replace dev "$iface" parent 1:1 handle 10: netem "${netem_args[@]}"
        fi
        if [[ "$traffic" == "be" || "$traffic" == "all" ]]; then
            nsenter -t "$pid" -n tc qdisc replace dev "$iface" parent 1:2 handle 20: netem "${netem_args[@]}"
        fi
    fi

    if [[ -n "$mtu_val" ]]; then
        echo "  ip link set dev $iface mtu $mtu_val"
        nsenter -t "$pid" -n ip link set dev "$iface" mtu "$mtu_val"
    fi

    echo "  Done."
}

cmd_clear() {
    require_root
    [[ $# -eq 2 ]] || { usage; exit 1; }
    local br="$1" ifid="$2"

    local addr ip container pid iface
    addr=$(get_local_addr "$br" "$ifid")
    ip=$(normalize_ip "$addr")

    container=$(get_container "$br")
    [[ -n "$container" ]] || die "Container for $br not found."

    pid=$(get_pid "$container")
    iface=$(find_iface_by_ip "$pid" "$ip")
    [[ -n "$iface" ]] || die "No interface with IP $ip found in $container."

    if nsenter -t "$pid" -n tc qdisc del dev "$iface" root 2>/dev/null; then
        echo "Cleared tc on $br ifid $ifid ($iface in $container)"
    else
        echo "Nothing to clear on $br ifid $ifid"
    fi

    nsenter -t "$pid" -n ip link set dev "$iface" mtu 1500
    echo "Reset MTU to 1500 on $iface in $container"
}

cmd_clear_all() {
    require_root
    list_all_interfaces \
        | while IFS=$'\t' read -r br ifid local _ _ _; do
            local container pid iface ip
            container=$(get_container "$br") || continue
            [[ -n "$container" ]] || continue
            pid=$(get_pid "$container") || continue
            ip=$(normalize_ip "$local")
            iface=$(find_iface_by_ip "$pid" "$ip") || continue
            [[ -n "$iface" ]] || continue
            if nsenter -t "$pid" -n tc qdisc del dev "$iface" root 2>/dev/null; then
                echo "Cleared tc on $br ifid $ifid ($iface)"
            fi
            nsenter -t "$pid" -n ip link set dev "$iface" mtu 1500 2>/dev/null || true
        done
}

cmd_status() {
    local found=0
    while IFS=$'\t' read -r br ifid local _ peer_as _; do
        local container pid iface ip
        container=$(get_container "$br" 2>/dev/null) || continue
        [[ -n "$container" ]] || continue
        pid=$(get_pid "$container" 2>/dev/null) || continue
        [[ "$pid" -gt 0 ]] 2>/dev/null || continue
        ip=$(normalize_ip "$local")
        iface=$(find_iface_by_ip "$pid" "$ip" 2>/dev/null) || continue
        [[ -n "$iface" ]] || continue

        local netem_line
        netem_line=$(nsenter -t "$pid" -n tc qdisc show dev "$iface" 2>/dev/null \
            | grep 'netem ' || true)
        if [[ -n "$netem_line" ]]; then
            printf "%-30s  ifid %-5s  → %-20s  %s: %s\n" \
                "$br" "$ifid" "$peer_as" "$iface" "$netem_line"
            found=1
        fi
    done < <(list_all_interfaces | sort -k1,1 -k2,2n)
    [[ $found -eq 1 ]] || echo "No active network conditions."
}

# ── dispatch ───────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage:
  $0 links                                         List all BR inter-AS interfaces
  $0 set   <br> <ifid> [traffic be|hbird|all]      Set link conditions.
                       [delay <ms>] [loss <%>]     traffic: which packets are affected
                       [rate <kbps>] [dup <%>]       be    — best-effort only (default)
                       [corrupt <%>] [reorder <%>]   hbird — Hummingbird priority only
                       [mtu <bytes>]                 all   — all traffic (flat netem)
  $0 clear <br> <ifid>                             Clear conditions on one link
  $0 clear-all                                     Clear all conditions
  $0 status                                        Show active netem conditions

Examples:
  $0 links
  sudo $0 set   br1-ff00_0_110-1 1 loss 10                      # BE only (default)
  sudo $0 set   br1-ff00_0_110-1 1 traffic hbird loss 5         # hbird priority only
  sudo $0 set   br1-ff00_0_110-1 1 traffic all  delay 50 loss 1 # all traffic
  sudo $0 set   br1-ff00_0_110-1 1 delay 100 rate 10000
  sudo $0 clear br1-ff00_0_110-1 1
  sudo $0 status
EOF
}

case "${1:-}" in
    links)     cmd_links ;;
    set)       shift; cmd_set "$@" ;;
    clear-all) cmd_clear_all ;;
    clear)     shift; cmd_clear "$@" ;;
    status)    cmd_status ;;
    *)         usage; exit 1 ;;
esac
