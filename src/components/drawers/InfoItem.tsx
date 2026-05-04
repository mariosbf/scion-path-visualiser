import { Divider, Group, Stack, Text } from "@mantine/core";
import CopyActionIcon from "../util/CopyActionIcon";

export function InfoItem({
  label,
  ...props
}: { label: string } & (
  | { value: string | number; values?: never }
  | { value?: never; values: (string | number)[] }
)) {
  const item = (v: string | number) => (
    <Group justify="space-between" key={v}>
      <Text>{v}</Text>
      <CopyActionIcon value={v} />
    </Group>
  );

  const value =
    props.value !== undefined ? item(props.value) : props.values?.map(item);

  return (
    <>
      <Stack gap={4}>
        <Text c="dimmed">{label}</Text>
        <Stack gap={4}>{value}</Stack>
      </Stack>
      <Divider />
    </>
  );
}
