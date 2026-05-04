import type { Topology } from '../bindings';
import { TopologyCanvas } from './TopologyCanvas';

interface Props {
  topology: Topology;
}

export function TopologyView({ topology }: Props) {
  return <TopologyCanvas topology={topology} />;
}
