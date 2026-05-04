import { BaseEdge, EdgeProps, getBezierPath } from '@xyflow/react';

interface HighlightedEdgeData extends Record<string, unknown> {
  reverse?: boolean;
}

export function HighlightedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as HighlightedEdgeData | undefined;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: '#228be6',
        strokeWidth: 3,
        animationDirection: edgeData?.reverse ? 'reverse' : 'normal',
      } as React.CSSProperties}
    />
  );
}
