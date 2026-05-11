import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { ScionDaemonInfo } from "../../bindings";
import { ServiceDrawerContent } from "./ServiceDrawerContent";
import ServiceStatusInfoItem from "./ServiceStatusInfoItem";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  info: ScionDaemonInfo | null;
}

export function DaemonDrawer({ info, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={info ? `SCION Daemon — ${info.id}` : "SCION Daemon"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {info && (
        <ServiceDrawerContent
          fields={[
            { label: "Address", value: info.address },
            { label: "API Address", value: info.api_addr },
          ]}
          logsServiceName={info.id}
        >
          <ServiceStatusInfoItem status={info.status} />
        </ServiceDrawerContent>
      )}
    </Drawer>
  );
}
