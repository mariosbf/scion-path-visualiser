import {
  ActionIcon,
  ActionIconProps,
  PolymorphicComponentProps,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { FadeIn } from "./FadeIn";

export default function CopyActionIcon({
  value,
  ...props
}: { value: string | number } & PolymorphicComponentProps<
  "button",
  ActionIconProps
>) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const onClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    props.onClick?.(e);
    navigator.clipboard.writeText(String(value));
    setCopied(true);
  };

  return (
    <Tooltip label={copied ? "Copied" : "Copy"}>
      <ActionIcon
        variant="default"
        aria-label="Copy to clipboard"
        {...props}
        onClick={onClick}
      >
        {copied ? <FadeIn><IconCheck size={16} /></FadeIn> : <IconCopy size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}
