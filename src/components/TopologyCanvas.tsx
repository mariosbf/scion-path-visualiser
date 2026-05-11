import {
  Anchor,
  Badge,
  Divider,
  Drawer,
  DrawerStack,
  Stack,
  Text,
  useDrawersStack,
} from "@mantine/core";
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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AsInfo, BorderRouterInfo, Link, Topology } from "../bindings";
import { layoutGraph } from "../lib/layout";
import type { HighlightedPath } from "../lib/paths";
import type {
  AsNodeData,
  IsdNodeData,
  RouterNodeData,
  TopologyEdge,
  TopologyNode,
} from "../lib/topology";
import { buildGraph } from "../lib/topology";
import { HighlightedEdge } from "./edges/HighlightedEdge";
import {
  AsDetailDrawer,
  AsDetails,
  type ServiceDrawerId,
} from "./drawers/AsDetailDrawer";
import { ControlServiceDrawer } from "./drawers/ControlServiceDrawer";
import { DaemonDrawer } from "./drawers/DaemonDrawer";
import { EndhostApiBridgeDrawer } from "./drawers/EndhostApiBridgeDrawer";
import { HummingbirdDrawer } from "./drawers/HummingbirdDrawer";
import { InfoItem } from "./drawers/InfoItem";
import {
  RouterDetailDrawer,
  RouterDetails,
} from "./drawers/RouterDetailDrawer";
import { AsNode } from "./nodes/AsNode";
import { IsdNode } from "./nodes/IsdNode";
import { RouterNode } from "./nodes/RouterNode";
import { type TopologyCanvasItem } from "../hooks/useTopologyCanvas";

export interface TopologyCanvasProps {
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

type Selected = TopologyNode | TopologyEdge | null;

interface Props {
  topology: Topology;
  highlightedPath?: HighlightedPath;
  onGraphReady?: (nodes: TopologyNode[], edges: TopologyEdge[]) => void;
}

export function TopologyCanvas({
  topology,
  highlightedPath,
  onGraphReady,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TopologyEdge>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const drawersStack = useDrawersStack([
    "detail",
    "service-control",
    "service-daemon",
    "service-hbird",
    "router-detail",
    "as-detail",
    "ehapi-bridge",
  ]);
  const [selectedRouter, setSelectedRouter] = useState<RouterNodeData | null>(
    null,
  );
  const [selectedAs, setSelectedAs] = useState<AsNodeData | null>(null);

  useEffect(() => {
    const { nodes: graphNodes, edges: graphEdges } = buildGraph(topology);
    const laidOut = layoutGraph(graphNodes, graphEdges);
    setNodes(laidOut);
    setEdges(graphEdges);
    onGraphReady?.(laidOut, graphEdges);
  }, [topology, setNodes, setEdges, onGraphReady]);

  const onNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_: React.MouseEvent, node: TopologyNode) => {
      setSelected(node);
      drawersStack.open("detail");
    },
    [drawersStack],
  );

