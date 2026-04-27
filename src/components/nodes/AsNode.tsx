import type { NodeProps, Node } from "@xyflow/react";
import type { AsNodeData } from "../../lib/topology";

export type AsNodeType = Node<AsNodeData, "as">;

export function AsNode({ data }: NodeProps<AsNodeType>) {
  const borderColor = data.core
    ? "var(--mantine-color-orange-5)"
    : "var(--mantine-color-gray-6)";
  const labelColor = data.core
    ? "var(--mantine-color-orange-3)"
    : "var(--mantine-color-gray-4)";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        background: "var(--mantine-color-dark-6)",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 11,
          color: labelColor,
          userSelect: "none",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}
