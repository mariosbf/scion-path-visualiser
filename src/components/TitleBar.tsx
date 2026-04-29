import { Group, ActionIcon } from "@mantine/core";
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
      justify="right"
    >
      <Group gap={2}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => win.minimize()}
          aria-label="Minimise"
        >
          <IconMinus size={12} stroke={1.5} />
        </ActionIcon>

        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => win.toggleMaximize()}
          aria-label="Maximise"
        >
          <IconSquare size={12} stroke={1.5} />
        </ActionIcon>

        <ActionIcon
          data-close-btn
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => win.close()}
          aria-label="Close"
        >
          <IconX size={12} stroke={1.5} />
        </ActionIcon>
      </Group>
    </Group>
  );
}
