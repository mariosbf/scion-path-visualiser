import type { Node, Edge } from "@xyflow/react";
import type { Link, Topology } from "../bindings";

export interface IsdNodeData extends Record<string, unknown> {
  label: string;
  isd: string;
}

export interface AsNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  core: boolean;
}

export interface InterfaceNodeData extends Record<string, unknown> {
  label: string;
  asId: string;
  interfaceId: number;
  handleSide?: "top" | "bottom" | "left" | "right";
}

export interface EdgeData extends Record<string, unknown> {
  linkType: "Core" | "Child" | "Peer";
  link: Link;
}

export type TopologyNode =
  | Node<IsdNodeData, "isd">
  | Node<AsNodeData, "as">
  | Node<InterfaceNodeData, "interface">;

export type TopologyEdge = Edge<EdgeData>;

export function buildGraph(topology: Topology): {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
} {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // ISD nodes — one per unique ISD number
  const isdIds = [...new Set(
    Object.keys(topology.ases).map((id) => id.split("-")[0]),
  )].sort();
  for (const isd of isdIds) {
    nodes.push({
      id: `isd-${isd}`,
      type: "isd",
      data: { label: `ISD ${isd}`, isd },
      position: { x: 0, y: 0 },
    });
  }

  // AS nodes — parented to their ISD node
  for (const [asId, asInfo] of Object.entries(topology.ases).sort(([a], [b]) => a.localeCompare(b))) {
    const isd = asId.split("-")[0];
    nodes.push({
      id: `as-${asId}`,
      type: "as",
      data: {
        label: asId.split("-")[1],
        asId,
        core: asInfo.core,
      },
      parentId: `isd-${isd}`,
      extent: "parent",
      position: { x: 0, y: 0 },
    });
  }

  // Interface nodes + edges
  const seenInterfaces = new Set<string>();

  for (const link of topology.links) {
    for (const ep of [link.a, link.b]) {
      const interfaceNodeId = `router-${ep.as_id}-${ep.router_name}-${ep.interface_id}`;
      if (!seenInterfaces.has(interfaceNodeId)) {
        seenInterfaces.add(interfaceNodeId);
        nodes.push({
          id: interfaceNodeId,
          type: "interface",
          data: {
            label: String(ep.interface_id),
            asId: ep.as_id,
            interfaceId: ep.interface_id,
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
      data: { linkType: link.link_type, link },
    });
  }

  return { nodes, edges };
}
