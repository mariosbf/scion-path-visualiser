import { Badge, Divider, Stack, Text } from "@mantine/core";
import { ServiceState, ServiceStatusInfo } from "../../bindings";
import { TimeValue } from "@mantine/dates";

export default function ServiceStatusInfoItem({
  status,
}: {
  status?: ServiceStatusInfo | null;
}) {
  if (status === undefined || status === null) {
    return <></>;
  } else {
    let timestamp = new Date(status.timestamp);

    return (
      <>
        <Stack>
          <Text c="dimmed">
            Status (as of <TimeValue value={timestamp} withSeconds />)
          </Text>
          <ServiceStateBadge state={status.state} />
        </Stack>
        <Divider />
      </>
    );
  }
}

export function ServiceStateBadge({ state }: { state: ServiceState }) {
  switch (state) {
    case "Running":
    case "Starting":
    case "Created":
      return <Badge color="green">{state}</Badge>;
    case "Stopped":
    case "Stopping":
    case "Exited":
    case "Fatal":
    case "Dead":
      return <Badge color="red">{state}</Badge>;
    case "Unknown":
    case "Backoff":
    case "Paused":
    case "Restarting":
      return <Badge color="orange">{state}</Badge>;
  }
}
