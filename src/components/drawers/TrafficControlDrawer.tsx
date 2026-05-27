import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Slider,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconEraser } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useState } from "react";
import type { NetCondParams, Topology } from "../../bindings";
import { commands } from "../../bindings";
import type { InterfaceSelection } from "./InterfaceDetailDrawer";
import { useHotkeys } from "@mantine/hooks";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  selection: InterfaceSelection | null;
  topology: Topology;
  onClose: () => void;
}

export function TrafficControlDrawer({
  selection,
  topology,
  onClose,
  ...drawerProps
}: Props) {
  const title = selection
    ? `Traffic Control — Interface ${selection.interfaceId} of ${selection.router.name}`
    : "Traffic Control";

  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={title}
      styles={{ body: { paddingTop: 8 } }}
      onClose={onClose}
    >
      {selection && (
        <TrafficControlContent selection={selection} topology={topology} />
      )}
    </Drawer>
  );
}

function TrafficControlContent({
  selection,
  topology,
}: {
  selection: InterfaceSelection;
  topology: Topology;
}) {
  const { router, asId, interfaceId } = selection;

  // Look up current net_cond from live topology (not stale snapshot in selection)
  const currentNetCond =
    topology.ases[asId]?.border_routers.find((r) => r.name === router.name)
      ?.interfaces[interfaceId]?.net_cond ?? null;

  const [delay, setDelay] = useState<number | string>("");
  const [loss, setLoss] = useState<number>();
  const [rate, setRate] = useState<number | string>("");
  const [dup, setDup] = useState<number>();
  const [corrupt, setCorrupt] = useState<number>();
  const [reorder, setReorder] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from current conditions when the selected interface changes
  useEffect(() => {
    setDelay(currentNetCond?.delay_ms ?? "");
    setLoss(currentNetCond?.loss_percent ?? undefined);
    setRate(currentNetCond?.rate_kbps ?? "");
    setDup(currentNetCond?.duplicate_percent ?? undefined);
    setCorrupt(currentNetCond?.corrupt_percent ?? undefined);
    setReorder(currentNetCond?.reorder_percent ?? undefined);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.name, interfaceId]);

  const handleSet = async () => {
    const params: NetCondParams = {
      delay_ms: typeof delay === "number" ? delay : null,
      loss_percent: loss ?? null,
      rate_kbps: typeof rate === "number" ? rate : null,
      duplicate_percent: dup ?? null,
      corrupt_percent: corrupt ?? null,
      reorder_percent: reorder ?? null,
    };

    if (Object.values(params).every((v) => v === null)) {
      setError("Specify at least one condition.");
      return;
    }

    setLoading(true);
    setError(null);
    const result = await commands.netcondSet(router.name, interfaceId, params);
    setLoading(false);
    if (result.status === "error") {
      setError(result.error);
    }
  };

  useHotkeys([["mod + enter", () => handleSet()]], []);

  const handleClear = async () => {
    setLoading(true);
    setError(null);
    const result = await commands.netcondClear(router.name, interfaceId);
    setLoading(false);
    if (result.status === "error") {
      setError(result.error);
    } else {
      setDelay("");
      setLoss(undefined);
      setRate("");
      setDup(undefined);
      setCorrupt(undefined);
      setReorder(undefined);
    }
  };

  const slider = (
    label: string,
    value: number | undefined,
    onChange: (v: number) => void,
  ) => (
    <Stack gap="sm">
      <Text size="sm" fw={700}>
        {label}
      </Text>
      <Slider
        mb="sm"
        defaultValue={0}
        marks={[
          { value: 20, label: "20%" },
          { value: 50, label: "50%" },
          { value: 80, label: "80%" },
        ]}
        label={(value) => `${value} %`}
        value={value ?? 0}
        onChange={onChange}
      />
    </Stack>
  );

  return (
    <Stack gap="md">
      <NumberInput
        label="Delay (ms)"
        placeholder="e.g. 50"
        min={0}
        value={delay}
        onChange={setDelay}
      />
      <Divider />

      <NumberInput
        label="Rate (kbps)"
        placeholder="e.g. 10000"
        min={0}
        value={rate}
        onChange={setRate}
      />
      <Divider />

      {slider("Packet loss (%)", loss, setLoss)}
      <Divider />

      {slider("Duplicate (%)", dup, setDup)}
      <Divider />

      {slider("Corrupt (%)", corrupt, setCorrupt)}
      <Divider />

      {slider("Reorder (%)", reorder, setReorder)}
      <Divider />

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      <Group>
        <Button loading={loading} onClick={handleSet} flex={1}>
          Apply
        </Button>
        <Tooltip label="Clear all">
          <ActionIcon
            color="red"
            size="lg"
            loading={loading}
            onClick={handleClear}
          >
            <IconEraser size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  );
}
