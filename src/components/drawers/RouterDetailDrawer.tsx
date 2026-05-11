import { Button, Drawer, Stack } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { BorderRouterInfo } from "../../bindings";
import { InfoItem } from "./InfoItem";

export interface RouterSelection {
  router: BorderRouterInfo;
  asId: string;
  interfaceId: number;
}

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  selection: RouterSelection | null;
}

export function RouterDetailDrawer({ selection, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={selection ? `Router — ${selection.router.name}` : "Router"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {selection && (
        <RouterDetails
          router={selection.router}
          asId={selection.asId}
          interfaceId={selection.interfaceId}
        />
      )}
    </Drawer>
  );
}

export function RouterDetails({
  router,
  asId,
  interfaceId,
}: {
  router: BorderRouterInfo;
  asId: string;
  interfaceId: number;
}) {
  const navigate = useNavigate();
  const iface = router.interfaces[interfaceId];
  return (
    <Stack gap="sm">
      <InfoItem label="Router" value={router.name} />
      <InfoItem label="AS" value={asId} />
      <InfoItem label="Interface ID" value={interfaceId} />
      {iface && (
        <>
          <InfoItem label="Underlay local" value={iface.underlay_local} />
          <InfoItem label="Underlay remote" value={iface.underlay_remote} />
        </>
      )}
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$serviceName",
            params: { serviceName: router.name },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
  );
}
