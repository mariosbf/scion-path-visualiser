import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ActionIcon, Box, Divider, Group, Stack, Text } from "@mantine/core";
import { IconArrowLeft, IconTrash } from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../../bindings";
import { TerminalOutput } from "../../components/TerminalOutput";
import useTopology from "../../hooks/useTopology";

interface LogOutputPayload {
  stream_id: string;
  line: string;
}

export function ServiceLogsRoute() {
  const navigate = useNavigate();
  const { serviceName } = useParams({ from: "/app/logs/$serviceName" });
  const topologyRes = useTopology();

  if (topologyRes !== undefined && topologyRes.status == "error") {
    navigate({ to: "/app/topology" });
  }
  const topology = topologyRes?.status === "ok" ? topologyRes.data : undefined;

  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const streamIdRef = useRef<string | null>(null);

  // Resolve AS ID and interface ID from topology for the meta strip
  let asId = "";
  let interfaceId: number | null = null;
  if (topology) {
    for (const link of topology.links) {
      if (link.a.router_name === serviceName) {
        asId = link.a.as_id;
        interfaceId = link.a.interface_id;
        break;
      }
      if (link.b.router_name === serviceName) {
        asId = link.b.as_id;
        interfaceId = link.b.interface_id;
        break;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function start() {
      const unlistenFn = await listen<LogOutputPayload>("log-output", (e) => {
        if (cancelled) return;
        if (e.payload.stream_id !== streamIdRef.current) return;
        setLines((prev) => {
          return [...prev, e.payload.line];
        });
      });

      if (cancelled) {
        unlistenFn();
        return;
      }
      unlisten = unlistenFn;

      const result = await commands.startLogStream(serviceName);
      if (result.status === "error") {
        if (!cancelled) setError(result.error);
        return;
      }
      if (cancelled) {
        // Cleanup already ran while startLogStream was in-flight; stop the orphaned stream.
        commands.stopLogStream(result.data).catch(() => { });
        return;
      }
      streamIdRef.current = result.data;
      setStreaming(true);
    }

    start();

    return () => {
      cancelled = true;
      unlisten?.();
      setStreaming(false);
      if (streamIdRef.current) {
        commands.stopLogStream(streamIdRef.current).catch((err: unknown) => {
          console.warn("stopLogStream failed:", err);
        });
        streamIdRef.current = null;
      }
    };
  }, [serviceName, navigate]);

  return (
    <Stack gap={0} style={{ height: "100%", overflow: "hidden" }}>
      {/* Header bar */}
      <Group
        px="md"
        py="xs"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => navigate({ to: "/app/topology" })}
          aria-label="Back to topology"
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Text fw={600} ff="monospace" size="sm">
          {serviceName}
        </Text>
        <Text size="sm" c="dimmed">
          Logs
        </Text>
        <Box
          ml="auto"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {streaming && (
            <>
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--mantine-color-green-5)",
                }}
              />
              <Text size="xs" c="green">
                Live
              </Text>
            </>
          )}
          <ActionIcon
            variant="default"
            onClick={() => setLines([])}
            aria-label="Clear logs"
            title="Clear logs"
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Box>
      </Group>

      {/* Meta strip */}
      <Group
        px="md"
        py={4}
        gap="xl"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        {asId && (
          <Text size="xs" c="dimmed">
            AS{" "}
            <Text span size="xs" ff="monospace">
              {asId}
            </Text>
          </Text>
        )}
        {interfaceId !== null && (
          <Text size="xs" c="dimmed">
            Interface{" "}
            <Text span size="xs" ff="monospace">
              {interfaceId}
            </Text>
          </Text>
        )}
        <Text size="xs" c="dimmed">
          logs/
          <Text span size="xs" ff="monospace">
            {serviceName}.log
          </Text>
        </Text>
      </Group>

      <Divider />

      {/* Log output */}
      <Box flex={1} p="md" style={{ minHeight: 0, overflow: "hidden" }}>
        {error ? (
          <Text c="red" size="sm">
            {error}
          </Text>
        ) : (
          <TerminalOutput lines={lines} h="100%" />
        )}
      </Box>
    </Stack>
  );
}
