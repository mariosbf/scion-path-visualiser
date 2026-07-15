import { Button, Drawer, Stack, Text } from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import { IconCheck } from "@tabler/icons-react";
import { type ComponentPropsWithoutRef, useEffect, useState } from "react";
import type { EndhostApiBridgeInfo } from "../../bindings";
import { commands } from "../../bindings";
import { FadeIn } from "../util/FadeIn";
import { ServiceDrawerContent } from "./ServiceDrawerContent";

export interface EndhostApiBridgeActive {
  asId: string;
  info: EndhostApiBridgeInfo;
}

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  activeAs: EndhostApiBridgeActive | null;
}

export function EndhostApiBridgeDrawer({ activeAs, ...drawerProps }: Props) {
  const clipboard = useClipboard({ timeout: 2000 });
  const [loading, setLoading] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    setMintError(null);
  }, [activeAs?.asId]);

  const handleMintToken = () => {
    if (!activeAs) return;
    setLoading(true);
    setMintError(null);
    commands.mintToken(activeAs.asId, 86400*7).then((result) => {
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
      title={activeAs ? `Endhost API Bridge — ${activeAs.asId}` : "Endhost API Bridge"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {activeAs && (
        <ServiceDrawerContent
          fields={[{ label: "Address", value: activeAs.info.addr }]}
          logsServiceName={`ehapi-bridge-${activeAs.asId}`}
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
