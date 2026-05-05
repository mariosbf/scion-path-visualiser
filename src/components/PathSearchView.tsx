import { useCallback, useMemo, useState } from 'react';
import type { ScionPath, Topology } from '../bindings';
import { mapPathToEdges, type HighlightedPath } from '../lib/paths';
import type { TopologyNode, TopologyEdge } from '../lib/topology';
import { TopologyCanvas } from './TopologyCanvas';
import { PathSidebar } from './PathSidebar';

interface Props {
  topology: Topology;
}

export function PathSearchView({ topology }: Props) {
  const [hoveredPath, setHoveredPath] = useState<ScionPath | null>(null);
  const [pinnedPath, setPinnedPath] = useState<ScionPath | null>(null);
  const [graphNodes, setGraphNodes] = useState<TopologyNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<TopologyEdge[]>([]);

  const activePath = pinnedPath ?? hoveredPath;

  const highlightedPath: HighlightedPath | undefined = useMemo(() => {
    if (!activePath) return undefined;
    return mapPathToEdges(activePath, graphNodes, graphEdges);
  }, [activePath, graphNodes, graphEdges]);

  // Stable reference prevents useEffect in TopologyCanvas from firing on every render
  const handleGraphReady = useCallback(
    (nodes: TopologyNode[], edges: TopologyEdge[]) => {
      setGraphNodes(nodes);
      setGraphEdges(edges);
    },
    [],
  );

  const handleSelect = useCallback((path: ScionPath | null) => {
    setPinnedPath(path);
    if (!path) setHoveredPath(null);
  }, []);

  const handleHover = useCallback(
    (path: ScionPath | null) => {
      if (!pinnedPath) setHoveredPath(path);
    },
    [pinnedPath],
  );

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <PathSidebar
        topology={topology}
        onHover={handleHover}
        onSelect={handleSelect}
        selectedPath={pinnedPath}
      />
      <TopologyCanvas
        topology={topology}
        highlightedPath={highlightedPath}
        onGraphReady={handleGraphReady}
      />
    </div>
  );
}
