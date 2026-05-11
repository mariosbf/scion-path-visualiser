import { Drawer } from "@mantine/core";
import { useEffect, type ComponentPropsWithoutRef } from "react";
import type { AsNodeData } from "../../lib/topology";
import { ServiceDrawerContent } from "./ServiceDrawerContent";
import ServiceStatusInfoItem from "./ServiceStatusInfoItem";

interface Props extends ComponentPropsWithoutRef<typeof Drawer> {
  activeAsData: AsNodeData | null;
}

export function ControlServiceDrawer({ activeAsData, ...drawerProps }: Props) {
  useEffect(() => {
    console.log("Active AS data:", activeAsData);
  }, [activeAsData]);

  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={
        activeAsData
          ? `Control Service — ${activeAsData.control_service.name}`
          : "Control Service"
      }
      styles={{ body: { paddingTop: 8 } }}
    >
      {activeAsData && (
        <>
          <ServiceDrawerContent
            fields={[
              { label: "Address", value: activeAsData.control_service.addr },
            ]}
            logsServiceName={activeAsData.control_service.name}
            children={
              <ServiceStatusInfoItem
                status={activeAsData?.control_service.status}
              />
            }
          />
        </>
      )}
    </Drawer>
  );
}
