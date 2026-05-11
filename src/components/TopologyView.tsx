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
import { useCallback, useEffect, useState } from "react";
import type { AsInfo, Link, Topology } from "../bindings";
import useTopologyCanvas from "../hooks/useTopologyCanvas";
import { TopologyCanvas } from "./TopologyCanvas";
import { AsDetailDrawer } from "./drawers/AsDetailDrawer";
import type { AsSelection, ServiceDrawerId } from "./drawers/AsDetailDrawer";
import { ControlServiceDrawer } from "./drawers/ControlServiceDrawer";
import { DaemonDrawer } from "./drawers/DaemonDrawer";
import { EndhostApiBridgeDrawer } from "./drawers/EndhostApiBridgeDrawer";
import { HummingbirdDrawer } from "./drawers/HummingbirdDrawer";
import { InfoItem } from "./drawers/InfoItem";
import { RouterDetailDrawer } from "./drawers/RouterDetailDrawer";
import type { RouterSelection } from "./drawers/RouterDetailDrawer";

interface Props {
  topology: Topology;
}

export function TopologyView({ topology }: Props) {
  const { canvasProps, selected, selectedInfo } = useTopologyCanvas(topology);

  const drawersStack = useDrawersStack([
    "detail",
    "service-control",
    "service-daemon",
    "service-hbird",
    "router-detail",
    "as-detail",
    "ehapi-bridge",
  ]);

  const [activeAsId, setActiveAsId] = useState<string | null>(null);
  const [activeRouter, setActiveRouter] = useState<RouterSelection | null>(null);

  useEffect(() => {
    if (!selected) {
      drawersStack.closeAll();
      return;
    }
    if (selected.type === "isd" || selected.type === "link") {
      drawersStack.open("detail");
    } else if (selected.type === "as") {
      setActiveAsId(selected.data.asId);
      drawersStack.open("as-detail");
    } else if (selected.type === "border-router" && selectedInfo?.type === "border-router") {
      setActiveAsId(selected.data.asId);
      setActiveRouter({
        router: selectedInfo.data,
        asId: selectedInfo.asId,
        interfaceId: selectedInfo.interfaceId,
      });
      drawersStack.open("router-detail");
    }
  }, [selected, selectedInfo, drawersStack]);

  const handleDeselect = useCallback(() => {
    canvasProps.onComponentClick(undefined);
  }, [canvasProps]);

  const activeAsInfo = activeAsId ? topology.ases[activeAsId] ?? null : null;
  const activeAsSelection: AsSelection | null =
    activeAsId && activeAsInfo
      ? { asId: activeAsId, info: activeAsInfo }
      : null;

  return (
    <DrawerStack>
      <TopologyCanvas {...canvasProps} />

      <Drawer
        {...drawersStack.register("detail")}
        onClose={() => {
          drawersStack.close("detail");
          handleDeselect();
        }}
        position="right"
        size="md"
        title="Details"
        styles={{ body: { paddingTop: 8 } }}
      >
        {selected?.type === "isd" && selectedInfo?.type === "isd" && (
          <IsdDetailPanel
            data={selectedInfo.data}
            onViewAs={(asId) => {
              setActiveAsId(asId);
              drawersStack.open("as-detail");
            }}
          />
        )}
        {selected?.type === "link" && selectedInfo?.type === "link" && (
          <LinkDetailPanel data={selectedInfo.data} />
        )}
      </Drawer>

      <AsDetailDrawer
        {...drawersStack.register("as-detail")}
        onClose={() => drawersStack.close("as-detail")}
        selection={activeAsSelection}
        onViewService={(id: ServiceDrawerId) => drawersStack.open(id)}
        onViewRouter={(r: RouterSelection) => {
          setActiveRouter(r);
          drawersStack.open("router-detail");
        }}
      />

      <ControlServiceDrawer
        {...drawersStack.register("service-control")}
        info={activeAsInfo?.control_service ?? null}
      />
      <DaemonDrawer
        {...drawersStack.register("service-daemon")}
        info={activeAsInfo?.daemon ?? null}
      />
      <HummingbirdDrawer
        {...drawersStack.register("service-hbird")}
        info={activeAsInfo?.hummingbird ?? null}
      />
      <EndhostApiBridgeDrawer
        {...drawersStack.register("ehapi-bridge")}
        activeAs={
          activeAsId && activeAsInfo
            ? { asId: activeAsId, info: activeAsInfo.endhost_api_bridge }
            : null
        }
      />
      <RouterDetailDrawer
        {...drawersStack.register("router-detail")}
        selection={activeRouter}
      />
    </DrawerStack>
  );
}

function IsdDetailPanel({
  data,
  onViewAs,
}: {
  data: { isd: string; ases: [string, AsInfo][] };
  onViewAs: (asId: string) => void;
}) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD" value={data.isd} />
      {data.ases.length > 0 && (
        <Stack gap={4}>
          <Text c="dimmed">ASes</Text>
          <Stack gap={4}>
            {data.ases.map(([asId, asInfo]) => (
              <Anchor href="#" key={asId} onClick={() => onViewAs(asId)}>
                {asId}
                {asInfo.core ? " (core)" : ""}
              </Anchor>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function LinkDetailPanel({ data }: { data: Link }) {
  return (
    <Stack gap="sm">
      <InfoItem
        label="Source"
        value={`${data.a.as_id} (if: ${data.a.interface_id})`}
      />
      <InfoItem
        label="Target"
        value={`${data.b.as_id} (if: ${data.b.interface_id})`}
      />
      <Stack>
        <Text c="dimmed">Link Type</Text>
        <Badge
          color={
            data.link_type === "Core"
              ? "orange"
              : data.link_type === "Child"
                ? "green"
                : "blue"
          }
        >
          {data.link_type}
        </Badge>
      </Stack>
      <Divider />
    </Stack>
  );
}
