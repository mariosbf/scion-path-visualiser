import Dagre from "@dagrejs/dagre";
import type { TopologyNode, TopologyEdge, AsNodeData, RouterNodeData } from "./topology";
import type { Node } from "@xyflow/react";

const ROUTER_SIZE = 24;
const AS_HEIGHT = 120;
const AS_MIN_WIDTH = 160;
const AS_ROUTER_SPACING = 40;
const AS_PADDING_X = 20;
const ISD_PADDING = 40;
const ISD_GAP = 80;
const RANK_SEP = 100;
const NODE_SEP = 60;

function asWidth(routerCount: number): number {
  return Math.max(AS_MIN_WIDTH, routerCount * AS_ROUTER_SPACING + AS_PADDING_X * 2);
}

export function layoutGraph(
  nodes: TopologyNode[],
  edges: TopologyEdge[]
): TopologyNode[] {
  const isdNodes = nodes.filter((n) => n.type === "isd");
  const asNodes = nodes.filter((n) => n.type === "as") as Node<AsNodeData, "as">[];
  const routerNodes = nodes.filter((n) => n.type === "router") as Node<RouterNodeData, "router">[];

  // Map router id -> parent AS id
  const routerToAs = new Map<string, string>();
  for (const rn of routerNodes) {
    if (rn.parentId) routerToAs.set(rn.id, rn.parentId);
  }

  // Group routers by parent AS id
  const routersByAs = new Map<string, Node<RouterNodeData, "router">[]>();
  for (const rn of routerNodes) {
    if (!rn.parentId) continue;
    const list = routersByAs.get(rn.parentId) ?? [];
    list.push(rn);
    routersByAs.set(rn.parentId, list);
  }

  // AS node dimensions keyed by AS node id
  const asDims = new Map<string, { width: number; height: number }>();
  for (const asNode of asNodes) {
    const count = routersByAs.get(asNode.id)?.length ?? 0;
    asDims.set(asNode.id, { width: asWidth(count), height: AS_HEIGHT });
  }

  // Dagre layout per ISD; collect AS positions relative to ISD top-left
  const asPositions = new Map<string, { x: number; y: number }>();
  const isdSizes = new Map<string, { width: number; height: number }>();

  for (const isdNode of isdNodes) {
    const children = asNodes.filter((n) => n.parentId === isdNode.id);
    if (children.length === 0) {
      isdSizes.set(isdNode.id, { width: AS_MIN_WIDTH + ISD_PADDING * 2, height: AS_HEIGHT + ISD_PADDING * 2 });
      continue;
    }

    const g = new Dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });
    g.setDefaultEdgeLabel(() => ({}));

    const childIds = new Set(children.map((n) => n.id));
    for (const asNode of children) {
      const dim = asDims.get(asNode.id)!;
      g.setNode(asNode.id, { width: dim.width, height: dim.height });
    }

    // Child edges drive the rank hierarchy
    for (const edge of edges) {
      if (edge.data?.linkType !== "Child") continue;
      const srcAs = routerToAs.get(edge.source);
      const tgtAs = routerToAs.get(edge.target);
      if (srcAs && tgtAs && childIds.has(srcAs) && childIds.has(tgtAs)) {
        // Avoid duplicate edges in dagre
        if (!g.hasEdge(srcAs, tgtAs)) g.setEdge(srcAs, tgtAs);
      }
    }

    Dagre.layout(g);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const asNode of children) {
      const p = g.node(asNode.id);
      const dim = asDims.get(asNode.id)!;
      const x = p.x - dim.width / 2;
      const y = p.y - dim.height / 2;
      asPositions.set(asNode.id, { x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + dim.width);
      maxY = Math.max(maxY, y + dim.height);
    }

    // Shift so top-left of content = (ISD_PADDING, ISD_PADDING)
    for (const asNode of children) {
      const p = asPositions.get(asNode.id)!;
      asPositions.set(asNode.id, {
        x: p.x - minX + ISD_PADDING,
        y: p.y - minY + ISD_PADDING,
      });
    }

    isdSizes.set(isdNode.id, {
      width: maxX - minX + ISD_PADDING * 2,
      height: maxY - minY + ISD_PADDING * 2,
    });
  }

  // Position ISD nodes side by side
  let curX = 0;
  const isdPositions = new Map<string, { x: number; y: number }>();
  for (const isdNode of isdNodes) {
    isdPositions.set(isdNode.id, { x: curX, y: 0 });
    curX += (isdSizes.get(isdNode.id)?.width ?? 0) + ISD_GAP;
  }

  // Apply positions to all nodes
  return nodes.map((node) => {
    if (node.type === "isd") {
      const size = isdSizes.get(node.id) ?? { width: 200, height: 200 };
      return { ...node, position: isdPositions.get(node.id) ?? { x: 0, y: 0 }, style: size };
    }

    if (node.type === "as") {
      const dim = asDims.get(node.id) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      return { ...node, position: asPositions.get(node.id) ?? { x: 0, y: 0 }, style: dim };
    }

    if (node.type === "router") {
      const asId = node.parentId!;
      const dim = asDims.get(asId) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      const siblings = routersByAs.get(asId) ?? [];
      const idx = siblings.findIndex((r) => r.id === node.id);
      const count = siblings.length;
      const spacing = dim.width / (count + 1);
      return {
        ...node,
        position: {
          x: spacing * (idx + 1) - ROUTER_SIZE / 2,
          y: dim.height - ROUTER_SIZE - 4,
        },
        style: { width: ROUTER_SIZE, height: ROUTER_SIZE, borderRadius: "50%" },
      };
    }

    return node;
  });
}
