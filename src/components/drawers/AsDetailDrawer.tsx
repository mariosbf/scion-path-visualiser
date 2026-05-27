import { Anchor, Badge, Divider, Drawer, Stack, Text } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { AsInfo } from "../../bindings";
import type { InterfaceSelection } from "./InterfaceDetailDrawer";
import { InfoItem } from "./InfoItem";

export type ServiceDrawerId =
  | "service-control"
  | "service-daemon"
  | "service-hbird"
  | "ehapi-bridge"
  | "service-discovery";

export interface AsSelection {
  asId: string;
  info: AsInfo;
}

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  selection: AsSelection | null;
  onViewService: (id: ServiceDrawerId) => void;
  onViewInterface: (r: InterfaceSelection) => void;
}

export function AsDetailDrawer({
  selection,
  onViewService,
  onViewInterface,
  ...drawerProps
}: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={selection ? `AS — ${selection.asId}` : "AS"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {selection && (
        <AsDetails
          asId={selection.asId}
          info={selection.info}
          onViewService={onViewService}
          onViewInterface={onViewInterface}
        />
      )}
    </Drawer>
  );
}

export function AsDetails({
  asId,
  info,
  onViewService,
  onViewInterface,
}: {
  asId: string;
  info: AsInfo;
  onViewService: (id: ServiceDrawerId) => void;
  onViewInterface: (r: InterfaceSelection) => void;
}) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD-AS" value={asId} />
      {info.mtu !== null && <InfoItem label="MTU" value={info.mtu} />}

      <Stack>
        <Text c="dimmed">Type</Text>
        {info.core && <Badge color="orange">Core</Badge>}
      </Stack>
      <Divider />

      <Stack gap={4}>
        <Text c="dimmed">Services</Text>
        <Stack gap={4}>
          <Anchor href="#" onClick={() => onViewService("service-control")}>
            Control service ({info.control_service.name})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("service-daemon")}>
            SCION Daemon ({info.daemon.id})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("ehapi-bridge")}>
            Endhost API Bridge
          </Anchor>
          {info.hummingbird && (
            <Anchor href="#" onClick={() => onViewService("service-hbird")}>
              Hummingbird ({info.hummingbird.id})
            </Anchor>
          )}
          <Anchor href="#" onClick={() => onViewService("service-discovery")}>
            Discovery Service ({info.discovery_service.name})
          </Anchor>
        </Stack>
      </Stack>
      <Divider />

      {info.border_routers.length > 0 && (
        <>
          <Stack gap={4}>
            <Text c="dimmed">Border Router Interfaces</Text>
            <Stack gap={4}>
              {info.border_routers.flatMap((r) =>
                Object.keys(r.interfaces).map((ifId) => {
                  const interfaceId = Number(ifId);
                  return (
                    <Anchor
                      href="#"
                      key={`${r.name}-${interfaceId}`}
                      onClick={() =>
                        onViewInterface({ router: r, asId, interfaceId })
                      }
                    >
                      {r.name} (if: {interfaceId})
                    </Anchor>
                  );
                })
              )}
            </Stack>
          </Stack>
          <Divider />
        </>
      )}

    </Stack>
  );
}
