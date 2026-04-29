import { Badge, Divider, Drawer, Group, Stack, Text } from "@mantine/core";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Topology } from "../bindings";
import { layoutGraph } from "../lib/layout";
import type {
  AsNodeData,
  IsdNodeData,
  RouterNodeData,
  TopologyEdge,
  TopologyNode,
} from "../lib/topology";
import { buildGraph } from "../lib/topology";
import { AsNode } from "./nodes/AsNode";
import { IsdNode } from "./nodes/IsdNode";
import { RouterNode } from "./nodes/RouterNode";
import CopyActionIcon from "./util/CopyActionIcon";

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
    [],
  );
  const onEdgeClick: EdgeMouseHandler<TopologyEdge> = useCallback(
    (_: React.MouseEvent, edge: TopologyEdge) => setSelected(edge),
    [],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        ...(edgeStyle[edge.data?.linkType ?? "Core"] ?? {}),
      })),
    [edges],
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

function InfoItem({
  label,
  ...props
}: { label: string } & (
  | {
    value: string | number;
    values?: never;
  }
  | {
    value?: never;
    values: (string | number)[];
  }
)) {
  const item = (v: string | number) => (
    <Group justify="space-between" key={v}>
      <Text>{v}</Text>
      <CopyActionIcon value={v} />
    </Group>
  );

  const value =
    props.value !== undefined ? item(props.value) : props.values?.map(item);

  return (
    <>
      <Stack gap={4}>
        <Text c="dimmed">{label}</Text>
        <Stack gap={4}>{value}</Stack>
      </Stack>
      <Divider />
    </>
  );
}

function RouterDetails({ node }: { node: RouterNodeData }) {
  return (
    <Stack gap="sm">
      <InfoItem label="Router" value={node.routerName} />
      <InfoItem label="AS" value={node.asId} />
      <InfoItem label="Interface ID" value={node.interfaceId} />
      <InfoItem label="Underlay local" value={node.underlayLocal} />
      <InfoItem label="Underlay remote" value={node.underlayRemote} />
    </Stack>
  );
}

function IsdDetails({ node }: { node: IsdNodeData }) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD" value={node.isd} />
    </Stack>
  );
}

function AsDetails({ node }: { node: AsNodeData }) {
  return (
    <Stack gap="sm">
      <InfoItem label="AS" value={node.asId} />
      <InfoItem
        label="Control Service"
        values={[node.control_service.name, node.discovery_service.addr]}
      />
      <InfoItem
        label="Discovery Service"
        values={[node.discovery_service.name, node.discovery_service.addr]}
      />
      {node.core && <Badge color="orange">Core</Badge>}
      {node.mtu !== null && <InfoItem label="MTU" value={node.mtu} />}
    </Stack>
  );
}

function EdgeDetails({ edge }: { edge: TopologyEdge }) {
  return (
    <Stack gap="sm">
      <InfoItem label="Source" value={edge.source} />
      <InfoItem label="Target" value={edge.target} />
      <Badge
        color={
          edge.data?.linkType === "Core"
            ? "orange"
            : edge.data?.linkType === "Child"
              ? "green"
              : "blue"
        }
      >
        {edge.data?.linkType}
      </Badge>
    </Stack>
  );
}

function DetailsPanel({ element }: { element: TopologyNode | TopologyEdge }) {
  // Router node details
  if (element.type === "router") {
    const node = element as TopologyNode;
    return <RouterDetails node={node.data as RouterNodeData} />;
  } else if (element.type === "isd") {
    const node = element as TopologyNode;
    return <IsdDetails node={node.data as IsdNodeData} />;
  } else if (element.type === "as") {
    const node = element as TopologyNode;
    return <AsDetails node={node.data as AsNodeData} />;
  } else {
    const edge = element as TopologyEdge;
    return <EdgeDetails edge={edge} />;
  }
}
