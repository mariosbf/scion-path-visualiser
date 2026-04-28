import { useState } from "react";
import {
  MantineProvider,
  AppShell,
  Stack,
  ActionIcon,
  Divider,
  Box,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import "@mantine/core/styles.css";
import "./App.css";
import {
  IconFolderOpen,
  IconSettings,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";
import { NavHeader } from "./components/NavHeader";
import { NavItem } from "./components/NavItem";
import { TitleBar } from "./components/TitleBar";

type ColorScheme = "light" | "dark";

const NAV_ITEMS = [
  { icon: IconFolderOpen, label: "Projects" },
  { icon: IconSettings, label: "Settings" },
];

function App() {
  const [colorScheme, setColorScheme] = useState<ColorScheme>("dark");
  const [opened, { toggle }] = useDisclosure(true);

  return (
    <MantineProvider forceColorScheme={colorScheme}>
      <AppShell
        header={{ height: 32 }}
        navbar={{ width: opened ? 220 : 60, breakpoint: "sm" }}
        padding={0}
      >
        <AppShell.Header style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
          <TitleBar />
        </AppShell.Header>

        <AppShell.Navbar>
          <AppShell.Section>
            <NavHeader
              expanded={opened}
              onToggle={toggle}
            />
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
              style={{ display: "flex", justifyContent: opened ? "flex-start" : "center" }}
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                onClick={() =>
                  setColorScheme((s) => (s === "dark" ? "light" : "dark"))
                }
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

        <AppShell.Main />
      </AppShell>
    </MantineProvider>
  );
}

export default App;
