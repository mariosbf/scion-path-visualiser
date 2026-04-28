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
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { commands } from "../bindings";
import { getRecent, pushRecent } from "../lib/store";
import { session } from "../lib/session";
import logo from "../assets/logo.png";

interface WizardState {
  folder: string | null;
  topoFile: string | null;
}

const STEPS = ["Folder", "Topology", "Loading"];
const STEP_LABELS = ["Select Folder", "Select Topology", "Loading"];
const STEP_DESCS = [
  "Choose the root folder of your SCION project.",
  "Choose the topology file to load.",
  "Generating topology configuration…",
];

function BarStepper({ active }: { active: number }) {
  return (
    <Group gap={0} align="flex-start" grow mb="xl">
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
    <Box
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top header */}
      <Box
        style={{
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Group gap="sm">
          <Image src={logo} alt="SCION" style={{  height: 32 }} />
        </Group>
      </Box>

      {/* Content */}
      <Flex flex={1} w="100%" justify="center" align="center">
        <Card w="70%" maw="1200px">
          <BarStepper active={active} />

          <Text size="xl" fw={600} mb={4}>
            {STEP_LABELS[active]}
          </Text>
          <Text size="sm" c="dimmed" mb="xl">
            {STEP_DESCS[active]}
          </Text>

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
        </Card>
      </Flex>

      <Divider />

      {/* Bottom action bar */}
      {!isLoading && (
        <Group p="md" justify="space-between" bg="dark">
          <Button
            variant="subtle"
            disabled={active === 0}
            onClick={prevStep}
            leftSection={<span>←</span>}
          >
            Back
          </Button>
          <Button disabled={!canNext[active]} onClick={nextStep}>
            {active === 2 ? "Start" : "Next"}
          </Button>
        </Group>
      )}
    </Box>
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
    <Stack gap="md">
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
            <Stack gap={4}>
              {recentFolders.map((f) => (
                <Paper
                  key={f}
                  p="xs"
                  withBorder
                  style={{
                    cursor: "pointer",
                    outline:
                      selected === f
                        ? "2px solid var(--mantine-color-blue-filled)"
                        : undefined,
                  }}
                  onClick={() => onSelect(f)}
                >
                  <Text size="sm" style={{ wordBreak: "break-all" }}>
                    {f}
                  </Text>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}

function FileList({
  files,
  label,
  selected,
  onSelect,
}: {
  files: string[];
  label: string;
  selected: string | null;
  onSelect: (f: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <ScrollArea h={150}>
        <Stack gap={4}>
          {files.map((f) => (
            <Paper
              key={f}
              p="xs"
              withBorder
              style={{
                cursor: "pointer",
                outline:
                  selected === f
                    ? "2px solid var(--mantine-color-blue-filled)"
                    : undefined,
              }}
              onClick={() => onSelect(f)}
            >
              <Text size="sm" style={{ wordBreak: "break-all" }}>
                {f}
              </Text>
            </Paper>
          ))}
        </Stack>
      </ScrollArea>
    </>
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
      <FileList
        files={projectFiles}
        label="In project"
        selected={selected}
        onSelect={onSelect}
      />
      <FileList
        files={recentTopos}
        label="Recent"
        selected={selected}
        onSelect={onSelect}
      />
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
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    let cancelled = false;
    let cleanupUnlisten: (() => void) | undefined;

    async function run() {
      const unlistenFn = await listen<string>("topology-config-output", (e) => {
        if (cancelled) return;
        setLines((prev) => [...prev, e.payload]);
      });

      if (cancelled) {
        unlistenFn();
        return;
      }
      cleanupUnlisten = unlistenFn;

      const configResult = await commands.createTopologyConfig(
        folder,
        topoFile,
      );
      if (cancelled) return;
      if (configResult.status === "error") {
        setError(configResult.error);
        return;
      }

      const topoResult = await commands.loadProject(configResult.data);
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
      cleanupUnlisten?.();
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
    <ScrollArea h={300} viewportRef={viewportRef}>
      <Code
        block
        style={{
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 300,
        }}
      >
        {lines.length > 0 ? lines.join("\n") : "Running…"}
      </Code>
    </ScrollArea>
  );
}
