import Dagre from "@dagrejs/dagre";
import type { TopologyNode, TopologyEdge, AsNodeData, InterfaceNodeData } from "./topology";
import type { Node } from "@xyflow/react";

const INTERFACE_NODE_SIZE = 24;
const AS_HEIGHT = 120;
const AS_MIN_WIDTH = 160;
const AS_PADDING_X = 20;
const ISD_PADDING = 40;
const ISD_GAP = 80;
const RANK_SEP = 100;
const NODE_SEP = 60;
const INTERFACE_NODE_MARGIN = 4;

type Side = "top" | "bottom" | "left" | "right";

function asWidth(interfaceCount: number): number {
  return Math.max(AS_MIN_WIDTH, interfaceCount * (INTERFACE_NODE_SIZE + 16) + AS_PADDING_X * 2);
}

export function layoutGraph(
  nodes: TopologyNode[],
  edges: TopologyEdge[]
): TopologyNode[] {
  const isdNodes = nodes.filter((n) => n.type === "isd").sort((a, b) => a.id.localeCompare(b.id));
  const asNodes = (nodes.filter((n) => n.type === "as") as Node<AsNodeData, "as">[]).sort((a, b) => a.id.localeCompare(b.id));
  const interfaceNodes = (nodes.filter((n) => n.type === "interface") as Node<InterfaceNodeData, "interface">[]).sort((a, b) => a.id.localeCompare(b.id));

  // Map interface node id -> parent AS id
  const interfaceToAs = new Map<string, string>();
  for (const iNode of interfaceNodes) {
    if (iNode.parentId) interfaceToAs.set(iNode.id, iNode.parentId);
  }

  // Group interfaces by parent AS id
  const interfacesByAs = new Map<string, Node<InterfaceNodeData, "interface">[]>();
  for (const iNode of interfaceNodes) {
    if (!iNode.parentId) continue;
    const list = interfacesByAs.get(iNode.parentId) ?? [];
    list.push(iNode);
    interfacesByAs.set(iNode.parentId, list);
  }

  // AS node dimensions keyed by AS node id
  const asDims = new Map<string, { width: number; height: number }>();
  for (const asNode of asNodes) {
    const count = interfacesByAs.get(asNode.id)?.length ?? 0;
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
      const dim = asDims.get(asNode.id) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      g.setNode(asNode.id, {
        width: dim.width,
        height: dim.height,
        ...(asNode.data.core ? { rank: "min" } : {}),
      });
    }

    // Child edges drive the rank hierarchy
    for (const edge of edges) {
      if (edge.data?.linkType !== "Child") continue;
      const srcAs = interfaceToAs.get(edge.source);
      const tgtAs = interfaceToAs.get(edge.target);
      if (srcAs && tgtAs && childIds.has(srcAs) && childIds.has(tgtAs)) {
        if (!g.hasEdge(srcAs, tgtAs)) g.setEdge(srcAs, tgtAs);
      }
    }

    Dagre.layout(g);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const asNode of children) {
      const p = g.node(asNode.id);
      const dim = asDims.get(asNode.id) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
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
      const p = asPositions.get(asNode.id);
      if (!p) continue;
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

  // Build asId -> parentIsdId lookup for absolute position computation
  const asToIsd = new Map<string, string>();
  for (const asNode of asNodes) {
    if (asNode.parentId) asToIsd.set(asNode.id, asNode.parentId);
  }

  function absoluteAsCenter(asId: string): { x: number; y: number } {
    const isdId = asToIsd.get(asId);
    const isdPos = isdId ? (isdPositions.get(isdId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const asPos = asPositions.get(asId) ?? { x: 0, y: 0 };
    const dim = asDims.get(asId) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
    return {
      x: isdPos.x + asPos.x + dim.width / 2,
      y: isdPos.y + asPos.y + dim.height / 2,
    };
  }

  // Compute dominant side for each interface node based on direction to its peer ASes
  const interfaceSide = new Map<string, Side>();

  for (const iNode of interfaceNodes) {
    const myAsId = iNode.parentId;
    if (!myAsId) { interfaceSide.set(iNode.id, "bottom"); continue; }

    const myCenter = absoluteAsCenter(myAsId);
    let dx = 0, dy = 0, count = 0;

    for (const edge of edges) {
      let peerId: string | null = null;
      if (edge.source === iNode.id) peerId = edge.target;
      else if (edge.target === iNode.id) peerId = edge.source;
      if (!peerId) continue;

      const peerAsId = interfaceToAs.get(peerId);
      if (!peerAsId || peerAsId === myAsId) continue;

      const peerCenter = absoluteAsCenter(peerAsId);
      dx += peerCenter.x - myCenter.x;
      dy += peerCenter.y - myCenter.y;
      count++;
    }

    let side: Side;
    if (count === 0) {
      side = "bottom";
    } else if (Math.abs(dx) > Math.abs(dy)) {
      side = dx > 0 ? "right" : "left";
    } else {
      side = dy > 0 ? "bottom" : "top";
    }

    interfaceSide.set(iNode.id, side);
  }

  // Group interface nodes by (asId, side) and sort for stable ordering
  const interfacesByAsAndSide = new Map<string, Map<Side, string[]>>();
  for (const iNode of interfaceNodes) {
    if (!iNode.parentId) continue;
    if (!interfacesByAsAndSide.has(iNode.parentId)) {
      interfacesByAsAndSide.set(iNode.parentId, new Map());
    }
    const sideMap = interfacesByAsAndSide.get(iNode.parentId)!;
    const side = interfaceSide.get(iNode.id) ?? "bottom";
    const existing = sideMap.get(side) ?? [];
    existing.push(iNode.id);
    sideMap.set(side, existing);
  }
  // Sort interface nodes within each side group by their peer AS position to avoid crossings:
  // interfaces connecting left/up sit left/up; interfaces connecting right/down sit right/down.
  for (const [asId, sideMap] of interfacesByAsAndSide.entries()) {
    for (const [side, ids] of sideMap) {
      const peerCenter = (interfaceNodeId: string): { x: number; y: number } => {
        let sx = 0, sy = 0, count = 0;
        for (const edge of edges) {
          const peerId = edge.source === interfaceNodeId ? edge.target
            : edge.target === interfaceNodeId ? edge.source
            : null;
          if (!peerId) continue;
          const peerAsId = interfaceToAs.get(peerId);
          if (!peerAsId || peerAsId === asId) continue;
          const c = absoluteAsCenter(peerAsId);
          sx += c.x; sy += c.y; count++;
        }
        return count > 0 ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
      };

      sideMap.set(side, [...ids].sort((a, b) => {
        const ca = peerCenter(a);
        const cb = peerCenter(b);
        const primary = (side === "top" || side === "bottom") ? ca.x - cb.x : ca.y - cb.y;
        return primary !== 0 ? primary : a.localeCompare(b);
      }));
    }
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

    if (node.type === "interface") {
      const asId = node.parentId;
      if (!asId) return node;
      const dim = asDims.get(asId) ?? { width: AS_MIN_WIDTH, height: AS_HEIGHT };
      const side = interfaceSide.get(node.id) ?? "bottom";
      const sideGroup = interfacesByAsAndSide.get(asId)?.get(side) ?? [node.id];
      const idx = sideGroup.indexOf(node.id);
      const count = sideGroup.length;

      let x: number, y: number;
      if (side === "top" || side === "bottom") {
        const spacing = dim.width / (count + 1);
        x = spacing * (idx + 1) - INTERFACE_NODE_SIZE / 2;
        y = side === "top" ? INTERFACE_NODE_MARGIN : dim.height - INTERFACE_NODE_SIZE - INTERFACE_NODE_MARGIN;
      } else {
        const spacing = dim.height / (count + 1);
        x = side === "left" ? INTERFACE_NODE_MARGIN : dim.width - INTERFACE_NODE_SIZE - INTERFACE_NODE_MARGIN;
        y = spacing * (idx + 1) - INTERFACE_NODE_SIZE / 2;
      }

      return {
        ...node,
        data: { ...node.data, handleSide: side },
        position: { x, y },
        style: { width: INTERFACE_NODE_SIZE, height: INTERFACE_NODE_SIZE, borderRadius: "50%" },
      };
    }

    return node;
  });
}
