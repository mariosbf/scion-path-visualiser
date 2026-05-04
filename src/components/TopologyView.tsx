import {
  Anchor,
  Badge,
  Button,
  Divider,
  Drawer,
  DrawerStack,
  Group,
  Stack,
  Text,
  useDrawersStack,
} from "@mantine/core";
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
import { IconFileText } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
  }, [topology, setNodes, setEdges]);

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
          edges={styledEdges}
          nodeTypes={nodeTypes}
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

      <Drawer
        {...drawersStack.register("service-control")}
        position="right"
        size="md"
        title={
          activeAsData
            ? `Control Service — ${activeAsData.control_service.name}`
            : "Control Service"
        }
        styles={{ body: { paddingTop: 8 } }}
      >
        {activeAsData && (
          <ServiceDrawerContent
            fields={[
              { label: "Address", value: activeAsData.control_service.addr },
            ]}
            logsServiceName={activeAsData.control_service.name}
          />
        )}
      </Drawer>

      <Drawer
        {...drawersStack.register("service-daemon")}
        position="right"
        size="md"
        title={
          activeAsData
            ? `SCION Daemon — ${activeAsData.daemon_info.id}`
            : "SCION Daemon"
        }
        styles={{ body: { paddingTop: 8 } }}
      >
        {activeAsData && (
          <ServiceDrawerContent
            fields={[
              { label: "Address", value: activeAsData.daemon_info.address },
              {
                label: "API Address",
                value: activeAsData.daemon_info.api_addr,
              },
            ]}
            logsServiceName={activeAsData.daemon_info.id}
          />
        )}
      </Drawer>

      <Drawer
        {...drawersStack.register("service-hbird")}
        position="right"
        size="md"
        title={
          activeAsData?.hbird_info
            ? `Hummingbird — ${activeAsData.hbird_info.id}`
            : "Hummingbird"
        }
        styles={{ body: { paddingTop: 8 } }}
      >
        {activeAsData?.hbird_info && (
          <ServiceDrawerContent
            fields={[
              { label: "Address", value: activeAsData.hbird_info.addr },
              {
                label: "Min Bandwidth",
                value: activeAsData.hbird_info.min_bandwidth,
              },
              {
                label: "Max Bandwidth",
                value: activeAsData.hbird_info.max_bandwidth,
              },
              {
                label: "Reservation Duration",
                value: activeAsData.hbird_info.reservation_duration,
              },
            ]}
            logsServiceName={activeAsData.hbird_info.id}
          />
        )}
      </Drawer>

      <Drawer
        {...drawersStack.register("ehapi-bridge")}
        position="right"
        size="md"
        title={
          activeAsData
            ? `Endhost API Bridge — ${activeAsData.asId}`
            : "Endhost API Bridge"
        }
        styles={{ body: { paddingTop: 8 } }}
      >
        {activeAsData && (
          <ServiceDrawerContent
            fields={[
              { label: "Address", value: activeAsData.ehapi_bridge.addr },
            ]}
            logsServiceName={`${activeAsData.asId}-ehapi-bridge`}
          />
        )}
      </Drawer>

      <Drawer
        {...drawersStack.register("router-detail")}
        position="right"
        size="md"
        title={
          selectedRouter ? `Router — ${selectedRouter.routerName}` : "Router"
        }
        styles={{ body: { paddingTop: 8 } }}
      >
        {selectedRouter && <RouterDetails node={selectedRouter} />}
      </Drawer>

      <Drawer
        {...drawersStack.register("as-detail")}
        position="right"
        size="md"
        title={selectedAs ? `AS — ${selectedAs.asId}` : "AS"}
        styles={{ body: { paddingTop: 8 } }}
      >
        {selectedAs && (
          <AsDetails
            node={selectedAs}
            routers={selectedAsFromIsdRouters}
            onViewService={(id) => drawersStack.open(id)}
            onViewRouter={(r) => {
              setSelectedRouter(r);
              drawersStack.open("router-detail");
            }}
          />
        )}
      </Drawer>
    </DrawerStack>
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
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      <InfoItem label="Router" value={node.routerName} />
      <InfoItem label="AS" value={node.asId} />
      <InfoItem label="Interface ID" value={node.interfaceId} />
      <InfoItem label="Underlay local" value={node.underlayLocal} />
      <InfoItem label="Underlay remote" value={node.underlayRemote} />
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$serviceName",
            params: { serviceName: node.routerName },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
  );
}

interface ServiceDrawerProps {
  fields: { label: string; value: string | number }[];
  logsServiceName: string;
}

function ServiceDrawerContent({ fields, logsServiceName }: ServiceDrawerProps) {
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      {fields.map((f) => (
        <InfoItem key={f.label} label={f.label} value={f.value} />
      ))}
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$serviceName",
            params: { serviceName: logsServiceName },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
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

type ServiceDrawerId =
  | "service-control"
  | "service-daemon"
  | "service-hbird"
  | "ehapi-bridge";

function AsDetails({
  node,
  routers,
  onViewService,
  onViewRouter,
}: {
  node: AsNodeData;
  routers: RouterNodeData[];
  onViewService: (id: ServiceDrawerId) => void;
  onViewRouter: (router: RouterNodeData) => void;
}) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD-AS " value={node.asId} />
      {node.mtu !== null && <InfoItem label="MTU" value={node.mtu} />}

      <Stack>
        <Text c="dimmed">Type</Text>
        {node.core && <Badge color="orange">Core</Badge>}
      </Stack>
      <Divider />

      <Stack gap={4}>
        <Text c="dimmed">Services</Text>
        <Stack gap={4}>
          <Anchor href="#" onClick={() => onViewService("service-control")}>
            Control service ({node.control_service.name})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("service-daemon")}>
            SCION Daemon ({node.daemon_info.id})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("ehapi-bridge")}>
            Endhost API Bridge
          </Anchor>
          {node.hbird_info && (
            <Anchor href="#" onClick={() => onViewService("service-hbird")}>
              Hummingbird ({node.hbird_info.id})
            </Anchor>
          )}
        </Stack>
      </Stack>
      <Divider />

      {routers.length > 0 && (
        <>
          <Stack gap={4}>
            <Text c="dimmed">Routers</Text>
            <Stack gap={4}>
              {routers.map((r) => (
                <Anchor
                  href="#"
                  key={`${r.routerName}-${r.interfaceId}`}
                  onClick={() => onViewRouter(r)}
                >
                  {r.routerName} (if: {r.interfaceId})
                </Anchor>
              ))}
            </Stack>
          </Stack>
          <Divider />
        </>
      )}

      <InfoItem
        label="Discovery Service"
        values={[node.discovery_service.name, node.discovery_service.addr]}
      />
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
