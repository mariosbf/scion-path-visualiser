import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { RouterNodeData } from "../../lib/topology";

export type RouterNodeType = Node<RouterNodeData, "router">;

const sideToPosition: Record<string, Position> = {
  top: Position.Top,
  bottom: Position.Bottom,
  left: Position.Left,
  right: Position.Right,
};

export function RouterNode({ data }: NodeProps<RouterNodeType>) {
  const pos = sideToPosition[data.handleSide ?? "bottom"];
  return (
    <>
      <Handle type="source" position={pos} id="s" />
      <Handle type="target" position={pos} id="t" />
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
