import {
  Alert,
  Box,
  Card,
  Loader,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { commands, type ScionPath, type Topology } from '../bindings';

interface Props {
  topology: Topology;
  onHover: (path: ScionPath | null) => void;
  onSelect: (path: ScionPath | null) => void;
  selectedPath: ScionPath | null;
}

export function PathSidebar({ topology, onHover, onSelect, selectedPath }: Props) {
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
      if (result.status === 'ok') {
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

  const dstOptions = asIds.filter((id) => id !== srcAs);

  return (
    <Box
      style={{
        width: 300,
        flexShrink: 0,
        borderLeft: '1px solid var(--mantine-color-default-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
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

      <Box style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {loading && (
          <Stack align="center" pt="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Fetching paths…</Text>
          </Stack>
        )}

        {error && (
          <Alert color="red" title="Error" mt="sm">
            {error}
          </Alert>
        )}

        {!loading && !error && paths.length === 0 && srcAs && dstAs && (
          <Text size="sm" c="dimmed" pt="sm">No paths found.</Text>
        )}

        <Stack gap="xs" pt="xs">
          {paths.map((path, i) => {
            const asCount = path.interfaces.length / 2 + 1;
            const expiry = new Date(path.expiry).toLocaleTimeString();
            const isSelected = selectedPath === path;

            return (
              <Card
                key={i}
                padding="sm"
                radius="sm"
                withBorder
                style={{
                  cursor: 'pointer',
                  backgroundColor: isSelected
                    ? 'var(--mantine-color-blue-light)'
                    : undefined,
                  borderColor: isSelected
                    ? 'var(--mantine-color-blue-5)'
                    : undefined,
                }}
                onMouseEnter={() => onHover(path)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(isSelected ? null : path)}
              >
                <Text size="sm" fw={500}>
                  Path {i + 1} — {asCount} AS{asCount !== 1 ? 'es' : ''}
                </Text>
                <Text size="xs" c="dimmed">Expires {expiry}</Text>
                <Text size="xs" c="dimmed">MTU {path.mtu} B</Text>
              </Card>
            );
          })}
        </Stack>
      </Box>
    </Box>
  );
}
