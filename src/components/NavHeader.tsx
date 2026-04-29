import { Group, Text, ActionIcon } from "@mantine/core";
import { IconLayoutSidebar } from "@tabler/icons-react";

interface NavHeaderProps {
  expanded: boolean;
  onToggle: () => void;
}

export function NavHeader({ expanded, onToggle }: NavHeaderProps) {
  return (
    <Group
      justify={expanded ? "space-between" : "center"}
      style={{ padding: "12px 8px", height: 50 }}
    >
      {expanded && (
        <Text fw={700} size="lg" style={{ letterSpacing: -0.5 }}>
          SCION Visualiser
        </Text>
      )}
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        onClick={onToggle}
        aria-label="Toggle sidebar"
      >
        <IconLayoutSidebar size={20} stroke={1.5} />
      </ActionIcon>
    </Group>
  );
}
