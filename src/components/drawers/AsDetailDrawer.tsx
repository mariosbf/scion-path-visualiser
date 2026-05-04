import { Anchor, Badge, Divider, Drawer, Stack, Text } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { AsNodeData, RouterNodeData } from "../../lib/topology";
import { InfoItem } from "./InfoItem";

export type ServiceDrawerId =
  | "service-control"
  | "service-daemon"
  | "service-hbird"
  | "ehapi-bridge";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  selectedAs: AsNodeData | null;
  routers: RouterNodeData[];
  onViewService: (id: ServiceDrawerId) => void;
  onViewRouter: (router: RouterNodeData) => void;
}

export function AsDetailDrawer({
  selectedAs,
  routers,
  onViewService,
  onViewRouter,
  ...drawerProps
}: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={selectedAs ? `AS — ${selectedAs.asId}` : "AS"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {selectedAs && (
        <AsDetails
          node={selectedAs}
          routers={routers}
          onViewService={onViewService}
          onViewRouter={onViewRouter}
        />
      )}
    </Drawer>
  );
}

export function AsDetails({
  node,
  routers,
  onViewService,
  onViewRouter,
}: {
  node: AsNodeData;
  routers: RouterNodeData[];
  onViewService: (id: ServiceDrawerId) => void;
  onViewRouter: (router: RouterNodeData) => void;
}) {
  return (
    <Stack gap="sm">
      <InfoItem label="ISD-AS " value={node.asId} />
      {node.mtu !== null && <InfoItem label="MTU" value={node.mtu} />}

      <Stack>
        <Text c="dimmed">Type</Text>
        {node.core && <Badge color="orange">Core</Badge>}
      </Stack>
      <Divider />

      <Stack gap={4}>
        <Text c="dimmed">Services</Text>
        <Stack gap={4}>
          <Anchor href="#" onClick={() => onViewService("service-control")}>
            Control service ({node.control_service.name})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("service-daemon")}>
            SCION Daemon ({node.daemon_info.id})
          </Anchor>
          <Anchor href="#" onClick={() => onViewService("ehapi-bridge")}>
            Endhost API Bridge
          </Anchor>
          {node.hbird_info && (
            <Anchor href="#" onClick={() => onViewService("service-hbird")}>
              Hummingbird ({node.hbird_info.id})
            </Anchor>
          )}
        </Stack>
      </Stack>
      <Divider />

      {routers.length > 0 && (
        <>
          <Stack gap={4}>
            <Text c="dimmed">Routers</Text>
            <Stack gap={4}>
              {routers.map((r) => (
                <Anchor
                  href="#"
                  key={`${r.routerName}-${r.interfaceId}`}
                  onClick={() => onViewRouter(r)}
                >
                  {r.routerName} (if: {r.interfaceId})
                </Anchor>
              ))}
            </Stack>
          </Stack>
          <Divider />
        </>
      )}

      <InfoItem
        label="Discovery Service"
        values={[node.discovery_service.name, node.discovery_service.addr]}
      />
    </Stack>
  );
}
