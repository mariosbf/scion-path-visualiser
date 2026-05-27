import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TrafficControlView } from "../../components/TrafficControlView";
import useTopology from "../../hooks/useTopology";

export const Route = createFileRoute("/app/traffic-control")({
  component: TrafficControlRoute,
});

export function TrafficControlRoute() {
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
      <TrafficControlView topology={topology} />
    </div>
  );
}
