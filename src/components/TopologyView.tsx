import React, { useState, useCallback, useMemo } from "react";
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
import { Drawer, Text, Stack, Badge, Button } from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import "@xyflow/react/dist/style.css";
import { buildGraph } from "../lib/topology";
import { layoutGraph } from "../lib/layout";
import { IsdNode } from "./nodes/IsdNode";
import { AsNode } from "./nodes/AsNode";
import { RouterNode } from "./nodes/RouterNode";
import { commands } from "../bindings";
import type { TopologyNode, TopologyEdge } from "../lib/topology";

const nodeTypes: NodeTypes = { isd: IsdNode, as: AsNode, router: RouterNode };

const edgeStyle = {
  Core: { style: { strokeWidth: 3, stroke: "#868e96" } },
  Child: { style: { strokeWidth: 1.5, stroke: "#868e96" } },
  Peer: { style: { strokeWidth: 1.5, stroke: "#868e96", strokeDasharray: "5,5" } },
} as const;

type Selected = TopologyNode | TopologyEdge | null;

export function TopologyView() {
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyEdge>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    const folder = await open({ directory: true, title: "Select SCION project folder" });
    if (!folder || typeof folder !== "string") return;

    const topoFile = await open({
      title: "Select topology file",
      filters: [{ name: "Topology", extensions: ["topo"] }],
    });
    if (!topoFile || typeof topoFile !== "string") return;

    setLoading(true);
    setError(null);
    try {
      const result = await commands.loadProject(folder, topoFile);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      const topology = result.data;
      const { nodes: graphNodes, edges: graphEdges } = buildGraph(topology);
      const laidOut = layoutGraph(graphNodes, graphEdges);
      setNodes(laidOut);
      setEdges(graphEdges);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_: React.MouseEvent, node: TopologyNode) => setSelected(node),
    []
  );
  const onEdgeClick: EdgeMouseHandler<TopologyEdge> = useCallback(
    (_: React.MouseEvent, edge: TopologyEdge) => setSelected(edge),
    []
  );

  const styledEdges = useMemo(
    () => edges.map((edge) => ({
      ...edge,
      ...(edgeStyle[edge.data?.linkType ?? "Core"] ?? {}),
    })),
    [edges]
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {nodes.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <Stack align="center" gap="md">
            {error && (
              <Text c="red" size="sm" style={{ maxWidth: 400, wordBreak: "break-word" }}>
                {error}
              </Text>
            )}
            <Button onClick={handleOpen} loading={loading} size="md">
              Open Project
            </Button>
          </Stack>
        </div>
      )}

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
        <Badge color={edge.data?.linkType === "Core" ? "blue" : edge.data?.linkType === "Child" ? "green" : "orange"}>
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
        {node.data.mtu !== null && (
          <Text size="sm">MTU: {node.data.mtu}</Text>
        )}
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
