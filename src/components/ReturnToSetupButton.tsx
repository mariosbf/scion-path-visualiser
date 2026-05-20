import { Button, Group, Loader, Modal, NavLink, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { listen } from "@tauri-apps/api/event";
import { IconArrowLeft } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { commands } from "../bindings";
import { TerminalOutput } from "./TerminalOutput";

export function ReturnToSetupButton({ expanded }: { expanded: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [lines, setLines] = useState<string[]>([]);
  const [title, setTitle] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const navigate = useNavigate();

  async function handleClick() {
    setLines([]);
    setTitle("…");
    setError(null);
    setRunning(true);
    open();

    const unlistenOutput = await listen<string>("scion-setup-output", (e) => {
      setLines((prev) => [...prev, e.payload]);
    });
    const unlistenPhase = await listen<string>("scion-setup-phase", (e) => {
      setTitle(e.payload);
    });

    const result = await commands.resetToSetup();
    unlistenOutput();
    unlistenPhase();
    setRunning(false);

    if (result.status === "error") {
      setError(result.error);
    } else {
      close();
      navigate({ to: "/setup" });
    }
  }

  return (
    <>
      <NavLink
        label={expanded ? "Return to setup" : undefined}
        leftSection={<IconArrowLeft size={20} stroke={1.5} />}
        rightSection={running ? <Loader size="xs" /> : <></>}
        styles={{
          root: { borderRadius: "var(--mantine-radius-sm)" },
          label: { fontSize: 14, fontWeight: 500 },
        }}
        onClick={openConfirm}
        disabled={running}
      />
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title="Return to setup?"
        size="sm"
      >
        <Text size="sm">This will stop the SCION network and return to the setup wizard.</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeConfirm}>Cancel</Button>
          <Button
            color="red"
            onClick={() => {
              closeConfirm();
              handleClick();
            }}
          >
            Return to setup
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={opened}
        onClose={close}
        title="Return to setup"
        size="xl"
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <Stack>
          <TerminalOutput
            lines={lines}
            title={running ? title : undefined}
            loading={running}
            h={400}
          />
          {error && (
            <Text c="red" size="sm" style={{ wordBreak: "break-word" }}>
              {error}
            </Text>
          )}
          <Button onClick={close} disabled={running}>
            Close
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
