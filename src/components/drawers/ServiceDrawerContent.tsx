import { Button, Stack } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { InfoItem } from "./InfoItem";

interface Props {
  fields: { label: string; value: string | number }[];
  logsServiceName: string;
  children?: ReactNode;
}

export function ServiceDrawerContent({
  fields,
  logsServiceName,
  children,
}: Props) {
  const navigate = useNavigate();
  return (
    <Stack gap="sm">
      {fields.map((f) => (
        <InfoItem key={f.label} label={f.label} value={f.value} />
      ))}
      {children && <>{children}</>}
      <Button
        variant="light"
        leftSection={<IconFileText size={14} />}
        onClick={() =>
          navigate({
            to: "/app/logs/$serviceName",
            params: { serviceName: logsServiceName },
          })
        }
      >
        View Logs
      </Button>
    </Stack>
  );
}
