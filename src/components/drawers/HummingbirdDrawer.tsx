import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { HbirdInfo } from "../../bindings";
import { ServiceDrawerContent } from "./ServiceDrawerContent";
import ServiceStatusInfoItem from "./ServiceStatusInfoItem";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  info: HbirdInfo | null;
}

export function HummingbirdDrawer({ info, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={info ? `Hummingbird — ${info.id}` : "Hummingbird"}
      styles={{ body: { paddingTop: 8 } }}
    >
      {info && (
        <ServiceDrawerContent
          fields={[
            { label: "Address", value: info.addr },
            { label: "Min Bandwidth", value: info.min_bandwidth },
            { label: "Max Bandwidth", value: info.max_bandwidth },
            { label: "Reservation Duration", value: info.reservation_duration },
          ]}
          logsServiceName={info.id}
        >
          <ServiceStatusInfoItem status={info.status} />
        </ServiceDrawerContent>
      )}
    </Drawer>
  );
}
