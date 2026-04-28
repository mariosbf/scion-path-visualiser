import { Group, Text, ActionIcon } from "@mantine/core";
import { IconMinus, IconSquare, IconX } from "@tabler/icons-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

export function TitleBar() {

  return (
    <Group
      data-tauri-drag-region
      h="100%"
      px={8}
      gap={0}
      style={{ userSelect: "none" }}
    >
      <Text
        size="xs"
        c="dimmed"
        fw={500}
        px={4}
        style={{ letterSpacing: 0.3 }}
      >
        SCION Visualiser
      </Text>

      <div style={{ flex: 1, height: "100%" }} />

      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        onClick={() => win.minimize()}
        aria-label="Minimise"
      >
        <IconMinus size={14} stroke={1.5} />
      </ActionIcon>

      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        onClick={() => win.toggleMaximize()}
        aria-label="Maximise"
      >
        <IconSquare size={14} stroke={1.5} />
      </ActionIcon>

      <ActionIcon
        data-close-btn
        variant="subtle"
        color="gray"
        size="md"
        onClick={() => win.close()}
        aria-label="Close"
      >
        <IconX size={14} stroke={1.5} />
      </ActionIcon>
    </Group>
  );
}
