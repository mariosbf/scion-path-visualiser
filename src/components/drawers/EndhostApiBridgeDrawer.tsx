import { Button, Drawer, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { IconCheck } from "@tabler/icons-react";
import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import { FadeIn } from "../util/FadeIn";
import type { AsNodeData } from "../../lib/topology";
import { commands } from "../../bindings";
import { ServiceDrawerContent } from "./ServiceDrawerContent";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  activeAsData: AsNodeData | null;
}

export function EndhostApiBridgeDrawer({
  activeAsData,
  ...drawerProps
}: Props) {
  const clipboard = useClipboard({ timeout: 2000 });
  const [loading, setLoading] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    setMintError(null);
  }, [activeAsData?.asId]);

  const handleMintToken = () => {
    if (!activeAsData) return;
    setLoading(true);
    setMintError(null);
    commands.mintToken(activeAsData.asId, 86400).then((result) => {
      setLoading(false);
      if (result.status === "ok") {
        clipboard.copy(result.data);
      } else {
        setMintError(result.error);
      }
    });
  };

  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={
        activeAsData
          ? `Endhost API Bridge — ${activeAsData.asId}`
          : "Endhost API Bridge"
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      {activeAsData && (
        <ServiceDrawerContent
          fields={[{ label: "Address", value: activeAsData.ehapi_bridge.addr }]}
          logsServiceName={`${activeAsData.asId}-ehapi-bridge`}
        >
          <Stack>
            <Button variant="light" loading={loading} onClick={handleMintToken}>
              {clipboard.copied ? (
                <FadeIn>
                  Copied!
                  <IconCheck size={14} />
                </FadeIn>
              ) : (
                "Copy token"
              )}
            </Button>
            {mintError && (
              <Text c="red" size="sm">
                {mintError}
              </Text>
            )}
          </Stack>
        </ServiceDrawerContent>
      )}
    </Drawer>
  );
}
