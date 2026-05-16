import { useState, useEffect } from "react";
import {
  Button,
  Group,
  Text,
  Stack,
  ScrollArea,
  Image,
  Code,
  Box,
  Card,
  Flex,
  Divider,
  Radio,
  RadioIndicator,
  Title,
  Switch,
  Select,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { commands, type AppConfig, type RunningMode } from "../bindings";

export const Route = createFileRoute("/setup")({
  beforeLoad: async () => {
    const result = await commands.getTopology();
    if (result.status === "ok") {
      throw redirect({ to: "/app/topology" });
    }
  },
  component: SetupWizard,
});
import { TerminalOutput } from "../components/TerminalOutput";
import { getRecent, pushRecent } from "../lib/store";
import logo from "../assets/logo.png";
import classes from "./Setup.module.css";
import { IconArrowLeft } from "@tabler/icons-react";

type WizardState = Omit<AppConfig, "scion_folder" | "topo_file"> & {
  scion_folder: string | null;
  topo_file: string | null;
};

const STEPS = [
  {
    label: "Implementation",
    desc: "Choose the root folder of your SCION project.",
  },
  {
    label: "Topology",
    desc: "Choose the topology file to load.",
  },
  {
    label: "Configuration",
    desc: "Choose how to run the topology.",
  },
  {
    label: "Loading",
    desc: "Setting everything up. This may take a few moments.",
  },
];

function BarStepper({ active }: { active: number }) {
  return (
    <Group gap={0} align="flex-start" grow>
      {STEPS.map((step, i) => (
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
            {step.label}
          </Text>
        </Box>
      ))}
    </Group>
  );
}

export function SetupWizard() {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<WizardState>({
    scion_folder: null,
    topo_file: null,
    run_topology: true,
    running_mode: "Supervisord",
  });

  const nextStep = () => setActive((a) => a + 1);
  const prevStep = () => setActive((a) => Math.max(0, a - 1));
  const reset = () => {
    setState({
      scion_folder: null,
      topo_file: null,
      run_topology: true,
      running_mode: "Supervisord",
    });
    setActive(0);
  };

  const canNext = [
    state.scion_folder !== null,
    state.topo_file !== null,
    true,
    true,
    false,
  ];

  const isLoading = active === 3;

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
          <Stack>
            <BarStepper active={active} />

            <Stack gap="xs">
              <Title order={1} size="xl" fw={600}>
                {STEPS[active].label}
              </Title>
              <Text size="sm" c="dimmed">
                {STEPS[active].desc}
              </Text>
            </Stack>

            <Box flex={1}>
              {active === 0 && (
                <FolderStep
                  selected={state.scion_folder}
                  onSelect={(folder) =>
                    setState((s) => ({ ...s, scion_folder: folder }))
                  }
                />
              )}
              {active === 1 && (
                <TopologyStep
                  folder={state.scion_folder ?? ""}
                  selected={state.topo_file}
                  onSelect={(topoFile) =>
                    setState((s) => ({ ...s, topo_file: topoFile }))
                  }
                />
              )}
              {active === 2 && (
                <ConfigStep
                  runTopology={state.run_topology}
                  runningMode={state.running_mode}
                  onRunTopologyChange={(v) =>
                    setState((s) => ({ ...s, run_topology: v }))
                  }
                  onRunningModeChange={(v) =>
                    setState((s) => ({
                      ...s,
                      running_mode: v ?? "Supervisord",
                    }))
                  }
                />
              )}
              {active === 3 && (
                <LoadingStep config={state as AppConfig} onStartOver={reset} />
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
    getRecent("recent-scion-folders").then(setRecentFolders);
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

  useEffect(() => {
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
        <Text>In project</Text>
        <ScrollArea h={400}>
          <PathRadioGroup
            paths={projectFiles}
            selected={selected}
            onSelect={onSelect}
          />
        </ScrollArea>
      </Stack>
    </Stack>
  );
}

function ConfigStep({
  runTopology,
  runningMode,
  onRunTopologyChange,
  onRunningModeChange,
}: {
  runTopology: boolean;
  runningMode: RunningMode;
  onRunTopologyChange: (v: boolean) => void;
  onRunningModeChange: (v: RunningMode | null) => void;
}) {
  return (
    <Stack gap="md">
      <Switch
        label="Run topology"
        checked={runTopology}
        onChange={(e) => onRunTopologyChange(e.currentTarget.checked)}
      />
      <Select
        label="Select running configuration"
        data={["Docker", "Supervisord"]}
        value={runningMode}
        onChange={onRunningModeChange}
        disabled={!runTopology}
      />
    </Stack>
  );
}

function LoadingStep({
  config,
  onStartOver,
}: {
  config: AppConfig;
  onStartOver: () => void;
}) {
  const navigate = useNavigate();
  const [lines, setLines] = useState<string[]>([]);
  const [title, setTitle] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);

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

      const setupResult = await commands.setupScionNetwork(config);
      if (cancelled) return;
      if (setupResult.status === "error") {
        setError(setupResult.error);
        return;
      }

      const topoResult = await commands.getTopology();
      if (cancelled) return;
      if (topoResult.status === "error") {
        setError(topoResult.error);
        return;
      }

      await pushRecent("recent-scion-folders", config.scion_folder);
      navigate({ to: "/app/topology" });
    }

    run();

    return () => {
      cancelled = true;
      cleanupOutput?.();
      cleanupPhase?.();
    };
  }, [config, navigate]);

  if (error) {
    return (
      <Stack gap="md">
        <TerminalOutput lines={lines} h={450} />
        <Text c="red" size="sm" style={{ wordBreak: "break-word" }}>
          {error}
        </Text>
        <Button variant="default" onClick={onStartOver}>
          Start Over
        </Button>
      </Stack>
    );
  }

  return <TerminalOutput lines={lines} title={title} loading h={540} />;
}
