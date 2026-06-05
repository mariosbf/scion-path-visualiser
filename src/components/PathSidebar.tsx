import {
  Alert,
  Box,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { commands, type ScionPath, type Topology } from "../bindings";
import { computePathNetStats, type PathNetStats } from "../lib/paths";

interface Props {
  topology: Topology;
  onHover: (path: ScionPath | null) => void;
  onSelect: (path: ScionPath | null) => void;
  selectedPath: ScionPath | null;
}

export function PathSidebar({
  topology,
  onHover,
  onSelect,
  selectedPath,
}: Props) {
  const asIds = Object.keys(topology.ases).sort();

  const [srcAs, setSrcAs] = useState<string | null>(null);
  const [dstAs, setDstAs] = useState<string | null>(null);
  const [paths, setPaths] = useState<ScionPath[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!srcAs || !dstAs) {
      setPaths([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    commands.getPaths(srcAs, dstAs).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") {
        setPaths(result.data);
      } else {
        setError(result.error);
        setPaths([]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [srcAs, dstAs]);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const dstOptions = asIds.filter((id) => id !== srcAs);

  return (
    <Box
      style={{
        width: 300,
        flexShrink: 0,
        border: "1px solid var(--mantine-color-default-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stack gap="sm" p="md" style={{ flexShrink: 0 }}>
        <Select
          label="Source AS"
          placeholder="Pick source AS"
          data={asIds}
          value={srcAs}
          onChange={(v) => {
            setSrcAs(v);
            if (v === dstAs) setDstAs(null);
            onSelect(null);
          }}
          searchable
        />
        <Select
          label="Destination AS"
          placeholder="Pick destination AS"
          data={dstOptions}
          value={dstAs}
          onChange={(v) => {
            setDstAs(v);
            onSelect(null);
          }}
          disabled={!srcAs}
          searchable
        />
      </Stack>

      <Box style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {loading && (
          <Stack align="center" pt="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Fetching paths…
            </Text>
          </Stack>
        )}

        {error && (
          <Alert color="red" title="Error" mt="sm">
            {error}
          </Alert>
        )}

        {!loading && !error && paths.length === 0 && srcAs && dstAs && (
          <Text size="sm" c="dimmed" pt="sm">
            No paths found.
          </Text>
        )}

        <Stack gap="xs" pt="xs">
          {paths.map((path, i) => {
            const asCount = path.interfaces.length / 2 + 1;
            const expiry = new Date(path.expiry).toLocaleTimeString();
            const isSelected = selectedPath === path;
            const stats: PathNetStats = computePathNetStats(path, topology);

            return (
              <Card
                key={i}
                padding="sm"
                radius="sm"
                withBorder
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected
                    ? "var(--mantine-color-blue-light)"
                    : hoveredIndex === i
                      ? "var(--mantine-color-default-hover)"
                      : undefined,
                  borderColor: isSelected
                    ? "var(--mantine-color-blue-5)"
                    : undefined,
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={() => {
                  onHover(path);
                  setHoveredIndex(i);
                }}
                onMouseLeave={() => {
                  onHover(null);
                  setHoveredIndex(null);
                }}
                onClick={() => onSelect(isSelected ? null : path)}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      Path {i + 1} — {asCount} AS{asCount !== 1 ? "es" : ""}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Expires {expiry}
                    </Text>
                    {stats.mtu !== undefined && (
                      <Text size="xs" c="dimmed">
                        MTU {stats.mtu}
                      </Text>
                    )}
                    {stats.delay_ms !== undefined && (
                      <Text size="xs" c="dimmed">
                        Latency {stats.delay_ms} ms
                      </Text>
                    )}
                    {stats.rate_kbps !== undefined && (
                      <Text size="xs" c="dimmed">
                        Bandwidth {`${stats.rate_kbps} kbps`}
                      </Text>
                    )}
                    {stats.loss_percent !== undefined && (
                      <Text size="xs" c="dimmed">
                        Loss {`${stats.loss_percent.toFixed(2)} %`}
                      </Text>
                    )}
                    {stats.duplicate_percent !== undefined && (
                      <Text size="xs" c="dimmed">
                        Duplication {`${stats.duplicate_percent.toFixed(2)} %`}
                      </Text>
                    )}
                    {stats.corrupt_percent !== undefined && (
                      <Text size="xs" c="dimmed">
                        Corruption {`${stats.corrupt_percent.toFixed(2)} %`}
                      </Text>
                    )}
                  </Stack>
                </Group>
              </Card>
            );
          })}
        </Stack>
      </Box>
    </Box>
  );
}
