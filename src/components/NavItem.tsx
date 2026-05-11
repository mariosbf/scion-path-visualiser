import { NavLink } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import { FileRouteTypes } from "../routeTree.gen";

export interface NavItemProps {
  icon: TablerIcon;
  label: string;
  expanded: boolean;
  link: FileRouteTypes["fullPaths"];
}

export function NavItem({ link, icon: Icon, label, expanded }: NavItemProps) {
  return (
    <NavLink
      label={expanded ? label : undefined}
      leftSection={<Icon size={20} stroke={1.5} />}
      href={link}
      styles={{
        root: { borderRadius: "var(--mantine-radius-sm)" },
        label: { fontSize: 14, fontWeight: 500 },
      }}
    />
  );
}
