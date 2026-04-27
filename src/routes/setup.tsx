import { useState, useEffect, useRef } from "react";
import {
  Stepper,
  Button,
  Group,
  Text,
  Stack,
  ScrollArea,
  Paper,
  Code,
  Box,
  Center,
} from "@mantine/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { commands } from "../bindings";
import { getRecent, pushRecent } from "../lib/store";
import { session } from "../lib/session";

interface WizardState {
  folder: string | null;
  topoFile: string | null;
}

export function SetupWizard() {
  const [active, setActive] = useState(0);
  const [state, setState] = useState<WizardState>({
    folder: null,
    topoFile: null,
  });

  const nextStep = () => setActive((a) => a + 1);
  const prevStep = () => setActive((a) => Math.max(0, a - 1));

  return (
    <Center style={{ minHeight: "100vh" }} p="xl">
      <Box style={{ width: "100%", maxWidth: 640 }}>
        <Stepper active={active} allowNextStepsSelect={false} mb="xl">
          <Stepper.Step label="Folder" description="Select SCION folder">
            <FolderStep
              selected={state.folder}
              onSelect={(folder) => setState((s) => ({ ...s, folder }))}
              onNext={nextStep}
            />
          </Stepper.Step>

          <Stepper.Step label="Topology" description="Select topology file">
            <TopologyStep
              folder={state.folder ?? ""}
              selected={state.topoFile}
              onSelect={(topoFile) => setState((s) => ({ ...s, topoFile }))}
              onNext={nextStep}
              onBack={prevStep}
            />
          </Stepper.Step>

          <Stepper.Step label="Configuration">
            <ConfigStep onNext={nextStep} onBack={prevStep} />
          </Stepper.Step>

          <Stepper.Step label="Loading">
            <LoadingStep
              folder={state.folder ?? ""}
              topoFile={state.topoFile ?? ""}
              onBack={() => {
                setState({ folder: null, topoFile: null });
                setActive(0);
              }}
            />
          </Stepper.Step>
        </Stepper>
      </Box>
    </Center>
  );
}

function FolderStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: string | null;
  onSelect: (folder: string) => void;
  onNext: () => void;
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
    <Stack gap="md" mt="md">
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
      <Group justify="flex-end">
        <Button disabled={!selected} onClick={onNext}>
          Next
        </Button>
      </Group>
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
  onNext,
  onBack,
}: {
  folder: string;
  selected: string | null;
  onSelect: (topoFile: string) => void;
  onNext: () => void;
  onBack: () => void;
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
    <Stack gap="md" mt="md">
      <Button variant="default" onClick={browse}>
        Browse…
      </Button>
      {selected && (
        <Text size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
          Selected: {selected}
        </Text>
      )}
      <FileList files={projectFiles} label="In project" selected={selected} onSelect={onSelect} />
      <FileList files={recentTopos} label="Recent" selected={selected} onSelect={onSelect} />
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button disabled={!selected} onClick={onNext}>
          Next
        </Button>
      </Group>
    </Stack>
  );
}

function ConfigStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Stack gap="md" mt="md">
      <Text c="dimmed" size="sm">
        No configuration options are available yet. Click Start to generate the
        topology configuration.
      </Text>
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Start</Button>
      </Group>
    </Stack>
  );
}

function LoadingStep({
  folder,
  topoFile,
  onBack,
}: {
  folder: string;
  topoFile: string;
  onBack: () => void;
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

      const configResult = await commands.createTopologyConfig(folder, topoFile);
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
      <Stack gap="md" mt="md">
        <Text c="red" size="sm" style={{ wordBreak: "break-word" }}>
          {error}
        </Text>
        <Button variant="default" onClick={onBack}>
          Start Over
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md" mt="md">
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
    </Stack>
  );
}
