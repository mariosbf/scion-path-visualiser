import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useMemo, useState } from "react";
import type { NetCondParams, Topology } from "../../bindings";
import { commands } from "../../bindings";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  topology: Topology;
}

interface BulkTarget {
  key: string;
  asId: string;
  routerName: string;
  interfaceId: number;
}

interface FieldToggleState {
  delay: boolean;
  rate: boolean;
  loss: boolean;
  dup: boolean;
  corrupt: boolean;
  reorder: boolean;
  mtu: boolean;
}

const DEFAULT_ENABLED_FIELDS: FieldToggleState = {
  delay: false,
  rate: false,
  loss: false,
  dup: false,
  corrupt: false,
  reorder: false,
  mtu: false,
};

function getTargetLabel(target: BulkTarget) {
  return `${target.routerName} / if ${target.interfaceId}`;
}

export function BulkTrafficControlDrawer({
  topology,
  opened,
  onClose,
  ...drawerProps
}: Props) {
  const targets: BulkTarget[] = [];
  for (const [asId, asInfo] of Object.entries(topology.ases)) {
    for (const router of asInfo.border_routers) {
      for (const interfaceId of Object.keys(router.interfaces)) {
        targets.push({
          key: `${router.name}:${interfaceId}`,
          asId,
          routerName: router.name,
          interfaceId: Number(interfaceId),
        });
      }
    }
  }

  return (
    <Drawer
      {...drawerProps}
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title="Bulk Traffic Control"
      styles={{ body: { paddingTop: 8 } }}
    >
      <BulkTrafficControlContent
        opened={opened}
        onClose={onClose}
        targets={targets}
      />
    </Drawer>
  );
}

