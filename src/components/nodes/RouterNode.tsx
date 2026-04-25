import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { RouterNodeData } from "../../lib/topology";

export type RouterNodeType = Node<RouterNodeData, "router">;

export function RouterNode({ data }: NodeProps<RouterNodeType>) {
  return (
    <>
      <Handle type="source" position={Position.Top} />
      <Handle type="target" position={Position.Bottom} />
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: "var(--mantine-color-dark-4)",
          border: "2px solid var(--mantine-color-gray-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 8,
          color: "var(--mantine-color-gray-3)",
          userSelect: "none",
          boxSizing: "border-box",
        }}
      >
        {data.label}
      </div>
    </>
  );
}
