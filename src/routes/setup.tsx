import { useState, useEffect, useRef } from "react";
import {
  Button,
  Group,
  Text,
  Stack,
  ScrollArea,
  Image,
  Paper,
  Code,
  Box,
  Card,
  Flex,
  Divider,
  Radio,
  RadioIndicator,
  Title,
  Loader,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { commands } from "../bindings";
import { getRecent, pushRecent } from "../lib/store";
import { session } from "../lib/session";
import logo from "../assets/logo.png";
import classes from "./Setup.module.css";
import { IconArrowLeft } from "@tabler/icons-react";

interface WizardState {
  folder: string | null;
  topoFile: string | null;
}

const STEPS = ["Implementation", "Topology", "Loading"];
const STEP_LABELS = [
  "Select SCION Implementation",
  "Select Topology",
  "Loading",
];
const STEP_DESCS = [
  "Choose the root folder of your SCION project.",
  "Choose the topology file to load.",
  "Generating topology configuration…",
];

function BarStepper({ active }: { active: number }) {
  return (
    <Group gap={0} align="flex-start" grow>
      {STEPS.map((label, i) => (
        <Box key={i} style={{ paddingRight: i < STEPS.length - 1 ? 8 : 0 }}>
          <Box
            bg={i <= active ? "blue" : "white"}
            style={{
              height: 3,
              borderRadius: 2,
              marginBottom: 8,
            }}
          />
          <Text
            size="sm"
            fw={i === active ? 600 : 400}
            c={i > active ? "dimmed" : undefined}
          >
            {label}
          </Text>
        </Box>
      ))}
    </Group>
  );
}

export function SetupWizard() {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<WizardState>({
    folder: null,
    topoFile: null,
  });

  const nextStep = () => setActive((a) => a + 1);
  const prevStep = () => setActive((a) => Math.max(0, a - 1));
  const reset = () => {
    setState({ folder: null, topoFile: null });
    setActive(0);
  };

  const canNext = [state.folder !== null, state.topoFile !== null, true, false];

  const isLoading = active === 2;

  return (
    <Stack mih="100vh">
      {/* Top header */}
      <Box p="md" display="flex">
        <Group gap="sm">
          <Image src={logo} alt="SCION" style={{ height: 32 }} />
        </Group>
      </Box>

      {/* Content */}
      <Flex flex={1} w="100%" justify="center" align="center">
        <Card w="70%" maw="1200px" h="70vh">
          <Stack gap="xl">
            <BarStepper active={active} />

            <Stack gap="xs">
              <Title order={1} size="xl" fw={600}>
                {STEP_LABELS[active]}
              </Title>
              <Text size="sm" c="dimmed">
                {STEP_DESCS[active]}
              </Text>
            </Stack>

            <Box flex={1}>
              {active === 0 && (
                <FolderStep
                  selected={state.folder}
                  onSelect={(folder) => setState((s) => ({ ...s, folder }))}
                />
              )}
              {active === 1 && (
                <TopologyStep
                  folder={state.folder ?? ""}
                  selected={state.topoFile}
                  onSelect={(topoFile) => setState((s) => ({ ...s, topoFile }))}
                />
              )}
              {active === 2 && (
                <LoadingStep
                  folder={state.folder ?? ""}
                  topoFile={state.topoFile ?? ""}
                  onStartOver={reset}
                />
              )}
            </Box>
          </Stack>
        </Card>
      </Flex>

      {/* Bottom action bar */}
      {!isLoading && (
        <Stack gap={0}>
          <Divider />

          <Group p="md" justify="space-between" bg="dark">
            <Button
              variant="subtle"
              disabled={active === 0}
              onClick={prevStep}
              leftSection={<IconArrowLeft size={14} />}
            >
              Back
            </Button>
            <Button disabled={!canNext[active]} onClick={nextStep}>
              {active === 2 ? "Start" : "Next"}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

function PathRadioGroup({
  paths,
  selected,
  onSelect,
}: {
  paths: string[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <Radio.Group value={selected} onChange={onSelect}>
      <Stack gap="xs">
        {paths.map((p) => (
          <Radio.Card className={classes.radioCard} value={p} key={p} p="xs">
            <Group>
              <RadioIndicator />
              <Code bg="transparent">{p}</Code>
            </Group>
          </Radio.Card>
        ))}
      </Stack>
    </Radio.Group>
  );
}

function FolderStep({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (folder: string) => void;
}) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  useEffect(() => {
    getRecent("recent-folders").then(setRecentFolders);
  }, []);

  const browse = async () => {
    const folder = await open({
      directory: true,
      title: "Select SCION project folder",
    });
    if (folder && typeof folder === "string") onSelect(folder);
  };

  return (
    <Stack gap="sm" h="100%">
      <Button variant="default" onClick={browse}>
        Browse…
      </Button>
      {selected && (
        <Text size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
          Selected: {selected}
        </Text>
      )}
      {recentFolders.length > 0 && (
        <>
          <Text size="sm" fw={500}>
            Recent
          </Text>
          <ScrollArea h={200}>
            <PathRadioGroup
              paths={recentFolders}
              selected={selected}
              onSelect={onSelect}
            />
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}

function TopologyStep({
  folder,
  selected,
  onSelect,
}: {
  folder: string;
  selected: string | null;
  onSelect: (topoFile: string) => void;
}) {
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [recentTopos, setRecentTopos] = useState<string[]>([]);

  useEffect(() => {
    getRecent("recent-topologies").then(setRecentTopos);
    if (folder) {
      commands.listTopologyFiles(folder).then((result) => {
        if (result.status === "ok") setProjectFiles(result.data);
      });
    }
  }, [folder]);

  const browse = async () => {
    const file = await open({
      title: "Select topology file",
      filters: [{ name: "Topology", extensions: ["topo"] }],
    });
    if (file && typeof file === "string") onSelect(file);
  };

  return (
    <Stack gap="md">
      <Button variant="default" onClick={browse}>
        Browse…
      </Button>
      {selected && (
        <Text size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
          Selected: {selected}
        </Text>
      )}
      <Stack>
        <Text>In project:</Text>
        <ScrollArea h={150}>
          <PathRadioGroup
            paths={projectFiles}
            selected={selected}
            onSelect={onSelect}
          />
        </ScrollArea>
      </Stack>
      <Stack mt="md">
        <Text>Recent topologies:</Text>
        <ScrollArea h={150}>
          <PathRadioGroup
            paths={recentTopos}
            selected={selected}
            onSelect={onSelect}
          />
        </ScrollArea>
      </Stack>
    </Stack>
  );
}

function LoadingStep({
  folder,
  topoFile,
  onStartOver,
}: {
  folder: string;
  topoFile: string;
  onStartOver: () => void;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<string[]>([]);
  const [title, setTitle] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    let cancelled = false;
    let cleanupOutput: (() => void) | undefined;
    let cleanupPhase: (() => void) | undefined;

    async function run() {
      const unlistenOutput = await listen<string>("scion-setup-output", (e) => {
        if (cancelled) return;
        setLines((prev) => [...prev, e.payload]);
      });

      const unlistenPhase = await listen<string>("scion-setup-phase", (e) => {
        if (cancelled) return;
        setTitle(e.payload);
      });

      if (cancelled) {
        unlistenOutput();
        unlistenPhase();
        return;
      }
      cleanupOutput = unlistenOutput;
      cleanupPhase = unlistenPhase;

      const setupResult = await commands.setupScionNetwork(folder, topoFile);
      if (cancelled) return;
      if (setupResult.status === "error") {
        setError(setupResult.error);
        return;
      }

      const topoResult = await commands.loadProject(setupResult.data);
      if (cancelled) return;
      if (topoResult.status === "error") {
        setError(topoResult.error);
        return;
      }

      await pushRecent("recent-folders", folder);
      await pushRecent("recent-topologies", topoFile);
      session.setTopology(topoResult.data);
      navigate({ to: "/app/topology" });
    }

    run();

    return () => {
      cancelled = true;
      cleanupOutput?.();
      cleanupPhase?.();
    };
  }, [folder, topoFile, navigate]);

  if (error) {
    return (
      <Stack gap="md">
        <Text c="red" size="sm" style={{ wordBreak: "break-word" }}>
          {error}
        </Text>
        <Button variant="default" onClick={onStartOver}>
          Start Over
        </Button>
      </Stack>
    );
  }

  return (
    <ScrollArea h={500} viewportRef={viewportRef}>
      <Paper radius="md" withBorder style={{ overflow: "hidden" }}>
        <Group justify="space-between" p="sm" bg="gray.9">
          <Text size="sm">{title}</Text>
          <Loader size="xs" />
        </Group>
        <Divider />
        <Group gap={0} align="stretch">
          <Box
            py="sm"
            px="sm"
            bg="gray.9"
            style={{
              borderRight: "1px solid var(--mantine-color-gray-7)",
              userSelect: "none",
            }}
          >
            {lines.map((_, i) => (
              <Text
                key={i}
                size="xs"
                ff="monospace"
                c="dimmed"
                ta="right"
                lh={1.6}
              >
                {i + 1}
              </Text>
            ))}
          </Box>
          <Code block p="md" bg="gray.9" flex={1}>
            {lines.length > 0 ? lines.join("\n") : "Running…"}
          </Code>
        </Group>
      </Paper>
    </ScrollArea>
  );
}
