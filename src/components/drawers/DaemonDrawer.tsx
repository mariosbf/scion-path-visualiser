import { Drawer } from "@mantine/core";
import type { ComponentPropsWithoutRef } from "react";
import type { AsNodeData } from "../../lib/topology";
import { ServiceDrawerContent } from "./ServiceDrawerContent";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  activeAsData: AsNodeData | null;
}

export function DaemonDrawer({ activeAsData, ...drawerProps }: Props) {
  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={
        activeAsData
          ? `SCION Daemon — ${activeAsData.daemon_info.id}`
          : "SCION Daemon"
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      {activeAsData && (
        <ServiceDrawerContent
          fields={[
            { label: "Address", value: activeAsData.daemon_info.address },
            { label: "API Address", value: activeAsData.daemon_info.api_addr },
          ]}
          logsServiceName={activeAsData.daemon_info.id}
        />
      )}
    </Drawer>
  );
}