function BulkTrafficControlContent({
  opened,
  onClose,
  targets,
}: {
  opened: boolean | undefined;
  onClose: () => void;
  targets: BulkTarget[];
}) {
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [enabledFields, setEnabledFields] = useState<FieldToggleState>(
    DEFAULT_ENABLED_FIELDS,
  );
  const [delay, setDelay] = useState<number | string>("");
  const [loss, setLoss] = useState(0);
  const [rate, setRate] = useState<number | string>("");
  const [dup, setDup] = useState(0);
  const [corrupt, setCorrupt] = useState(0);
  const [reorder, setReorder] = useState(0);
  const [mtu, setMtu] = useState<number | string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const allTargetKeys = useMemo(
    () => targets.map((target) => target.key),
    [targets],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  const groupedTargets = useMemo(() => {
    const groups = new Map<
      string,
      {
        asId: string;
        routers: Map<string, BulkTarget[]>;
      }
    >();

    for (const target of targets) {
      if (
        normalizedQuery &&
        !`${target.asId} ${target.routerName} ${target.interfaceId}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        continue;
      }

      const asGroup = groups.get(target.asId) ?? {
        asId: target.asId,
        routers: new Map<string, BulkTarget[]>(),
      };

      const routerTargets = asGroup.routers.get(target.routerName) ?? [];
      routerTargets.push(target);
      asGroup.routers.set(target.routerName, routerTargets);
      groups.set(target.asId, asGroup);
    }

    return Array.from(groups.values()).map((group) => ({
      asId: group.asId,
      routers: Array.from(group.routers.entries()).map(
        ([routerName, routerTargets]) => ({
          routerName,
          targets: routerTargets.sort((a, b) => a.interfaceId - b.interfaceId),
        }),
      ),
    }));
  }, [normalizedQuery, targets]);

  useEffect(() => {
    if (!opened) return;

    setQuery("");
    setSelectedKeys(allTargetKeys);
    setEnabledFields(DEFAULT_ENABLED_FIELDS);
    setDelay("");
    setLoss(0);
    setRate("");
    setDup(0);
    setCorrupt(0);
    setReorder(0);
    setMtu("");
    setError(null);
    setSuccess(null);
  }, [opened, allTargetKeys]);

  const toggleSelection = (keys: string[], checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return allTargetKeys.filter((key) => next.has(key));
    });
  };

  const setFieldEnabled = (field: keyof FieldToggleState, checked: boolean) => {
    setEnabledFields((current) => ({ ...current, [field]: checked }));
  };

  const enableField = (field: keyof FieldToggleState) => {
    setEnabledFields((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  };

  const buildParams = (): NetCondParams | null => {
    if (!Object.values(enabledFields).some(Boolean)) {
      setError("Enable at least one field to apply.");
      return null;
    }

    if (enabledFields.delay && typeof delay !== "number") {
      setError("Delay must be set when enabled.");
      return null;
    }
    if (enabledFields.rate && typeof rate !== "number") {
      setError("Rate must be set when enabled.");
      return null;
    }
    if (enabledFields.mtu && typeof mtu !== "number") {
      setError("MTU must be set when enabled.");
      return null;
    }

    return {
      delay_ms: enabledFields.delay && typeof delay === "number" ? delay : null,
      loss_percent: enabledFields.loss ? loss : null,
      rate_kbps: enabledFields.rate && typeof rate === "number" ? rate : null,
      duplicate_percent: enabledFields.dup ? dup : null,
      corrupt_percent: enabledFields.corrupt ? corrupt : null,
      reorder_percent: enabledFields.reorder ? reorder : null,
      mtu: enabledFields.mtu && typeof mtu === "number" ? mtu : null,
    };
  };

  const handleApply = async () => {
    if (selectedKeys.length === 0) {
      setError("Select at least one interface.");
      return;
    }

    const params = buildParams();
    if (!params) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    const errors = (
      await Promise.all(
        targets
          .filter((target) => selectedKeySet.has(target.key))
          .map(async (target) => {
            try {
              const result = await commands.netcondSet(
                target.routerName,
                target.interfaceId,
                params,
              );
              if (result.status === "error") {
                return `${getTargetLabel(target)}: ${result.error}`;
              }
              return null;
            } catch (cause) {
              return `${getTargetLabel(target)}: ${cause instanceof Error ? cause.message : String(cause)}`;
            }
          }),
      )
    ).filter((value): value is string => value !== null);

    setLoading(false);
    if (errors.length > 0) {
      setError(errors.slice(0, 3).join(" | "));
      return;
    }

    setSuccess(`Applied traffic control to ${selectedKeys.length} interfaces.`);
  };

  useHotkeys([["mod + enter", () => void handleApply()]], []);

  const handleClearSelected = async () => {
    if (selectedKeys.length === 0) {
      setError("Select at least one interface.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const errors = (
      await Promise.all(
        targets
          .filter((target) => selectedKeySet.has(target.key))
          .map(async (target) => {
            try {
              const result = await commands.netcondClear(
                target.routerName,
                target.interfaceId,
              );
              if (result.status === "error") {
                return `${getTargetLabel(target)}: ${result.error}`;
              }
              return null;
            } catch (cause) {
              return `${getTargetLabel(target)}: ${cause instanceof Error ? cause.message : String(cause)}`;
            }
          }),
      )
    ).filter((value): value is string => value !== null);

    setLoading(false);
    if (errors.length > 0) {
      setError(errors.slice(0, 3).join(" | "));
      return;
    }

    setSuccess(`Cleared traffic control on ${selectedKeys.length} interfaces.`);
  };

  const renderSliderField = (
    label: string,
    field: keyof FieldToggleState,
    value: number,
    onChange: (next: number) => void,
  ) => (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={700}>
          {label}
        </Text>
        <Switch
          checked={enabledFields[field]}
          label="Apply"
          onChange={(event) =>
            setFieldEnabled(field, event.currentTarget.checked)
          }
        />
      </Group>
      <Slider
        defaultValue={0}
        marks={[
          { value: 20, label: "20%" },
          { value: 50, label: "50%" },
          { value: 80, label: "80%" },
        ]}
        label={(sliderValue) => `${sliderValue} %`}
        value={value}
        onChange={(next) => {
          enableField(field);
          onChange(next);
        }}
        mb="md"
      />
    </Stack>
  );

  const visibleKeys = groupedTargets.flatMap((group) =>
    group.routers.flatMap((router) =>
      router.targets.map((target) => target.key),
    ),
  );
  const visibleSelectedCount = visibleKeys.filter((key) =>
    selectedKeySet.has(key),
  ).length;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end">
        <div>
          <Text fw={700}>Targets</Text>
          <Text c="dimmed" size="sm">
            {selectedKeys.length} of {targets.length} interfaces selected
          </Text>
        </div>
        <Group gap="xs">
          <Button
            variant="default"
            onClick={() => setSelectedKeys(allTargetKeys)}
          >
            Select all
          </Button>
          <Button variant="default" onClick={() => setSelectedKeys([])}>
            Clear selection
          </Button>
        </Group>
      </Group>

      <TextInput
        leftSection={<IconSearch size={16} />}
        placeholder="Filter by AS, router, or interface"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />

      <Paper withBorder p="sm" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Checkbox
              checked={
                visibleKeys.length > 0 &&
                visibleSelectedCount === visibleKeys.length
              }
              indeterminate={
                visibleSelectedCount > 0 &&
                visibleSelectedCount < visibleKeys.length
              }
              label={
                normalizedQuery
                  ? `Select filtered interfaces (${visibleKeys.length})`
                  : "Select all interfaces"
              }
              onChange={(event) =>
                toggleSelection(visibleKeys, event.currentTarget.checked)
              }
            />
            {normalizedQuery && (
              <Text c="dimmed" size="sm">
                {visibleKeys.length} matches
              </Text>
            )}
          </Group>

          <ScrollArea h={300} offsetScrollbars>
            <Stack gap="md">
              {groupedTargets.length === 0 && (
                <Text c="dimmed" size="sm">
                  No interfaces match the current filter.
                </Text>
              )}

              {groupedTargets.map((group) => {
                const groupKeys = group.routers.flatMap((router) =>
                  router.targets.map((target) => target.key),
                );
                const groupSelectedCount = groupKeys.filter((key) =>
                  selectedKeySet.has(key),
                ).length;

                return (
                  <Paper key={group.asId} withBorder p="sm" radius="md">
                    <Stack gap="sm">
                      <Checkbox
                        checked={
                          groupKeys.length > 0 &&
                          groupSelectedCount === groupKeys.length
                        }
                        indeterminate={
                          groupSelectedCount > 0 &&
                          groupSelectedCount < groupKeys.length
                        }
                        label={`AS ${group.asId} (${groupSelectedCount}/${groupKeys.length})`}
                        onChange={(event) =>
                          toggleSelection(
                            groupKeys,
                            event.currentTarget.checked,
                          )
                        }
                      />

                      {group.routers.map((router) => {
                        const routerKeys = router.targets.map(
                          (target) => target.key,
                        );
                        const routerSelectedCount = routerKeys.filter((key) =>
                          selectedKeySet.has(key),
                        ).length;

                        return (
                          <Paper
                            withBorder
                            key={`${group.asId}-${router.routerName}`}
                            p="sm"
                            radius="sm"
                          >
                            <Stack gap="xs">
                              <Checkbox
                                checked={
                                  routerKeys.length > 0 &&
                                  routerSelectedCount === routerKeys.length
                                }
                                indeterminate={
                                  routerSelectedCount > 0 &&
                                  routerSelectedCount < routerKeys.length
                                }
                                label={`Router ${router.routerName} (${routerSelectedCount}/${routerKeys.length} interfaces)`}
                                onChange={(event) =>
                                  toggleSelection(
                                    routerKeys,
                                    event.currentTarget.checked,
                                  )
                                }
                              />

                              <Stack gap={6} pl="md">
                                {router.targets.map((target) => (
                                  <Checkbox
                                    key={target.key}
                                    checked={selectedKeySet.has(target.key)}
                                    label={`Interface ${target.interfaceId}`}
                                    onChange={(event) =>
                                      toggleSelection(
                                        [target.key],
                                        event.currentTarget.checked,
                                      )
                                    }
                                  />
                                ))}
                              </Stack>
                            </Stack>
                          </Paper>
                        );
                      })}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </ScrollArea>
        </Stack>
      </Paper>

      <Divider />

      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Text fw={700}>Conditions to apply</Text>
          <Text c="dimmed" size="sm">
            Existing values stay unchanged unless a field is enabled here.
          </Text>
        </Group>

        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={700}>
              Delay (ms)
            </Text>
            <Switch
              checked={enabledFields.delay}
              label="Apply"
              onChange={(event) =>
                setFieldEnabled("delay", event.currentTarget.checked)
              }
            />
          </Group>
          <NumberInput
            placeholder="e.g. 50"
            min={0}
            value={delay}
            onFocus={() => enableField("delay")}
            onChange={(value) => {
              enableField("delay");
              setDelay(value);
            }}
          />
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={700}>
              Rate (kbps)
            </Text>
            <Switch
              checked={enabledFields.rate}
              label="Apply"
              onChange={(event) =>
                setFieldEnabled("rate", event.currentTarget.checked)
              }
            />
          </Group>
          <NumberInput
            placeholder="e.g. 10000"
            min={0}
            value={rate}
            onFocus={() => enableField("rate")}
            onChange={(value) => {
              enableField("rate");
              setRate(value);
            }}
          />
        </Stack>

        <Divider />

        {renderSliderField("Packet loss (%)", "loss", loss, setLoss)}

        <Divider />

        {renderSliderField("Duplicate (%)", "dup", dup, setDup)}

        <Divider />

        {renderSliderField("Corrupt (%)", "corrupt", corrupt, setCorrupt)}

        <Divider />

        {renderSliderField("Reorder (%)", "reorder", reorder, setReorder)}

        <Divider />

        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={700}>
              MTU (bytes)
            </Text>
            <Switch
              checked={enabledFields.mtu}
              label="Apply"
              onChange={(event) =>
                setFieldEnabled("mtu", event.currentTarget.checked)
              }
            />
          </Group>
          <NumberInput
            placeholder="e.g. 1300"
            min={1280}
            max={9000}
            value={mtu}
            onFocus={() => enableField("mtu")}
            onChange={(value) => {
              enableField("mtu");
              setMtu(value);
            }}
          />
        </Stack>
      </Stack>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      {success && (
        <Alert color="green" variant="light">
          <Text size="sm">{success}</Text>
        </Alert>
      )}

      <Group>
        <Button loading={loading} onClick={handleApply} flex={1}>
          Apply to {selectedKeys.length} interfaces
        </Button>
        <Button
          color="red"
          loading={loading}
          variant="light"
          onClick={handleClearSelected}
        >
          Clear selected
        </Button>
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
      </Group>
    </Stack>
  );
}