  const onEdgeClick: EdgeMouseHandler<TopologyEdge> = useCallback(
    (_: React.MouseEvent, edge: TopologyEdge) => {
      setSelected(edge);
      drawersStack.open("detail");
    },
    [drawersStack],
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
            linkType: edge.data?.linkType ?? "Core",
            reverse: highlightedPath.edgeDirections.get(edge.id) === "reverse",
          },
        } as TopologyEdge;
      }
      return { ...edge, style: { ...edge.style, opacity: 0.15 } };
    });
  }, [styledEdges, highlightedPath]);

  const closeAll = useCallback(() => {
    drawersStack.closeAll();
    setSelected(null);
  }, [drawersStack]);

  const selectedAsNode = useMemo(
    () => (selected?.type === "as" ? (selected as TopologyNode) : null),
    [selected],
  );

  const activeAsData = useMemo(
    () =>
      (selectedAsNode?.data as AsNodeData | undefined) ?? selectedAs ?? null,
    [selectedAsNode, selectedAs],
  );

  const selectedAsRouters = useMemo(
    () =>
      selectedAsNode
        ? nodes
          .filter((n) => n.type === "router")
          .map((n) => n.data as RouterNodeData)
          .filter((r) => r.asId === (selectedAsNode.data as AsNodeData).asId)
        : [],
    [nodes, selectedAsNode],
  );

  const selectedIsdAses = useMemo(
    () =>
      selected?.type === "isd"
        ? nodes
          .filter((n) => n.type === "as")
          .map((n) => n.data as AsNodeData)
          .filter((a) =>
            a.asId.startsWith((selected.data as IsdNodeData).isd + "-"),
          )
        : [],
    [nodes, selected],
  );

  const selectedAsFromIsdRouters = useMemo(
    () =>
      selectedAs
        ? nodes
          .filter((n) => n.type === "router")
          .map((n) => n.data as RouterNodeData)
          .filter((r) => r.asId === selectedAs.asId)
        : [],
    [nodes, selectedAs],
  );

  return (
    <DrawerStack>
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
          onPaneClick={closeAll}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <Drawer
        {...drawersStack.register("detail")}
        onClose={() => {
          drawersStack.close("detail");
          setSelected(null);
        }}
        position="right"
        size="md"
        title="Details"
        styles={{ body: { paddingTop: 8 } }}
      >
        {selected && (
          <DetailsPanel
            element={selected}
            routers={selectedAsRouters}
            isdAses={selectedIsdAses}
            onViewService={(id) => drawersStack.open(id)}
            onViewRouter={(r) => {
              setSelectedRouter(r);
              drawersStack.open("router-detail");
            }}
            onViewAs={(a) => {
              setSelectedAs(a);
              drawersStack.open("as-detail");
            }}
          />
        )}
      </Drawer>

      <ControlServiceDrawer
        {...drawersStack.register("service-control")}
        activeAsData={activeAsData}
      />
      <DaemonDrawer
        {...drawersStack.register("service-daemon")}
        activeAsData={activeAsData}
      />
      <HummingbirdDrawer
        {...drawersStack.register("service-hbird")}
        activeAsData={activeAsData}
      />
      <EndhostApiBridgeDrawer
        {...drawersStack.register("ehapi-bridge")}
        activeAsData={activeAsData}
      />
      <RouterDetailDrawer
        {...drawersStack.register("router-detail")}
        selectedRouter={selectedRouter}
      />
      <AsDetailDrawer
        {...drawersStack.register("as-detail")}
        selectedAs={selectedAs}
        routers={selectedAsFromIsdRouters}
        onViewService={(id) => drawersStack.open(id)}
        onViewRouter={(r) => {
          setSelectedRouter(r);
          drawersStack.open("router-detail");
        }}
      />
    </DrawerStack>
  );
}

function IsdDetails({
  node,
  ases,
  onViewAs,
}: {
  node: IsdNodeData;
  ases: AsNodeData[];
  onViewAs: (as: AsNodeData) => void;
}) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD" value={node.isd} />
      {ases.length > 0 && (
        <Stack gap={4}>
          <Text c="dimmed">ASes</Text>
          <Stack gap={4}>
            {ases.map((a) => (
              <Anchor href="#" key={a.asId} onClick={() => onViewAs(a)}>
                {a.asId}
                {a.core ? " (core)" : ""}
              </Anchor>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function EdgeDetails({ edge }: { edge: TopologyEdge }) {
  return (
    <Stack gap="sm">
      <InfoItem label="Source" value={edge.source} />
      <InfoItem label="Target" value={edge.target} />
      <Stack>
        <Text c="dimmed">Link Type</Text>
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
      <Divider />
    </Stack>
  );
}

function DetailsPanel({
  element,
  routers,
  isdAses,
  onViewService,
  onViewRouter,
  onViewAs,
}: {
  element: TopologyNode | TopologyEdge;
  routers: RouterNodeData[];
  isdAses: AsNodeData[];
  onViewService?: (id: ServiceDrawerId) => void;
  onViewRouter?: (router: RouterNodeData) => void;
  onViewAs?: (as: AsNodeData) => void;
}) {
  if (element.type === "router") {
    const node = element as TopologyNode;
    return <RouterDetails node={node.data as RouterNodeData} />;
  } else if (element.type === "isd") {
    const node = element as TopologyNode;
    return (
      <IsdDetails
        node={node.data as IsdNodeData}
        ases={isdAses}
        onViewAs={onViewAs!}
      />
    );
  } else if (element.type === "as") {
    const node = element as TopologyNode;
    return (
      <AsDetails
        node={node.data as AsNodeData}
        routers={routers}
        onViewService={onViewService!}
        onViewRouter={onViewRouter!}
      />
    );
  } else {
    const edge = element as TopologyEdge;
    return <EdgeDetails edge={edge} />;
  }
}
