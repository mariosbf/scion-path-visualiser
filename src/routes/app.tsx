import { AppShell, Box, Divider, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowLoopLeft,
  IconTopologyComplex,
  TablerIcon,
} from "@tabler/icons-react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NavHeader } from "../components/NavHeader";
import { NavItem } from "../components/NavItem";
import { RestartNetworkButton } from "../components/RestartNetworkButton";
import { FileRouteTypes } from "../routeTree.gen";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

const NAV_ITEMS: Array<{
  icon: TablerIcon;
  label: string;
  link: FileRouteTypes["fullPaths"];
}> = [
    { icon: IconTopologyComplex, label: "Topology", link: "/app/topology" },
    { icon: IconArrowLoopLeft, label: "Paths", link: "/app/paths" },
  ];

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure(true);

  return (
    <Box pos="relative" style={{ height: "100vh" }}>
      <AppShell
        navbar={{ width: opened ? 220 : 60, breakpoint: "sm" }}
        padding={0}
      >
        <AppShell.Navbar>
          <AppShell.Section>
            <NavHeader expanded={opened} onToggle={toggle} />
            <Divider />
          </AppShell.Section>
          <AppShell.Section grow>
            <Stack gap={4} p={4}>
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.label} {...item} expanded={opened} />
              ))}
            </Stack>
          </AppShell.Section>
          <AppShell.Section>
            <Divider mb={8} />
            <Box p={4} mb={5}>
              <RestartNetworkButton expanded={opened} />
            </Box>
          </AppShell.Section>
        </AppShell.Navbar>
        <AppShell.Main style={{ height: "100vh" }}>
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </Box>
  );
}
