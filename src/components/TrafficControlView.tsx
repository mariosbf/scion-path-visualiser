import {
  Button,
  Drawer,
  DrawerStack,
  Notification,
  Stack,
  useDrawersStack,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { commands } from "../bindings";
import type { Link, Topology } from "../bindings";
import useTopologyCanvas from "../hooks/useTopologyCanvas";
import { TopologyCanvas } from "./TopologyCanvas";
import { BulkTrafficControlDrawer } from "./drawers/BulkTrafficControlDrawer";
import { InfoItem } from "./drawers/InfoItem";
import type { InterfaceSelection } from "./drawers/InterfaceDetailDrawer";
import { TrafficControlDrawer } from "./drawers/TrafficControlDrawer";

interface Props {
  topology: Topology;
}

export function TrafficControlView({ topology }: Props) {
  const { canvasProps, selected, setSelected, selectedInfo } =
    useTopologyCanvas(topology);

  const drawersStack = useDrawersStack(["detail", "tc-control", "tc-bulk"]);
  const { open: openDrawer, closeAll: closeAllDrawers } = drawersStack;

  const [activeInterface, setActiveInterface] =
    useState<InterfaceSelection | null>(null);
  const [clearAllLoading, setClearAllLoading] = useState(false);
  const [clearAllError, setClearAllError] = useState<string | null>(null);

  async function handleClearAll() {
    setClearAllLoading(true);
    setClearAllError(null);
    const result = await commands.netcondClearAll();
    setClearAllLoading(false);
    if (result.status === "error") setClearAllError(result.error);
  }

  useEffect(() => {
    if (!selected) {
      closeAllDrawers();
      return;
    }
    if (selected.type === "link") {
      openDrawer("detail");
    } else if (
      selected.type === "border-router-interface" &&
      selectedInfo?.type === "border-router-interface"
    ) {
      setActiveInterface({
        router: selectedInfo.data,
        asId: selectedInfo.asId,
        interfaceId: selectedInfo.interfaceId,
      });
      openDrawer("tc-control");
    }
  }, [selected, selectedInfo, openDrawer, closeAllDrawers]);

  return (
    <DrawerStack>
      <TopologyCanvas {...canvasProps} />

      {/* ISD / link info drawer */}
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
        {selected?.type === "link" && selectedInfo?.type === "link" && (
          <LinkDetailPanel data={selectedInfo.data} topology={topology} />
        )}
      </Drawer>

      {/* Traffic control drawer (border-router clicks) */}
      <TrafficControlDrawer
        {...drawersStack.register("tc-control")}
        selection={activeInterface}
        topology={topology}
        onClose={() => {
          drawersStack.close("tc-control");
          setSelected(undefined);
        }}
      />

      <BulkTrafficControlDrawer
        {...drawersStack.register("tc-bulk")}
        topology={topology}
        onClose={() => drawersStack.close("tc-bulk")}
      />

      <Stack
        gap="sm"
        style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200 }}
      >
        <Button onClick={() => openDrawer("tc-bulk")}>Bulk edit interfaces</Button>
        <Button color="red" loading={clearAllLoading} onClick={handleClearAll}>
          Clear all
        </Button>
      </Stack>

      {clearAllError && (
        <Notification
          color="red"
          title="Clear all failed"
          onClose={() => setClearAllError(null)}
          style={{
            position: "fixed",
            bottom: 80,
            right: 24,
            zIndex: 200,
            maxWidth: 320,
          }}
        >
          {clearAllError}
        </Notification>
      )}
    </DrawerStack>
  );
}

function LinkDetailPanel({
  data,
  topology,
}: {
  data: Link;
  topology: Topology;
}) {
  const startAs = topology.ases[data.a.as_id];
  const startRouter = startAs?.border_routers.find(
    (r) => r.name === data.a.router_name,
  );
  const startInterface = startRouter?.interfaces[data.a.interface_id];
  const endAs = topology.ases[data.b.as_id];
  const endRouter = endAs?.border_routers.find(
    (r) => r.name === data.b.router_name,
  );
  const endInterface = endRouter?.interfaces[data.b.interface_id];

  const startNetCond = startInterface?.net_cond;
  const endNetCond = endInterface?.net_cond;

  const linkDelay = (startNetCond?.delay_ms ?? 0) + (endNetCond?.delay_ms ?? 0);
  const linkRate = Math.min(
    startNetCond?.rate_kbps ?? Infinity,
    endNetCond?.rate_kbps ?? Infinity,
  );
  const linkLoss =
    1 -
    (1 - (startNetCond?.loss_percent ?? 0) / 100) *
    (1 - (endNetCond?.loss_percent ?? 0) / 100);

  // Need to take into account that each copy of a duplicated packet may again
  // be duplicated
  const linkDup =
    (1 + (startNetCond?.duplicate_percent ?? 0) / 100) *
    (1 + (endNetCond?.duplicate_percent ?? 0) / 100) -
    1;

  // Assume that a packet that is corrupted at both endpoints is still corrupted
  // (i.e. corruption at one endpoint doesn't "fix" the corruption at the other)
  const linkCorrupt =
    1 -
    (1 - (startNetCond?.corrupt_percent ?? 0) / 100) *
    (1 - (endNetCond?.corrupt_percent ?? 0) / 100);

  // Note: don't try to model reorder percentage here.

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
      <InfoItem label="Link Type" value={data.link_type} />
      <InfoItem label="Delay" value={`${linkDelay} ms`} noCopy />
      <InfoItem
        label="Rate"
        value={linkRate === Infinity ? "Not limited" : `${linkRate} kbps`}
        noCopy
      />
      <InfoItem
        label="Loss"
        value={`${(linkLoss * 100).toFixed(2)} %`}
        noCopy
      />
      <InfoItem
        label="Duplication"
        value={`${(linkDup * 100).toFixed(2)} %`}
        noCopy
      />
      <InfoItem
        label="Corruption"
        value={`${(linkCorrupt * 100).toFixed(2)} %`}
        noCopy
      />
    </Stack>
  );
}
