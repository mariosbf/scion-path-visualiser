import type { Node, Edge } from "@xyflow/react";
import type { Topology } from "../bindings";

export interface IsdNodeData extends Record<string, unknown> {
  label: string;
  isd: string;
}

export interface AsNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  core: boolean;
  mtu: number | null;
}

export interface RouterNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  routerName: string;
  interfaceId: number;
  underlayLocal: string;
  underlayRemote: string;
}

export interface EdgeData extends Record<string, unknown> {
  linkType: "Core" | "Child" | "Peer";
}

export type TopologyNode =
  | Node<IsdNodeData, "isd">
  | Node<AsNodeData, "as">
  | Node<RouterNodeData, "router">;

export type TopologyEdge = Edge<EdgeData>;

export function buildGraph(topology: Topology): {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
} {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // ISD nodes — one per unique ISD number
  const isdIds = new Set(
    Object.keys(topology.ases).map((id) => id.split("-")[0])
  );
  for (const isd of isdIds) {
    nodes.push({
      id: `isd-${isd}`,
      type: "isd",
      data: { label: `ISD ${isd}`, isd },
      position: { x: 0, y: 0 },
    });
  }

  // AS nodes — parented to their ISD node
  for (const [asId, asInfo] of Object.entries(topology.ases)) {
    const isd = asId.split("-")[0];
    nodes.push({
      id: `as-${asId}`,
      type: "as",
      data: {
        label: asId.split("-")[1], // show only AS hex, ISD is the parent node's label
        asId,
        core: asInfo.core,
        mtu: asInfo.mtu,
      },
      parentId: `isd-${isd}`,
      extent: "parent",
      position: { x: 0, y: 0 },
    });
  }

  // Router nodes + edges
  const seenRouters = new Set<string>();

  for (const link of topology.links) {
    for (const ep of [link.a, link.b]) {
      const routerId = `router-${ep.as_id}-${ep.router_name}-${ep.interface_id}`;
      if (!seenRouters.has(routerId)) {
        seenRouters.add(routerId);
        nodes.push({
          id: routerId,
          type: "router",
          data: {
            label: String(ep.interface_id),
            asId: ep.as_id,
            routerName: ep.router_name,
            interfaceId: ep.interface_id,
            underlayLocal: ep.underlay_local,
            underlayRemote: ep.underlay_remote,
          },
          parentId: `as-${ep.as_id}`,
          extent: "parent",
          position: { x: 0, y: 0 },
        });
      }
    }

    edges.push({
      id: `edge-${link.a.as_id}-${link.a.interface_id}-${link.b.as_id}-${link.b.interface_id}`,
      source: `router-${link.a.as_id}-${link.a.router_name}-${link.a.interface_id}`,
      target: `router-${link.b.as_id}-${link.b.router_name}-${link.b.interface_id}`,
      data: { linkType: link.link_type },
    });
  }

  return { nodes, edges };
}
