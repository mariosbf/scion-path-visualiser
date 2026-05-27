import type { TopologyEdge, TopologyNode, InterfaceNodeData } from './topology';
import type { ScionPath } from '../bindings';

export interface HighlightedPath {
  edgeIds: string[];
  edgeDirections: Map<string, 'forward' | 'reverse'>;
}

export function mapPathToEdges(
  path: ScionPath,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): HighlightedPath {
  const interfaceNodes = nodes.filter((n) => n.type === 'interface');

  function findInterfaceNodeId(isdAs: string, interfaceId: number): string | null {
    const node = interfaceNodes.find((n) => {
      const data = n.data as InterfaceNodeData;
      return data.asId === isdAs && data.interfaceId === interfaceId;
    });
    return node?.id ?? null;
  }

  const edgeIds: string[] = [];
  const edgeDirections = new Map<string, 'forward' | 'reverse'>();

  for (let i = 0; i < path.interfaces.length - 1; i += 2) {
    const iface0 = path.interfaces[i];
    const iface1 = path.interfaces[i + 1];

    const nodeId0 = findInterfaceNodeId(iface0.isd_as, iface0.interface_id);
    const nodeId1 = findInterfaceNodeId(iface1.isd_as, iface1.interface_id);

    if (!nodeId0 || !nodeId1) continue;

    const edge = edges.find(
      (e) =>
        (e.source === nodeId0 && e.target === nodeId1) ||
        (e.source === nodeId1 && e.target === nodeId0),
    );

    if (!edge) continue;

    edgeIds.push(edge.id);
    edgeDirections.set(
      edge.id,
      edge.source === nodeId0 ? 'forward' : 'reverse',
    );
  }

  return { edgeIds, edgeDirections };
}
