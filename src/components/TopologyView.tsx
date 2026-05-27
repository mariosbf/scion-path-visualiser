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
import { useEffect, useState } from "react";
import type { AsInfo, Link, Topology } from "../bindings";
import useTopologyCanvas from "../hooks/useTopologyCanvas";
import { TopologyCanvas } from "./TopologyCanvas";
import type { AsSelection, ServiceDrawerId } from "./drawers/AsDetailDrawer";
import { AsDetailDrawer } from "./drawers/AsDetailDrawer";
import { ControlServiceDrawer } from "./drawers/ControlServiceDrawer";
import { DaemonDrawer } from "./drawers/DaemonDrawer";
import { DiscoveryServiceDrawer } from "./drawers/DiscoveryServiceDrawer";
import { EndhostApiBridgeDrawer } from "./drawers/EndhostApiBridgeDrawer";
import { HummingbirdDrawer } from "./drawers/HummingbirdDrawer";
import { InfoItem } from "./drawers/InfoItem";
import type { InterfaceSelection } from "./drawers/InterfaceDetailDrawer";
import { InterfaceDetailDrawer } from "./drawers/InterfaceDetailDrawer";

interface Props {
  topology: Topology;
}

export function TopologyView({ topology }: Props) {
  const { canvasProps, selected, setSelected, selectedInfo } =
    useTopologyCanvas(topology);

  const drawersStack = useDrawersStack([
    "detail",
    "service-control",
    "service-daemon",
    "service-hbird",
    "service-discovery",
    "interface-detail",
    "as-detail",
    "ehapi-bridge",
  ]);
  const { open: openDrawer, closeAll: closeAllDrawers } = drawersStack;

  const [activeAsId, setActiveAsId] = useState<string | null>(null);
  const [activeInterface, setActiveInterface] = useState<InterfaceSelection | null>(
    null,
  );

  useEffect(() => {
    if (!selected) {
      closeAllDrawers();
      return;
    }
    if (selected.type === "isd" || selected.type === "link") {
      openDrawer("detail");
    } else if (selected.type === "as") {
      setActiveAsId(selected.data.asId);
      openDrawer("as-detail");
    } else if (
      selected.type === "border-router-interface" &&
      selectedInfo?.type === "border-router-interface"
    ) {
      setActiveAsId(selected.data.asId);
      setActiveInterface({
        router: selectedInfo.data,
        asId: selectedInfo.asId,
        interfaceId: selectedInfo.interfaceId,
      });
      openDrawer("interface-detail");
    }
  }, [selected, selectedInfo, openDrawer, closeAllDrawers]);

  const activeAsInfo = activeAsId ? (topology.ases[activeAsId] ?? null) : null;
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
          setSelected(undefined);
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
        onClose={() => {
          drawersStack.close("as-detail");
          setSelected(undefined);
        }}
        selection={activeAsSelection}
        onViewService={(id: ServiceDrawerId) => drawersStack.open(id)}
        onViewInterface={(r: InterfaceSelection) => {
          setActiveInterface(r);
          drawersStack.open("interface-detail");
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
      <DiscoveryServiceDrawer
        {...drawersStack.register("service-discovery")}
        info={activeAsInfo?.discovery_service ?? null}
      />
      <InterfaceDetailDrawer
        {...drawersStack.register("interface-detail")}
        selection={activeInterface}
        onClose={() => {
          setSelected(undefined);
        }}
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
