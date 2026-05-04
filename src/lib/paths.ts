import type { TopologyEdge, TopologyNode, RouterNodeData } from './topology';
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
  const routerNodes = nodes.filter((n) => n.type === 'router');

  function findRouterId(isdAs: string, interfaceId: number): string | null {
    const node = routerNodes.find((n) => {
      const data = n.data as RouterNodeData;
      return data.asId === isdAs && data.interfaceId === interfaceId;
    });
    return node?.id ?? null;
  }

  const edgeIds: string[] = [];
  const edgeDirections = new Map<string, 'forward' | 'reverse'>();

  for (let i = 0; i < path.interfaces.length - 1; i += 2) {
    const iface0 = path.interfaces[i];
    const iface1 = path.interfaces[i + 1];

    const routerId0 = findRouterId(iface0.isd_as, iface0.interface_id);
    const routerId1 = findRouterId(iface1.isd_as, iface1.interface_id);

    if (!routerId0 || !routerId1) continue;

    const edge = edges.find(
      (e) =>
        (e.source === routerId0 && e.target === routerId1) ||
        (e.source === routerId1 && e.target === routerId0),
    );

    if (!edge) continue;

    edgeIds.push(edge.id);
    edgeDirections.set(
      edge.id,
      edge.source === routerId0 ? 'forward' : 'reverse',
    );
  }

  return { edgeIds, edgeDirections };
}
