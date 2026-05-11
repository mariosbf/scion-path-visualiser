import {
  Background,
  Controls,
  EdgeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useCallback, useEffect, useMemo } from "react";
import type { Topology } from "../bindings";
import { layoutGraph } from "../lib/layout";
import type { HighlightedPath } from "../lib/paths";
import type {
  AsNodeData,
  EdgeData,
  IsdNodeData,
  RouterNodeData,
  TopologyEdge,
  TopologyNode,
} from "../lib/topology";
import { buildGraph } from "../lib/topology";
import { HighlightedEdge } from "./edges/HighlightedEdge";
import { AsNode } from "./nodes/AsNode";
import { IsdNode } from "./nodes/IsdNode";
import { RouterNode } from "./nodes/RouterNode";
import type { TopologyCanvasItem } from "../hooks/useTopologyCanvas";

export type { TopologyCanvasItem } from "../hooks/useTopologyCanvas";

export interface TopologyCanvasProps {
  topology: Topology;
  onComponentClick: (component?: TopologyCanvasItem) => void;
  highlightedPath?: HighlightedPath;
  onGraphReady?: (nodes: TopologyNode[], edges: TopologyEdge[]) => void;
}

const nodeTypes: NodeTypes = { isd: IsdNode, as: AsNode, router: RouterNode };
const edgeTypes: EdgeTypes = { highlighted: HighlightedEdge };

const edgeStyle = {
  Core: { style: { strokeWidth: 3, stroke: "#868e96" } },
  Child: { style: { strokeWidth: 1.5, stroke: "#868e96" } },
  Peer: {
    style: { strokeWidth: 1.5, stroke: "#868e96", strokeDasharray: "5,5" },
  },
} as const;

export function TopologyCanvas({
  topology,
  onComponentClick,
  highlightedPath,
  onGraphReady,
}: TopologyCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyEdge>([]);

  useEffect(() => {
    const { nodes: graphNodes, edges: graphEdges } = buildGraph(topology);
    const laidOut = layoutGraph(graphNodes, graphEdges);
    setNodes(laidOut);
    setEdges(graphEdges);
    onGraphReady?.(laidOut, graphEdges);
  }, [topology, setNodes, setEdges, onGraphReady]);

  const onNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_: React.MouseEvent, node: TopologyNode) => {
      if (node.type === "isd") {
        onComponentClick({ type: "isd", data: node.data as IsdNodeData });
      } else if (node.type === "as") {
        onComponentClick({ type: "as", data: node.data as AsNodeData });
      } else if (node.type === "router") {
        onComponentClick({ type: "border-router", data: node.data as RouterNodeData });
      }
    },
    [onComponentClick],
  );

  const onEdgeClick: EdgeMouseHandler<TopologyEdge> = useCallback(
    (_: React.MouseEvent, edge: TopologyEdge) => {
      const link = (edge.data as EdgeData | undefined)?.link;
      if (link) {
        onComponentClick({ type: "link", data: link });
      }
    },
    [onComponentClick],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        ...(edgeStyle[edge.data?.linkType ?? "Core"] ?? {}),
      })),
    [edges],
  );

  const highlightedEdges = useMemo((): TopologyEdge[] => {
    if (!highlightedPath || highlightedPath.edgeIds.length === 0) {
      return styledEdges;
    }
    return styledEdges.map((edge) => {
      if (highlightedPath.edgeIds.includes(edge.id)) {
        return {
          ...edge,
          type: "highlighted" as const,
          animated: true,
          data: {
            ...edge.data!,
            reverse: highlightedPath.edgeDirections.get(edge.id) === "reverse",
          },
        } as TopologyEdge;
      }
      return { ...edge, style: { ...edge.style, opacity: 0.15 } };
    });
  }, [styledEdges, highlightedPath]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={highlightedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => onComponentClick(undefined)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
