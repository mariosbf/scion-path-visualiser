import { Outlet } from "@tanstack/react-router";
import {
  AppShell,
  Stack,
  ActionIcon,
  Divider,
  Box,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconFolderOpen,
  IconSettings,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";
import { NavHeader } from "../components/NavHeader";
import { NavItem } from "../components/NavItem";

const NAV_ITEMS = [
  { icon: IconFolderOpen, label: "Projects" },
  { icon: IconSettings, label: "Settings" },
];

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure(true);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  return (
    <AppShell navbar={{ width: opened ? 220 : 60, breakpoint: "sm" }} padding={0}>
      <AppShell.Navbar>
        <AppShell.Section>
          <NavHeader expanded={opened} onToggle={toggle} />
          <Divider />
        </AppShell.Section>
        <AppShell.Section grow>
          <Stack gap={4} p={4}>
            {NAV_ITEMS.map((item) => (
              <NavItem
                key={item.label}
                icon={item.icon}
                label={item.label}
                expanded={opened}
              />
            ))}
          </Stack>
        </AppShell.Section>
        <AppShell.Section>
          <Divider mb={8} />
          <Box
            p={8}
            pb={16}
            style={{
              display: "flex",
              justifyContent: opened ? "flex-start" : "center",
            }}
          >
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={toggleColorScheme}
              aria-label="Toggle color scheme"
            >
              {colorScheme === "dark" ? (
                <IconSun size={20} stroke={1.5} />
              ) : (
                <IconMoon size={20} stroke={1.5} />
              )}
            </ActionIcon>
          </Box>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main style={{ height: "100vh" }}>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
