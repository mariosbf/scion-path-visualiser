import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import { Drawer, Text, Stack, Badge } from "@mantine/core";
import "@xyflow/react/dist/style.css";
import { buildGraph } from "../lib/topology";
import { layoutGraph } from "../lib/layout";
import { IsdNode } from "./nodes/IsdNode";
import { AsNode } from "./nodes/AsNode";
import { RouterNode } from "./nodes/RouterNode";
import type { Topology } from "../bindings";
import type { TopologyNode, TopologyEdge } from "../lib/topology";

const nodeTypes: NodeTypes = { isd: IsdNode, as: AsNode, router: RouterNode };

const edgeStyle = {
  Core: { style: { strokeWidth: 3, stroke: "#868e96" } },
  Child: { style: { strokeWidth: 1.5, stroke: "#868e96" } },
  Peer: {
    style: { strokeWidth: 1.5, stroke: "#868e96", strokeDasharray: "5,5" },
  },
} as const;

type Selected = TopologyNode | TopologyEdge | null;

interface Props {
  topology: Topology;
}

export function TopologyView({ topology }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyEdge>([]);
  const [selected, setSelected] = useState<Selected>(null);

  useEffect(() => {
    const { nodes: graphNodes, edges: graphEdges } = buildGraph(topology);
    const laidOut = layoutGraph(graphNodes, graphEdges);
    setNodes(laidOut);
    setEdges(graphEdges);
  }, [topology, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_: React.MouseEvent, node: TopologyNode) => setSelected(node),
    []
  );
  const onEdgeClick: EdgeMouseHandler<TopologyEdge> = useCallback(
    (_: React.MouseEvent, edge: TopologyEdge) => setSelected(edge),
    []
  );

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        ...(edgeStyle[edge.data?.linkType ?? "Core"] ?? {}),
      })),
    [edges]
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => setSelected(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="md"
        title="Details"
        styles={{ body: { paddingTop: 8 } }}
      >
        {selected && <DetailsPanel element={selected} />}
      </Drawer>
    </div>
  );
}

function DetailsPanel({ element }: { element: TopologyNode | TopologyEdge }) {
  if ("source" in element) {
    const edge = element as TopologyEdge;
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">Link</Text>
        <Badge
          color={
            edge.data?.linkType === "Core"
              ? "blue"
              : edge.data?.linkType === "Child"
              ? "green"
              : "orange"
          }
        >
          {edge.data?.linkType}
        </Badge>
        <Text size="sm" c="dimmed">Source</Text>
        <Text size="sm">{edge.source}</Text>
        <Text size="sm" c="dimmed">Target</Text>
        <Text size="sm">{edge.target}</Text>
      </Stack>
    );
  }

  const node = element as TopologyNode;

  if (node.type === "isd") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.label}</Text>
      </Stack>
    );
  }

  if (node.type === "as") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.asId}</Text>
        {node.data.core && <Badge color="orange">Core</Badge>}
        {node.data.mtu !== null && <Text size="sm">MTU: {node.data.mtu}</Text>}
      </Stack>
    );
  }

  if (node.type === "router") {
    return (
      <Stack gap="xs">
        <Text fw={600} size="sm">{node.data.routerName}</Text>
        <Text size="sm" c="dimmed">AS</Text>
        <Text size="sm">{node.data.asId}</Text>
        <Text size="sm" c="dimmed">Interface ID</Text>
        <Text size="sm">{node.data.interfaceId}</Text>
        <Text size="sm" c="dimmed">Underlay local</Text>
        <Text size="sm">{node.data.underlayLocal}</Text>
        <Text size="sm" c="dimmed">Underlay remote</Text>
        <Text size="sm">{node.data.underlayRemote}</Text>
      </Stack>
    );
  }

  return null;
}
