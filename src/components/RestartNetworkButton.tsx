import {
  Button,
  Group,
  Loader,
  Modal,
  NavLink,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { listen } from "@tauri-apps/api/event";
import { IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { commands } from "../bindings";
import { TerminalOutput } from "./TerminalOutput";

export function RestartNetworkButton({ expanded }: { expanded: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] =
    useDisclosure(false);
  const [lines, setLines] = useState<string[]>([]);
  const [title, setTitle] = useState<string>("…");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

    const result = await commands.restartScionNetwork();
    unlistenOutput();
    unlistenPhase();
    setRunning(false);

    if (result.status === "error") {
      setError(result.error);
    }
  }

  return (
    <>
      <NavLink
        label={expanded ? "Restart network" : undefined}
        leftSection={<IconRefresh size={20} stroke={1.5} />}
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
        title="Restart network?"
        size="sm"
      >
        <Text size="sm">
          This will stop and restart the SCION network. Continue?
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeConfirm}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              closeConfirm();
              handleClick();
            }}
          >
            Restart
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={opened}
        onClose={close}
        title="Restart network"
        size="xl"
        closeOnClickOutside={!running}
        closeOnEscape={!running}
        closeButtonProps={{
          icon: undefined,
        }}
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
