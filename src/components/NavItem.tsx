import { NavLink } from "@mantine/core";
import type { IconProps } from "@tabler/icons-react";

interface NavItemProps {
  icon: React.FC<IconProps>;
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
