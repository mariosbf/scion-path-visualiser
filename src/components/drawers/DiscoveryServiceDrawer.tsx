import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { DiscoveryServiceInfo } from "../../bindings";
import { ServiceDrawerContent } from "./ServiceDrawerContent";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  info: DiscoveryServiceInfo | null;
}

export function DiscoveryServiceDrawer({ info, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={info ? `Discovery Service — ${info.name}` : "Discovery Service"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {info && (
        <ServiceDrawerContent
          fields={[{ label: "Address", value: info.addr }]}
          logsServiceName={info.name}
        />
      )}
    </Drawer>
  );
}
