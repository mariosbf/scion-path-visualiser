import { Button, Drawer, Stack } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { RouterNodeData } from "../../lib/topology";
import { InfoItem } from "./InfoItem";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  selectedRouter: RouterNodeData | null;
}

export function RouterDetailDrawer({ selectedRouter, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={selectedRouter ? `Router — ${selectedRouter.routerName}` : "Router"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {selectedRouter && <RouterDetails node={selectedRouter} />}
    </Drawer>
  );
}

export function RouterDetails({ node }: { node: RouterNodeData }) {
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      <InfoItem label="Router" value={node.routerName} />
      <InfoItem label="AS" value={node.asId} />
      <InfoItem label="Interface ID" value={node.interfaceId} />
      <InfoItem label="Underlay local" value={node.underlayLocal} />
      <InfoItem label="Underlay remote" value={node.underlayRemote} />
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$serviceName",
            params: { serviceName: node.routerName },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
  );
}
