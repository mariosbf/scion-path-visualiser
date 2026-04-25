import type { NodeProps, Node } from "@xyflow/react";
import type { IsdNodeData } from "../../lib/topology";

export type IsdNodeType = Node<IsdNodeData, "isd">;

export function IsdNode({ data }: NodeProps<IsdNodeType>) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: "2px solid var(--mantine-color-blue-5)",
        borderRadius: 8,
        background: "var(--mantine-color-dark-8)",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--mantine-color-blue-3)",
          userSelect: "none",
        }}
      >
        {data.label}
      </span>
    </div>
  );
}
