import { NavLink } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";

interface NavItemProps {
  icon: TablerIcon;
  label: string;
  expanded: boolean;
}

export function NavItem({ icon: Icon, label, expanded }: NavItemProps) {
  return (
    <NavLink
      label={expanded ? label : undefined}
      leftSection={<Icon size={20} stroke={1.5} />}
      styles={{
        root: { borderRadius: "var(--mantine-radius-sm)" },
        label: { fontSize: 14, fontWeight: 500 },
      }}
    />
  );
}
