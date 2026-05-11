import { describe, expect, test } from 'vitest';
import { mapPathToEdges } from './paths';
import type { TopologyNode, TopologyEdge, RouterNodeData } from './topology';
import type { ScionPath } from '../bindings';

function makeRouterNode(
  id: string,
  asId: string,
  interfaceId: number,
): TopologyNode {
  return {
    id,
    type: 'router',
    data: {
      label: String(interfaceId),
      asId,
      interfaceId,
    } satisfies RouterNodeData,
    position: { x: 0, y: 0 },
  } as TopologyNode;
}

const stubLink = {
  a: { as_id: '', router_name: '', interface_id: 0, underlay_local: '', underlay_remote: '' },
  b: { as_id: '', router_name: '', interface_id: 0, underlay_local: '', underlay_remote: '' },
  link_type: 'Child' as const,
};

function makeEdge(id: string, source: string, target: string): TopologyEdge {
  return { id, source, target, data: { linkType: 'Child', link: stubLink } } as TopologyEdge;
}

function makePath(interfaces: { isd_as: string; interface_id: number }[]): ScionPath {
  return { interfaces, expiry: '2026-05-04T12:00:00Z', mtu: 1472 };
}

describe('mapPathToEdges', () => {
  test('maps single-hop path to edge in forward direction', () => {
    const nodes = [
      makeRouterNode('r-1-110-br1-1', '1-ff00:0:110', 1),
      makeRouterNode('r-1-111-br1-2', '1-ff00:0:111', 2),
    ];
    const edges = [makeEdge('e1', 'r-1-110-br1-1', 'r-1-111-br1-2')];
    const path = makePath([
      { isd_as: '1-ff00:0:110', interface_id: 1 },
      { isd_as: '1-ff00:0:111', interface_id: 2 },
    ]);

    const result = mapPathToEdges(path, nodes, edges);

    expect(result.edgeIds).toEqual(['e1']);
    expect(result.edgeDirections.get('e1')).toBe('forward');
  });

  test('detects reverse edge direction', () => {
    const nodes = [
      makeRouterNode('r-1-110-br1-1', '1-ff00:0:110', 1),
      makeRouterNode('r-1-111-br1-2', '1-ff00:0:111', 2),
    ];
    // Edge in graph goes 111→110, but path goes 110→111
    const edges = [makeEdge('e1', 'r-1-111-br1-2', 'r-1-110-br1-1')];
    const path = makePath([
      { isd_as: '1-ff00:0:110', interface_id: 1 },
      { isd_as: '1-ff00:0:111', interface_id: 2 },
    ]);

    const result = mapPathToEdges(path, nodes, edges);

    expect(result.edgeIds).toEqual(['e1']);
    expect(result.edgeDirections.get('e1')).toBe('reverse');
  });

  test('maps multi-hop path to multiple edges', () => {
    const nodes = [
      makeRouterNode('r-a', '1-ff00:0:110', 1),
      makeRouterNode('r-b', '1-ff00:0:120', 2),
      makeRouterNode('r-c', '1-ff00:0:120', 3),
      makeRouterNode('r-d', '1-ff00:0:130', 4),
    ];
    const edges = [
      makeEdge('e1', 'r-a', 'r-b'),
      makeEdge('e2', 'r-d', 'r-c'),
    ];
    const path = makePath([
      { isd_as: '1-ff00:0:110', interface_id: 1 },
      { isd_as: '1-ff00:0:120', interface_id: 2 },
      { isd_as: '1-ff00:0:120', interface_id: 3 },
      { isd_as: '1-ff00:0:130', interface_id: 4 },
    ]);

    const result = mapPathToEdges(path, nodes, edges);

    expect(result.edgeIds).toEqual(['e1', 'e2']);
    expect(result.edgeDirections.get('e1')).toBe('forward');
    expect(result.edgeDirections.get('e2')).toBe('reverse');
  });

  test('skips interfaces not found in topology', () => {
    const nodes = [makeRouterNode('r-a', '1-ff00:0:110', 1)];
    const edges: TopologyEdge[] = [];
    const path = makePath([
      { isd_as: '1-ff00:0:110', interface_id: 1 },
      { isd_as: '1-ff00:0:999', interface_id: 99 },
    ]);

    const result = mapPathToEdges(path, nodes, edges);

    expect(result.edgeIds).toEqual([]);
  });

  test('returns empty result for empty interfaces list', () => {
    const result = mapPathToEdges(makePath([]), [], []);
    expect(result.edgeIds).toEqual([]);
    expect(result.edgeDirections.size).toBe(0);
  });
});
