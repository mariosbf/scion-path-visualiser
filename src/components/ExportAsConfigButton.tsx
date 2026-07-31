import {
  Alert,
  Button,
  Group,
  Modal,
  NavLink,
  NumberInput,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { save } from "@tauri-apps/plugin-dialog";
import { IconFileExport } from "@tabler/icons-react";
import { useState } from "react";
import { commands } from "../bindings";

const WEEK_SECONDS = 604800;

export function ExportAsConfigButton({ expanded }: { expanded: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [ttl, setTtl] = useState<number>(WEEK_SECONDS);
  const [exporting, setExporting] = useState(false);
  const [writtenTo, setWrittenTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setWrittenTo(null);
    setError(null);
    open();
  }

  async function handleExport() {
    // Name the file after the running topology; fall back if it can't be read.
    const name = await commands.getTopologyName();
    const defaultPath =
      name.status === "ok" ? `${name.data}.json` : "as-config.json";

    const path = await save({
      defaultPath,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;

    setWrittenTo(null);
    setError(null);
    setExporting(true);
    const result = await commands.exportAsConfig(path, ttl);
    setExporting(false);

    if (result.status === "error") {
      setError(result.error);
    } else {
      setWrittenTo(path);
    }
  }

  return (
    <>
      <NavLink
        label={expanded ? "Export AS config" : undefined}
        leftSection={<IconFileExport size={20} stroke={1.5} />}
        styles={{
          root: { borderRadius: "var(--mantine-radius-sm)" },
          label: { fontSize: 14, fontWeight: 500 },
        }}
        onClick={handleOpen}
      />
      <Modal
        opened={opened}
        onClose={close}
        title="Export AS config"
        size="md"
        closeOnClickOutside={!exporting}
        closeOnEscape={!exporting}
      >
        <Stack>
          <Text size="sm">
            Writes a JSON file with one entry per AS: type, service addresses
            and a freshly minted endhost API bridge token.
          </Text>
          <NumberInput
            label="Token TTL (seconds)"
            description="How long the exported endhost API bridge tokens stay valid."
            value={ttl}
            onChange={(value) =>
              setTtl(typeof value === "number" ? value : WEEK_SECONDS)
            }
            min={1}
            step={3600}
            allowDecimal={false}
            disabled={exporting}
          />
          {writtenTo && (
            <Alert color="green" style={{ wordBreak: "break-word" }}>
              Wrote AS config to {writtenTo}
            </Alert>
          )}
          {error && (
            <Alert color="red" style={{ wordBreak: "break-word" }}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={exporting}>
              Close
            </Button>
            <Button onClick={handleExport} loading={exporting}>
              Export…
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
