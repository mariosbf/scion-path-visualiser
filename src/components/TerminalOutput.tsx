import { useEffect, useRef } from "react";
import {
  Box,
  Code,
  Divider,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Text,
} from "@mantine/core";

interface TerminalOutputProps {
  lines: string[];
  title?: string;
  loading?: boolean;
  height?: number | string;
}

export function TerminalOutput({ lines, title, loading, height }: TerminalOutputProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <ScrollArea h={height ?? 500} viewportRef={viewportRef}>
      <Paper radius="md" withBorder style={{ overflow: "hidden" }}>
        {title !== undefined && (
          <>
            <Group justify="space-between" p="sm" bg="gray.9">
              <Text size="sm">{title}</Text>
              {loading && <Loader size="xs" />}
            </Group>
            <Divider />
          </>
        )}
        <Group gap={0} align="stretch">
          <Box
            py="sm"
            px="sm"
            bg="gray.9"
            style={{
              borderRight: "1px solid var(--mantine-color-gray-7)",
              userSelect: "none",
            }}
          >
            {lines.map((_, i) => (
              <Text
                key={i}
                size="xs"
                ff="monospace"
                c="dimmed"
                ta="right"
                lh={1.6}
              >
                {i + 1}
              </Text>
            ))}
          </Box>
          <Code block p="md" bg="gray.9" flex={1}>
            {lines.length > 0 ? lines.join("\n") : "Running…"}
          </Code>
        </Group>
      </Paper>
    </ScrollArea>
  );
}
