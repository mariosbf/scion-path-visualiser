import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { ControlServiceInfo } from "../../bindings";
import { ServiceDrawerContent } from "./ServiceDrawerContent";
import ServiceStatusInfoItem from "./ServiceStatusInfoItem";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  info: ControlServiceInfo | null;
}

export function ControlServiceDrawer({ info, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={info ? `Control Service — ${info.name}` : "Control Service"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {info && (
        <ServiceDrawerContent
          fields={[{ label: "Address", value: info.addr }]}
          logsServiceName={info.name}
        >
          <ServiceStatusInfoItem status={info.status} />
        </ServiceDrawerContent>
      )}
    </Drawer>
  );
}
