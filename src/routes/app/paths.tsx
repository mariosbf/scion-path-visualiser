import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PathSearchView } from "../../components/PathSearchView";
import useTopology from "../../hooks/useTopology";

export const Route = createFileRoute("/app/paths")({
  component: PathsRoute,
});

export function PathsRoute() {
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
      <PathSearchView topology={topology} />
    </div>
  );
}
