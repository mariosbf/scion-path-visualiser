import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TopologyView } from "../../components/TopologyView";
import useTopology from "../../hooks/useTopology";

export const Route = createFileRoute("/app/topology")({
  component: TopologyRoute,
});

export function TopologyRoute() {
  const navigate = useNavigate();
  const topologyRes = useTopology();

  if (topologyRes?.status === "error") {
    navigate({ to: "/setup" });
  }

  if (topologyRes === undefined || topologyRes.status === "error") {
    return null;
  }

  const topology = topologyRes.data;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <TopologyView topology={topology} />
    </div>
  );
}
