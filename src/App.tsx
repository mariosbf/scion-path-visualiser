import { useState } from "react";
import {
  MantineProvider,
  AppShell,
  Stack,
  ActionIcon,
  Divider,
} from "@mantine/core";
import "@mantine/core/styles.css";
import {
  IconFolderOpen,
  IconSettings,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";
import { NavHeader } from "./components/NavHeader";
import { NavItem } from "./components/NavItem";

type ColorScheme = "light" | "dark";

const NAV_ITEMS = [
  { icon: IconFolderOpen, label: "Projects" },
  { icon: IconSettings, label: "Settings" },
];

function App() {
  const [colorScheme, setColorScheme] = useState<ColorScheme>("dark");
  const [opened, setOpened] = useState(true);

  return (
    <MantineProvider defaultColorScheme="dark" forceColorScheme={colorScheme}>
      <AppShell
        navbar={{ width: opened ? 220 : 60, breakpoint: "sm" }}
        padding={0}
      >
        <AppShell.Navbar>
          <Stack justify="space-between" style={{ height: "100%" }}>
            <div>
              <NavHeader
                expanded={opened}
                onToggle={() => setOpened((o) => !o)}
              />
              <Divider />
              <Stack gap={4} style={{ padding: "8px 4px" }}>
                {NAV_ITEMS.map((item) => (
                  <NavItem
                    key={item.label}
                    icon={item.icon}
                    label={item.label}
                    expanded={opened}
                  />
                ))}
              </Stack>
            </div>

            <div style={{ padding: "8px 8px 16px" }}>
              <Divider mb={8} />
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
            </div>
          </Stack>
        </AppShell.Navbar>

        <AppShell.Main />
      </AppShell>
    </MantineProvider>
  );
}

export default App;
