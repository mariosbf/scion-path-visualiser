import { useMemo, useState } from "react";
import type { AsInfo, BorderRouterInfo, Link, Topology } from "../bindings";
import type { TopologyCanvasItem } from "../components/TopologyCanvas";

export type TopologyItem<Isd, As, Router, EdgeLink> =
  | { type: "isd"; data: Isd }
  | { type: "as"; data: As }
  | { type: "border-router"; data: Router }
  | { type: "link"; data: EdgeLink };

export interface IsdInfo {
  label: string;
  isd: string;
}

export type SelectedInfo =
  | { type: "isd"; data: { isd: string; ases: [string, AsInfo][] } }
  | { type: "as"; data: AsInfo; asId: string }
  | { type: "border-router"; data: BorderRouterInfo; asId: string; interfaceId: number }
  | { type: "link"; data: Link };

export function resolveSelectedInfo(
  selected: TopologyCanvasItem | undefined,
  topology: Topology,
): SelectedInfo | undefined {
  if (!selected) return undefined;

  if (selected.type === "isd") {
    const isd = selected.data.isd;
    const ases = Object.entries(topology.ases).filter(([id]) =>
      id.startsWith(isd + "-"),
    ) as [string, AsInfo][];
    return { type: "isd", data: { isd, ases } };
  }

  if (selected.type === "as") {
    const asId = selected.data.asId;
    const info = topology.ases[asId];
    if (!info) return undefined;
    return { type: "as", data: info, asId };
  }

  if (selected.type === "border-router") {
    const { asId, interfaceId } = selected.data;
    const asInfo = topology.ases[asId];
    if (!asInfo) return undefined;
    const router = asInfo.border_routers.find((r) => interfaceId in r.interfaces);
    if (!router) return undefined;
    return { type: "border-router", data: router, asId, interfaceId };
  }

  if (selected.type === "link") {
    return { type: "link", data: selected.data };
  }

  return undefined;
}

export default function useTopologyCanvas(topology: Topology): {
  canvasProps: {
    topology: Topology;
    onComponentClick: (component?: TopologyCanvasItem) => void;
  };
  selected: TopologyCanvasItem | undefined;
  selectedInfo: SelectedInfo | undefined;
} {
  const [selected, setSelected] = useState<TopologyCanvasItem | undefined>();

  const selectedInfo = useMemo(
    () => resolveSelectedInfo(selected, topology),
    [selected, topology],
  );

  const canvasProps = {
    topology,
    onComponentClick: setSelected,
  };

  return { canvasProps, selected, selectedInfo };
}
