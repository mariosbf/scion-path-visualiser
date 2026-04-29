import {
  AppShell,
  Divider,
  Group,
  MantineProvider,
  Stack,
} from "@mantine/core";
import "@mantine/core/styles.css";
import { useDisclosure } from "@mantine/hooks";
import { IconFolderOpen, IconSettings } from "@tabler/icons-react";
import { useState } from "react";
import "./App.css";
import { NavHeader } from "./components/NavHeader";
import { NavItem } from "./components/NavItem";
import { TitleBar } from "./components/TitleBar";

type ColorScheme = "light" | "dark";

const NAV_ITEMS = [
  { icon: IconFolderOpen, label: "Projects" },
  { icon: IconSettings, label: "Settings" },
];

function App() {
  const [colorScheme, _] = useState<ColorScheme>("dark");
  const [opened, { toggle }] = useDisclosure(true);

  return (
    <MantineProvider forceColorScheme={colorScheme}>
      <AppShell
        header={{ height: 30 }}
        navbar={{ width: opened ? 220 : 60, breakpoint: "sm" }}
        padding={0}
      >
        <AppShell.Header bg="dark">
          <TitleBar />
        </AppShell.Header>

        <Group pos="absolute" top={0} right={0}>
          Hello
        </Group>

        <AppShell.Navbar>
          <AppShell.Section>
            <NavHeader expanded={opened} onToggle={toggle} />
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
          </AppShell.Section>
        </AppShell.Navbar>

        <AppShell.Main />
      </AppShell>
    </MantineProvider>
  );
}

export default App;
