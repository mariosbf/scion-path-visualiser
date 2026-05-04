import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { AsNodeData } from "../../lib/topology";
import { ServiceDrawerContent } from "./ServiceDrawerContent";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  activeAsData: AsNodeData | null;
}

export function HummingbirdDrawer({ activeAsData, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={
        activeAsData?.hbird_info
          ? `Hummingbird — ${activeAsData.hbird_info.id}`
          : "Hummingbird"
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      {activeAsData?.hbird_info && (
        <ServiceDrawerContent
          fields={[
            { label: "Address", value: activeAsData.hbird_info.addr },
            { label: "Min Bandwidth", value: activeAsData.hbird_info.min_bandwidth },
            { label: "Max Bandwidth", value: activeAsData.hbird_info.max_bandwidth },
            { label: "Reservation Duration", value: activeAsData.hbird_info.reservation_duration },
          ]}
          logsServiceName={activeAsData.hbird_info.id}
        />
      )}
    </Drawer>
  );
}
