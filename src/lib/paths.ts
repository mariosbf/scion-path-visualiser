import type { TopologyEdge, TopologyNode, InterfaceNodeData } from "./topology";
import type { ScionPath, Topology } from "../bindings";

export interface HighlightedPath {
  edgeIds: string[];
  edgeDirections: Map<string, "forward" | "reverse">;
}

export function mapPathToEdges(
  path: ScionPath,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): HighlightedPath {
  const interfaceNodes = nodes.filter((n) => n.type === "interface");

  function findInterfaceNodeId(
    isdAs: string,
    interfaceId: number,
  ): string | null {
    const node = interfaceNodes.find((n) => {
      const data = n.data as InterfaceNodeData;
      return data.asId === isdAs && data.interfaceId === interfaceId;
    });
    return node?.id ?? null;
  }

  const edgeIds: string[] = [];
  const edgeDirections = new Map<string, "forward" | "reverse">();

  for (let i = 0; i < path.interfaces.length - 1; i += 2) {
    const iface0 = path.interfaces[i];
    const iface1 = path.interfaces[i + 1];

    const nodeId0 = findInterfaceNodeId(iface0.isd_as, iface0.interface_id);
    const nodeId1 = findInterfaceNodeId(iface1.isd_as, iface1.interface_id);

    if (!nodeId0 || !nodeId1) continue;

    const edge = edges.find(
      (e) =>
        (e.source === nodeId0 && e.target === nodeId1) ||
        (e.source === nodeId1 && e.target === nodeId0),
    );

    if (!edge) continue;

    edgeIds.push(edge.id);
    edgeDirections.set(
      edge.id,
      edge.source === nodeId0 ? "forward" : "reverse",
    );
  }

  return { edgeIds, edgeDirections };
}

export function pathHasNetCond(path: ScionPath, topology: Topology): boolean {
  for (const iface of path.interfaces) {
    const asInfo = topology.ases[iface.isd_as];
    if (!asInfo) continue;
    for (const br of asInfo.border_routers) {
      const nc = br.interfaces[iface.interface_id]?.net_cond;
      if (nc?.best_effort || nc?.hbird) return true;
    }
  }
  return false;
}

export interface PathNetStats {
  delay_ms?: number;
  rate_kbps?: number;
  loss_percent?: number;
  duplicate_percent?: number;
  corrupt_percent?: number;
  mtu?: number;
}

export function computePathNetStats(
  path: ScionPath,
  topology: Topology,
  trafficClass: "best_effort" | "hbird",
): PathNetStats {
  let delay = 0;
  let rate = Infinity;
  let lossSurvival = 1;
  let dupFactor = 1;
  let corruptSurvival = 1;
  let mtu = Infinity;

  for (const iface of path.interfaces) {
    const asInfo = topology.ases[iface.isd_as];
    if (!asInfo) continue;
    let nc = null;
    for (const br of asInfo.border_routers) {
      const ifaceInfo = br.interfaces[iface.interface_id];
      if (ifaceInfo) {
        nc = ifaceInfo.net_cond[trafficClass];
        break;
      }
    }
    if (!nc) continue;
    delay += nc.delay_ms ?? 0;
    rate = Math.min(rate, nc.rate_kbps ?? Infinity);
    lossSurvival *= 1 - (nc.loss_percent ?? 0) / 100;
    dupFactor *= 1 + (nc.duplicate_percent ?? 0) / 100;
    corruptSurvival *= 1 - (nc.corrupt_percent ?? 0) / 100;
    mtu = Math.min(mtu, nc.mtu ?? Infinity);
  }

  const undefinedIfDefault = (value: number, defaultValue: number) => {
    if (value === defaultValue) return undefined;
    return value;
  };

  return {
    delay_ms: undefinedIfDefault(delay, 0),
    rate_kbps: undefinedIfDefault(rate, Infinity),
    loss_percent: undefinedIfDefault((1 - lossSurvival) * 100, 0),
    duplicate_percent: undefinedIfDefault((dupFactor - 1) * 100, 0),
    corrupt_percent: undefinedIfDefault((1 - corruptSurvival) * 100, 0),
    mtu: undefinedIfDefault(mtu, Infinity),
  };
}
